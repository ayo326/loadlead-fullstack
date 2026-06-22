import express, { Response } from 'express';
import { body } from 'express-validator';
import crypto from 'crypto';
import { AuthService } from '../services/authService';
import { SecurityService } from '../services/securityService';
import { Helpers } from '../utils/helpers';
import { asyncHandler } from '../middleware/errorHandler';
import { authValidators } from '../utils/validators';
import { validate } from '../middleware/validation';
import { authenticate, AuthRequest } from '../middleware/auth';
import { EmailService } from '../services/emailService';
import { docClient } from '../config/aws';
import { PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import bcrypt from 'bcryptjs';

const RESET_TABLE = process.env.DYNAMODB_RESET_TABLE || 'LoadLead_PasswordResets';
const USERS_TABLE = process.env.DYNAMODB_USERS_TABLE || 'LoadLead_Users';

const router = express.Router();

// ── Cookie helper ──────────────────────────────────────────────────────────────
// Sets the JWT as an httpOnly, Secure, SameSite=Strict cookie.
// httpOnly prevents JavaScript (including XSS payloads) from reading the token.
// The token is ALSO returned in the JSON body so callers can decode user info
// without storing the raw JWT string in any browser storage.
const COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (matches JWT exp)

function setAuthCookie(res: Response, token: string) {
  res.cookie('ll_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_TTL_MS,
    path: '/',
  });
}

// POST /api/auth/signup
router.post(
  '/signup',
  validate(authValidators.signup),
  asyncHandler(async (req, res) => {
    const { email, password, role, orgParams, firstName, lastName, phone } = req.body;
    const result = await AuthService.signup(email, password, role, orgParams,
      { firstName, lastName, phone });
    // Send role-specific welcome email (non-blocking)
    EmailService.welcome(email, role).catch(() => {});
    setAuthCookie(res, result.token);
    res.status(201).json(result);
  })
);

// POST /api/auth/signup/carrier
// Dedicated, atomic carrier-admin signup — separate from the generic
// signup() above on purpose (see AuthService.signupCarrierAdmin). Does not
// touch or share code paths with the four existing personas' signup.
router.post(
  '/signup/carrier',
  validate([
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('legalName').notEmpty().withMessage('Company legal name is required'),
    body('mcNumber').optional().isString(),
    body('dotNumber').optional().isString(),
    body('dba').optional().isString(),
  ]),
  asyncHandler(async (req, res) => {
    const { email, password, legalName, dba, mcNumber, dotNumber } = req.body;
    const result = await AuthService.signupCarrierAdmin({ email, password, legalName, dba, mcNumber, dotNumber });
    EmailService.welcome(email, 'CARRIER_ADMIN').catch(() => {});
    setAuthCookie(res, result.token);
    res.status(201).json(result);
  })
);

// POST /api/auth/login
router.post(
  '/login',
  validate(authValidators.login),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password);

    const has2fa = await SecurityService.hasTwoFactor(result.user.userId);

    // STIG / IAM spec: 2FA is MANDATORY for any ADMIN sign-in. If the user
    // has the ADMIN role but no 2FA enrolled, refuse the login and instruct
    // them to enroll out-of-band first (the bootstrapAdmin CLI prompts them
    // to set 2FA on first sign-in; this hard gate keeps a credential leak
    // alone from being enough to act as ADMIN).
    if (result.user.role === 'ADMIN' && !has2fa) {
      return res.status(403).json({
        error: 'MFA_REQUIRED',
        message:
          'Administrator accounts require two-factor authentication. ' +
          'Enroll 2FA before signing in (see backend/scripts/README.md).',
      });
    }

    // 2FA gate: if the user has 2FA enabled, do not issue a session yet -
    // return a short-lived ticket the client trades after the second factor.
    if (has2fa) {
      const twoFactorTicket = SecurityService.mintTwoFactorTicket(result.user.userId);
      return res.json({ needsTwoFactor: true, twoFactorTicket });
    }

    setAuthCookie(res, result.token);
    res.json(result);
  })
);

// POST /api/auth/2fa/login — second-step exchange of (ticket + code) for token
router.post('/2fa/login', asyncHandler(async (req, res) => {
  const { ticket, code } = req.body as { ticket?: string; code?: string };
  if (!ticket || !code) return res.status(400).json({ error: 'ticket and code required' });
  const userId = await SecurityService.exchangeTwoFactorTicket(ticket, code);
  const user = await AuthService.getUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const token = Helpers.generateToken({ userId: user.userId, email: user.email, role: user.role });
  setAuthCookie(res, token);
  res.json({ user, token });
}));

// ── Authenticated security routes (password + 2FA management) ─────────────
router.post('/change-password', authenticate, asyncHandler(async (req: any, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword required' });
  await SecurityService.changePassword(req.user.userId, currentPassword, newPassword);
  res.json({ ok: true });
}));

router.post('/2fa/setup', authenticate, asyncHandler(async (req: any, res) => {
  const result = await SecurityService.setupTwoFactor(req.user.userId, req.user.email);
  res.json(result);
}));

router.post('/2fa/verify', authenticate, asyncHandler(async (req: any, res) => {
  const { code } = req.body as { code?: string };
  if (!code) return res.status(400).json({ error: 'code required' });
  await SecurityService.verifyAndEnableTwoFactor(req.user.userId, code);
  res.json({ enabled: true });
}));

router.post('/2fa/disable', authenticate, asyncHandler(async (req: any, res) => {
  const { password } = req.body as { password?: string };
  if (!password) return res.status(400).json({ error: 'password required' });
  await SecurityService.disableTwoFactor(req.user.userId, password);
  res.json({ enabled: false });
}));

router.get('/2fa/status', authenticate, asyncHandler(async (req: any, res) => {
  const enabled = await SecurityService.hasTwoFactor(req.user.userId);
  res.json({ enabled });
}));

// POST /api/auth/logout — clears the httpOnly cookie
router.post('/logout', (_req, res) => {
  res.clearCookie('ll_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const user = await AuthService.getUserById(req.user!.userId);
    res.json({ user });
  })
);

// PATCH /api/auth/me — update own profile (displayName, phone)
router.patch(
  '/me',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { displayName, phone } = req.body;
    const updates: Record<string, any> = { updatedAt: Date.now() };
    if (displayName !== undefined) updates.displayName = displayName;
    if (phone      !== undefined) updates.phone       = phone;

    await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId: req.user!.userId },
      UpdateExpression: 'SET ' + Object.keys(updates).map((k, i) => `#f${i} = :v${i}`).join(', '),
      ExpressionAttributeNames:  Object.fromEntries(Object.keys(updates).map((k, i) => [`#f${i}`, k])),
      ExpressionAttributeValues: Object.fromEntries(Object.keys(updates).map((k, i) => [`:v${i}`, updates[k]])),
    }));

    const user = await AuthService.getUserById(req.user!.userId);
    res.json({ user });
  })
);

// POST /api/auth/forgot-password
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Always respond 200 to prevent email enumeration
  const user = await AuthService.getUserByEmail(email).catch(() => null);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
    await docClient.send(new PutCommand({
      TableName: RESET_TABLE,
      Item: { token, userId: user.userId, email: user.email, expiresAt },
    }));
    const resetUrl = `https://loadleadapp.com/reset-password?token=${token}`;
    await EmailService.passwordReset(user.email, resetUrl);
  }
  res.json({ message: 'If that email exists, a reset link has been sent.' });
}));

// POST /api/auth/reset-password
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const result = await docClient.send(new GetCommand({ TableName: RESET_TABLE, Key: { token } }));
  const record = result.Item;
  if (!record || record.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Reset link is invalid or has expired' });
  }

  const hash = await bcrypt.hash(password, 12);
  await docClient.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { userId: record.userId },
    UpdateExpression: 'SET passwordHash = :h, updatedAt = :t',
    ExpressionAttributeValues: { ':h': hash, ':t': new Date().toISOString() },
  }));
  await docClient.send(new DeleteCommand({ TableName: RESET_TABLE, Key: { token } }));
  res.json({ message: 'Password reset successful. You can now log in.' });
}));

export default router;
