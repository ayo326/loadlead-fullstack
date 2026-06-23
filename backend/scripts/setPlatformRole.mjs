#!/usr/bin/env node
// Set or change a platform-staff tier on an existing ADMIN-role user.
//
// Usage:
//   node backend/scripts/setPlatformRole.mjs --email <e> --tier <t>
//
//   tier ∈ STAFF_ADMIN | STAFF_MANAGER | STAFF_SUPERVISOR | STAFF_TEAM_LEAD
//
// Refuses if the target isn't ADMIN role. Refuses an invalid tier.
// Idempotent: setting the same tier twice is a no-op.

import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const VALID = ['STAFF_ADMIN', 'STAFF_MANAGER', 'STAFF_SUPERVISOR', 'STAFF_TEAM_LEAD'];

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => {
    if (!a.startsWith('--')) return [];
    const next = arr[i + 1];
    return [[a.slice(2), next && !next.startsWith('--') ? next : true]];
  }),
);

const EMAIL = args.email;
const TIER  = args.tier;
const TABLE = process.env.DYNAMODB_USERS_TABLE || 'LoadLead_Users';

if (!EMAIL || !TIER) {
  console.error('usage: node backend/scripts/setPlatformRole.mjs --email <e> --tier <STAFF_*>');
  process.exit(1);
}
if (!VALID.includes(TIER)) {
  console.error(`invalid tier: ${TIER}. one of: ${VALID.join(', ')}`);
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const out = await ddb.send(new ScanCommand({
  TableName: TABLE,
  FilterExpression: '#e = :v',
  ExpressionAttributeNames: { '#e': 'email' },
  ExpressionAttributeValues: { ':v': EMAIL },
}));
const user = (out.Items ?? [])[0];

if (!user)              { console.error(`no user found with email ${EMAIL}`); process.exit(1); }
if (user.role !== 'ADMIN') {
  console.error(`refusing: ${EMAIL} has role ${user.role}, not ADMIN. Set role=ADMIN first.`);
  process.exit(1);
}
if (user.platformRole === TIER) {
  console.log(`already at tier ${TIER}; nothing to do.`);
  process.exit(0);
}

await ddb.send(new UpdateCommand({
  TableName: TABLE,
  Key: { userId: user.userId },
  UpdateExpression: 'SET platformRole = :t, updatedAt = :u',
  ExpressionAttributeValues: { ':t': TIER, ':u': Date.now() },
}));

console.log(`✓ ${EMAIL}: platformRole ${user.platformRole ?? '(unset)'} → ${TIER}`);
