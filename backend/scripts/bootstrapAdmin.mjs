#!/usr/bin/env node
// LoadLead platform-ADMIN bootstrap CLI.
//
// The canonical and only-supported way to provision the first platform admin.
// The /api/setup HTTP routes are disabled by default and return 404 in prod;
// this script is the path documented in backend/scripts/README.md.
//
// Usage:
//   node backend/scripts/bootstrapAdmin.mjs \
//     --email <e> --name "<Display Name>" --password <strong-pw>
//
// Or interactively (prompted password):
//   node backend/scripts/bootstrapAdmin.mjs --email <e> --name "<Display Name>"
//
// Requires AWS credentials in the environment (the same DynamoDB you'll
// log into). Refuses to run twice: an existing ADMIN aborts the script.

import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import readline from 'node:readline';

const USERS_TABLE =
  process.env.DYNAMODB_USERS_TABLE || 'LoadLead_Users';
const REGION   = process.env.AWS_REGION || 'us-east-1';
const ENDPOINT =
  process.env.DYNAMODB_ENDPOINT ||
  process.env.AWS_DYNAMODB_ENDPOINT ||
  undefined;
const ADMIN_SINGLETON_USER_ID = '__admin_singleton__';

const args = parseArgs(process.argv.slice(2));
if (!args.email) {
  console.error('error: --email is required.');
  process.exit(2);
}

const password = args.password ?? (await promptPassword());
if (!password || password.length < 8) {
  console.error('error: password must be at least 8 characters.');
  process.exit(2);
}

const client = new DynamoDBClient({
  region: REGION,
  ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
});
const ddb = DynamoDBDocumentClient.from(client);

console.log(`Connecting to DynamoDB (region ${REGION}${ENDPOINT ? `, endpoint ${ENDPOINT}` : ''})`);

// Atomicity check 1: the singleton marker.
const marker = await ddb.send(new GetCommand({
  TableName: USERS_TABLE,
  Key: { userId: ADMIN_SINGLETON_USER_ID },
}));
if (marker.Item) {
  console.error('refusing: admin singleton marker already exists.');
  process.exit(1);
}

// Atomicity check 2: fallback scan for any pre-singleton admin.
const scan = await ddb.send(new ScanCommand({
  TableName: USERS_TABLE,
  FilterExpression: '#r = :admin',
  ExpressionAttributeNames:  { '#r': 'role' },
  ExpressionAttributeValues: { ':admin': 'ADMIN' },
  ProjectionExpression: 'userId',
}));
if ((scan.Count ?? 0) > 0) {
  console.error(`refusing: ${scan.Count} ADMIN row(s) already exist.`);
  process.exit(1);
}

const now = Date.now();

// Write the singleton with a conditional put. If another writer (CLI or
// route) raced us, we lose loudly.
try {
  await ddb.send(new PutCommand({
    TableName: USERS_TABLE,
    Item: {
      userId:    ADMIN_SINGLETON_USER_ID,
      role:      'ADMIN',
      markerFor: 'platform-admin-singleton',
      createdAt: now,
    },
    ConditionExpression: 'attribute_not_exists(userId)',
  }));
} catch (err) {
  if (err?.name === 'ConditionalCheckFailedException') {
    console.error('lost the race: another bootstrap attempt won. Aborting.');
    process.exit(1);
  }
  throw err;
}

const passwordHash = await bcrypt.hash(password, 12);
const userId = uuidv4();

await ddb.send(new PutCommand({
  TableName: USERS_TABLE,
  Item: {
    userId,
    email:        args.email,
    displayName:  args.name ?? 'Admin',
    passwordHash,
    role:         'ADMIN',
    status:       'ACTIVE',
    createdAt:    now,
    updatedAt:    now,
  },
}));

console.log(`✓ ADMIN created`);
console.log(`  userId : ${userId}`);
console.log(`  email  : ${args.email}`);
console.log(`  display: ${args.name ?? 'Admin'}`);

// ── helpers ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email')    out.email    = argv[++i];
    else if (a === '--name') out.name    = argv[++i];
    else if (a === '--password') out.password = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('usage: node bootstrapAdmin.mjs --email <e> [--name <n>] [--password <p>]');
      process.exit(0);
    }
  }
  return out;
}

function promptPassword() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('password: ', (pw) => { rl.close(); resolve(pw); });
  });
}
