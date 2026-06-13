import express from 'express';
import crypto from 'crypto';
import { AuthService } from '../services/authService';
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

// POST /api/auth/signup
router.post(
  '/signup',
  validate(authValidators.signup),
  asyncHandler(async (req, res) => {
    const { email, password, role, orgParams } = req.body;
    const result = await AuthService.signup(email, password, role, orgParams);
    // Send role-specific welcome email (non-blocking)
    EmailService.welcome(email, role).catch(() => {});
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
    res.json(result);
  })
);

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
