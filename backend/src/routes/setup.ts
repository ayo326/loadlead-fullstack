/**
 * /api/setup — One-time admin bootstrap
 *
 * POST /api/setup/request
 *   - Checks if any ADMIN user exists in the system
 *   - If none: generates a 24-hour single-use token and emails the setup link
 *   - If one already exists: returns 409 so the UI can show "contact your admin"
 *
 * POST /api/setup/complete
 *   - Validates the token, creates the ADMIN account, burns the token
 */

import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '../config/aws';
import { PutCommand, GetCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { asyncHandler } from '../middleware/errorHandler';
import { EmailService } from '../services/emailService';

const router = express.Router();

const USERS_TABLE       = process.env.DYNAMODB_USERS_TABLE        || 'LoadLead_Users';
const SETUP_TOKENS_TABLE = process.env.DYNAMODB_SETUP_TOKENS_TABLE || 'LoadLead_SetupTokens';
const APP_URL           = process.env.APP_URL                     || 'https://loadleadapp.com';

// ── helpers ────────────────────────────────────────────────────────────────────

async function adminExists(): Promise<boolean> {
  // NOTE: Limit applies before FilterExpression in DynamoDB, so we cannot use Limit: 1 here.
  // We scan with no Limit and stop as soon as we find one ADMIN (via ProjectionExpression to save RCUs).
  const result = await docClient.send(new ScanCommand({
    TableName: USERS_TABLE,
    FilterExpression: '#r = :admin',
    ExpressionAttributeNames:  { '#r': 'role' },
    ExpressionAttributeValues: { ':admin': 'ADMIN' },
    ProjectionExpression: 'userId',
  }));
  return (result.Count ?? 0) > 0;
}

// ── POST /api/setup/request ────────────────────────────────────────────────────

router.post('/request', asyncHandler(async (req, res) => {
  const { name, email } = req.body as { name?: string; email?: string };

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  // Block if admin already exists
  if (await adminExists()) {
    return res.status(409).json({
      error: 'An admin account already exists. Contact your platform administrator to request access.',
    });
  }

  // Generate single-use token (24 h TTL)
  const token     = crypto.randomBytes(40).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

  await docClient.send(new PutCommand({
    TableName: SETUP_TOKENS_TABLE,
    Item: { token, email, name: name ?? '', expiresAt, createdAt: Date.now() },
  }));

  const setupUrl = `${APP_URL}/setup/admin?token=${token}`;
  await EmailService.adminSetupInvite(email, name ?? email, setupUrl);

  res.json({ message: 'Setup link sent. Check your email to complete admin account creation.' });
}));

// ── POST /api/setup/complete ───────────────────────────────────────────────────

router.post('/complete', asyncHandler(async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  // Validate token
  const result = await docClient.send(new GetCommand({ TableName: SETUP_TOKENS_TABLE, Key: { token } }));
  const record = result.Item;

  if (!record) {
    return res.status(400).json({ error: 'Invalid setup link.' });
  }
  if (record.expiresAt < Date.now()) {
    await docClient.send(new DeleteCommand({ TableName: SETUP_TOKENS_TABLE, Key: { token } }));
    return res.status(400).json({ error: 'This setup link has expired. Request a new one.' });
  }

  // Double-check no admin slipped in during the window
  if (await adminExists()) {
    await docClient.send(new DeleteCommand({ TableName: SETUP_TOKENS_TABLE, Key: { token } }));
    return res.status(409).json({ error: 'An admin already exists. This setup link is no longer valid.' });
  }

  // Create admin user
  const passwordHash = await bcrypt.hash(password, 12);
  const userId       = uuidv4();
  const now          = Date.now();

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

  // Burn the token
  await docClient.send(new DeleteCommand({ TableName: SETUP_TOKENS_TABLE, Key: { token } }));

  // Send welcome email
  EmailService.welcome(record.email, 'ADMIN').catch(() => {});

  res.json({ message: 'Admin account created successfully. You can now sign in.' });
}));

// ── GET /api/setup/status ──────────────────────────────────────────────────────
// Used by the frontend to decide whether to show "Request Admin" or hide it

router.get('/status', asyncHandler(async (_req, res) => {
  const exists = await adminExists();
  res.json({ adminExists: exists });
}));

export default router;
