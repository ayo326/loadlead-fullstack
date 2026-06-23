#!/usr/bin/env node
// LoadLead ADMIN MFA out-of-band enrollment CLI.
//
// IAM-5 makes 2FA mandatory at login for any user with role=ADMIN: a
// password alone gets 403 MFA_REQUIRED. Existing ADMIN accounts that
// predate that change cannot enroll via the UI (they can't sign in to
// reach Settings -> 2FA). This script is the canonical recovery path:
// it generates the TOTP secret, writes it, prompts for the first code
// from the authenticator app, verifies, and flips twoFactorEnabled.
//
// Usage:
//   node backend/scripts/bootstrap2fa.mjs --email <admin email>
//
// Requires AWS credentials in the environment. Refuses to run unless
// the target user has role=ADMIN. Refuses to overwrite an existing
// enrollment without --force.

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { generateSecret, generateURI, verify } from 'otplib';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => {
    if (!a.startsWith('--')) return null;
    const key = a.slice(2);
    const next = arr[i + 1];
    return [key, next && !next.startsWith('--') ? next : true];
  }).filter(Boolean),
);

const EMAIL = args.email;
const FORCE = !!args.force;
const TABLE = process.env.DYNAMODB_USERS_TABLE || 'LoadLead_Users';

if (!EMAIL) {
  console.error('usage: node backend/scripts/bootstrap2fa.mjs --email <admin email>');
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function findUserByEmail(email) {
  const out = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: '#e = :v',
    ExpressionAttributeNames: { '#e': 'email' },
    ExpressionAttributeValues: { ':v': email },
  }));
  return (out.Items ?? [])[0] ?? null;
}

const user = await findUserByEmail(EMAIL);
if (!user)            { console.error(`no user found with email ${EMAIL}`); process.exit(1); }
if (user.role !== 'ADMIN') {
  console.error(`refusing: user ${EMAIL} has role ${user.role}, not ADMIN`);
  process.exit(1);
}
if (user.twoFactorEnabled && !FORCE) {
  console.error(`refusing: ${EMAIL} already has 2FA enrolled. Pass --force to re-enroll.`);
  process.exit(1);
}

const secret = generateSecret();
const otpauthUrl = generateURI({ label: EMAIL, issuer: 'LoadLead', secret });

// Persist the secret immediately so a crash mid-enrollment doesn't
// leave the row in an inconsistent state. We flip twoFactorEnabled
// only AFTER a successful TOTP verification below.
await ddb.send(new UpdateCommand({
  TableName: TABLE,
  Key: { userId: user.userId },
  UpdateExpression: 'SET twoFactorSecret = :s, twoFactorEnabled = :e, updatedAt = :u',
  ExpressionAttributeValues: { ':s': secret, ':e': false, ':u': Date.now() },
}));

console.log('');
console.log('  ── 2FA enrollment for', EMAIL, '──');
console.log('');
console.log('  1. Open your authenticator app (Google Authenticator, 1Password, Authy, etc).');
console.log('  2. Add a new entry by scanning this URL as a QR code, OR paste the secret manually:');
console.log('');
console.log('     otpauth URL:  ' + otpauthUrl);
console.log('     secret:       ' + secret);
console.log('');
console.log('  3. The app will show a 6-digit code that rotates every 30 seconds.');
console.log('     Type the CURRENT code below to confirm enrollment.');
console.log('');

const rl = readline.createInterface({ input: stdin, output: stdout });
const code = (await rl.question('  6-digit code: ')).trim();
rl.close();

if (!/^\d{6}$/.test(code)) {
  console.error('  refusing: code must be 6 digits');
  process.exit(1);
}

const valid = verify({ token: code, secret });
if (!valid) {
  console.error('');
  console.error('  ✗ code did not verify. Try again (re-run the same command).');
  process.exit(1);
}

await ddb.send(new UpdateCommand({
  TableName: TABLE,
  Key: { userId: user.userId },
  UpdateExpression: 'SET twoFactorEnabled = :e, updatedAt = :u',
  ExpressionAttributeValues: { ':e': true, ':u': Date.now() },
}));

console.log('');
console.log('  ✓ 2FA enrolled.');
console.log('');
console.log('  You can now sign in at https://admin.loadleadapp.com/login with:');
console.log('    email:     ' + EMAIL);
console.log('    password:  (whatever was set in DynamoDB; if unknown, reset via the change-password flow)');
console.log('    2FA code:  the 6-digit code from your authenticator app');
console.log('');
