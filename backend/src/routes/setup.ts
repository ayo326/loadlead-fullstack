/**
 * /api/setup — Platform-ADMIN bootstrap (OUT-OF-BAND ONLY)
 *
 * Per the Part B security audit (LL-AC-004 CAT-I), this endpoint is
 * intentionally LOCKED in production. The canonical bootstrap path is the
 * CLI at backend/scripts/bootstrapAdmin.mjs. These HTTP routes only respond
 * when ALLOW_ADMIN_BOOTSTRAP=true is set in the runtime environment (which
 * staging and prod do NOT set). When disabled the routes return 404 so that
 * the very existence of the endpoint is invisible to scanners.
 *
 * Hardening applied:
 *   - Env-gated (ALLOW_ADMIN_BOOTSTRAP must be 'true'; default off)
 *   - Aggressive rate limiter (5 requests / 15 min / IP)
 *   - Atomic admin uniqueness via roleSingleton marker + conditional put
 *     so two concurrent /complete requests cannot both create an ADMIN
 *   - Every attempt audited to LoadLead_AdminBootstrapAttempts (best effort)
 *   - 24-hour single-use setup token, burned after use
 *
 * Verification: tests/security/bootstrap.race.test.ts
 */

import express, { type Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '../config/aws';
import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/errorHandler';
import { EmailService } from '../services/emailService';
import Logger from '../utils/logger';

const router = express.Router();

const USERS_TABLE        = process.env.DYNAMODB_USERS_TABLE        || 'LoadLead_Users';
const SETUP_TOKENS_TABLE = process.env.DYNAMODB_SETUP_TOKENS_TABLE || 'LoadLead_SetupTokens';
const AUDIT_TABLE        = process.env.DYNAMODB_BOOTSTRAP_AUDIT_TABLE || 'LoadLead_AdminBootstrapAttempts';
const APP_URL            = process.env.APP_URL                     || 'https://loadleadapp.com';

// Evaluated per-request so tests + ops can flip the flag without restarting.
const isAllowed = () => process.env.ALLOW_ADMIN_BOOTSTRAP === 'true';

/**
 * Fixed-PK marker for "an ADMIN exists". Stored once in USERS_TABLE
 * (alongside the real admin record). The conditional put on this marker
 * is what gives us atomic uniqueness: DynamoDB rejects the second writer
 * with ConditionalCheckFailedException.
 *
 * If your USERS_TABLE primary key isn't 'userId' (string), update this
 * constant to match. The seed/createTables script knows about this row.
 */
const ADMIN_SINGLETON_USER_ID = '__admin_singleton__';

// ── helpers ────────────────────────────────────────────────────────────────────

/** Best-effort audit log for every bootstrap attempt. Never throws. */
async function audit(
  action: 'request' | 'complete',
  payload: {
    ip?: string;
    email?: string;
    userAgent?: string;
    status: 'ok' | 'blocked_disabled' | 'blocked_admin_exists' | 'blocked_bad_token' | 'blocked_expired' | 'blocked_race' | 'error';
    errorMessage?: string;
  },
) {
  try {
    await docClient.send(new PutCommand({
      TableName: AUDIT_TABLE,
      Item: {
        attemptId: uuidv4(),
        action,
        ip:         payload.ip       ?? 'unknown',
        userAgent:  payload.userAgent?? 'unknown',
        email:      payload.email    ?? null,
        status:     payload.status,
        errorMessage: payload.errorMessage ?? null,
        timestamp:  Date.now(),
      },
    }));
    Logger.info(`[admin-bootstrap] ${action} ${payload.status} ip=${payload.ip} email=${payload.email}`);
  } catch (err) {
    // Audit failure must not break the route; log loudly so SRE sees it.
    Logger.error('[admin-bootstrap] AUDIT WRITE FAILED', err);
  }
}

/** Bootstrap routes return 404 when the env gate is off. */
function gateOrDeny(req: express.Request, res: Response): boolean {
  if (isAllowed()) return true;
  audit('request', {
    ip:        req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    status:    'blocked_disabled',
  });
  res.status(404).json({ error: 'Not found' });
  return false;
}

async function adminExists(): Promise<boolean> {
  // Singleton marker check first (cheap, atomic point read).
  const marker = await docClient.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { userId: ADMIN_SINGLETON_USER_ID },
  }));
  if (marker.Item) return true;

  // Fallback scan in case bootstrap pre-dated this code and no marker exists.
  const result = await docClient.send(new ScanCommand({
    TableName: USERS_TABLE,
    FilterExpression: '#r = :admin',
    ExpressionAttributeNames:  { '#r': 'role' },
    ExpressionAttributeValues: { ':admin': 'ADMIN' },
    ProjectionExpression: 'userId',
  }));
  return (result.Count ?? 0) > 0;
}

// ── rate limiter (mounted before the routes below) ─────────────────────────────
const setupRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many bootstrap attempts. Try again later.' },
});
router.use(setupRateLimiter);

// ── POST /api/setup/request ────────────────────────────────────────────────────
router.post('/request', asyncHandler(async (req, res) => {
  if (!gateOrDeny(req, res)) return;

  const { name, email } = req.body as { name?: string; email?: string };
  const ip = req.ip;
  const userAgent = req.get('user-agent') ?? undefined;

  if (!email || !email.includes('@')) {
    await audit('request', { ip, email, userAgent, status: 'error', errorMessage: 'invalid email' });
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  if (await adminExists()) {
    await audit('request', { ip, email, userAgent, status: 'blocked_admin_exists' });
    return res.status(409).json({
      error: 'An admin account already exists. Contact your platform administrator to request access.',
    });
  }

  const token     = crypto.randomBytes(40).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

  await docClient.send(new PutCommand({
    TableName: SETUP_TOKENS_TABLE,
    Item: { token, email, name: name ?? '', expiresAt, createdAt: Date.now() },
  }));

  const setupUrl = `${APP_URL}/setup/admin?token=${token}`;
  await EmailService.adminSetupInvite(email, name ?? email, setupUrl);

  await audit('request', { ip, email, userAgent, status: 'ok' });
  res.json({ message: 'Setup link sent. Check your email to complete admin account creation.' });
}));

// ── POST /api/setup/complete ───────────────────────────────────────────────────
router.post('/complete', asyncHandler(async (req, res) => {
  if (!gateOrDeny(req, res)) return;

  const { token, password } = req.body as { token?: string; password?: string };
  const ip = req.ip;
  const userAgent = req.get('user-agent') ?? undefined;

  if (!token || !password) {
    await audit('complete', { ip, userAgent, status: 'error', errorMessage: 'missing fields' });
    return res.status(400).json({ error: 'Token and password are required.' });
  }
  if (password.length < 8) {
    await audit('complete', { ip, userAgent, status: 'error', errorMessage: 'password too short' });
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const result = await docClient.send(new GetCommand({ TableName: SETUP_TOKENS_TABLE, Key: { token } }));
  const record = result.Item;

  if (!record) {
    await audit('complete', { ip, userAgent, status: 'blocked_bad_token' });
    return res.status(400).json({ error: 'Invalid setup link.' });
  }
  if (record.expiresAt < Date.now()) {
    await docClient.send(new DeleteCommand({ TableName: SETUP_TOKENS_TABLE, Key: { token } }));
    await audit('complete', { ip, email: record.email, userAgent, status: 'blocked_expired' });
    return res.status(400).json({ error: 'This setup link has expired. Request a new one.' });
  }

  // Atomic admin uniqueness — write the singleton marker first with a
  // conditional put. If two requests race, only one passes. The losing
  // request gets ConditionalCheckFailedException → we return 409.
  const now = Date.now();
  try {
    await docClient.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: {
        userId:    ADMIN_SINGLETON_USER_ID,
        role:      'ADMIN',
        markerFor: 'platform-admin-singleton',
        createdAt: now,
      },
      ConditionExpression: 'attribute_not_exists(userId)',
    }));
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      await docClient.send(new DeleteCommand({ TableName: SETUP_TOKENS_TABLE, Key: { token } }));
      await audit('complete', { ip, email: record.email, userAgent, status: 'blocked_race' });
      return res.status(409).json({
        error: 'An admin already exists. This setup link is no longer valid.',
      });
    }
    throw err;
  }

  // We hold the singleton lock; create the real ADMIN user record.
  const passwordHash = await bcrypt.hash(password, 12);
  const userId       = uuidv4();

  await docClient.send(new PutCommand({
    TableName: USERS_TABLE,
    Item: {
      userId,
      email:        record.email,
      displayName:  record.name || 'Admin',
      passwordHash,
      role:         'ADMIN',
      status:       'ACTIVE',
      createdAt:    now,
      updatedAt:    now,
    },
  }));

  // Burn the token and audit success.
  await docClient.send(new DeleteCommand({ TableName: SETUP_TOKENS_TABLE, Key: { token } }));
  EmailService.welcome(record.email, 'ADMIN').catch(() => {});
  await audit('complete', { ip, email: record.email, userAgent, status: 'ok' });

  res.json({ message: 'Admin account created successfully. You can now sign in.' });
}));

// ── GET /api/setup/status ──────────────────────────────────────────────────────
// Returns 404 when bootstrap is disabled (default in production).
router.get('/status', asyncHandler(async (_req, res) => {
  if (!isAllowed()) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ adminExists: await adminExists() });
}));

export default router;
