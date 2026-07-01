// Re-seed known passwords onto the disposable beta test accounts, so they are
// reproducible and documentable. Targets ONLY the test.*@loadleadapp.com
// accounts by design; it never touches real/personal accounts.
//
// Targets PROD by default: it uses the ambient AWS credential chain (your
// configured profile) and no DYNAMODB_ENDPOINT, so it hits real DynamoDB. It
// looks each account up precisely via the email-index GSI (no full-table scan)
// and overwrites passwordHash with the bcrypt hash of SEED_PASSWORD.
//
// Safe by default: a dry run that only reports what it would change. Set APPLY=1
// to actually write.
//
//   SEED_PASSWORD=... node scripts/reseedBetaPasswords.mjs            # dry run
//   SEED_PASSWORD=... APPLY=1 node scripts/reseedBetaPasswords.mjs    # write to prod
//
// SEED_PASSWORD is REQUIRED and is deliberately not hardcoded here, so the live
// prod credential never lands in git. The documented value lives in the
// gitignored CREDENTIALS.md.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import bcrypt from "bcryptjs";

const region = process.env.AWS_REGION || "us-east-1";
const USERS_TABLE = process.env.DYNAMODB_USERS_TABLE || "LoadLead_Users";
const PASSWORD = process.env.SEED_PASSWORD;
const APPLY = process.env.APPLY === "1";

if (!PASSWORD) {
  console.error("SEED_PASSWORD is required (see CREDENTIALS.md). Aborting.");
  process.exit(1);
}

// Disposable beta test accounts only. Personal accounts are intentionally excluded.
const TARGET_EMAILS = [
  "test.driver@loadleadapp.com",
  "test.shipper@loadleadapp.com",
  "test.receiver@loadleadapp.com",
];

// Ambient credentials (no hardcoded local creds), no endpoint => real AWS/prod.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

async function findByEmail(email) {
  const r = await ddb.send(
    new QueryCommand({
      TableName: USERS_TABLE,
      IndexName: "email-index",
      KeyConditionExpression: "email = :e",
      ExpressionAttributeValues: { ":e": email },
      Limit: 1,
    })
  );
  return r.Items?.[0] ?? null;
}

console.log(`Mode: ${APPLY ? "APPLY (writing to prod)" : "DRY RUN (no writes)"}`);
console.log(`Table: ${USERS_TABLE}  Region: ${region}`);
console.log(`Password to set: ${PASSWORD}\n`);

let updated = 0;
let missing = 0;

for (const email of TARGET_EMAILS) {
  const user = await findByEmail(email);
  if (!user) {
    console.log(`- not found: ${email} (skipped)`);
    missing++;
    continue;
  }
  if (!user.userId) {
    console.log(`- ${email}: found but missing userId key (skipped)`);
    missing++;
    continue;
  }
  if (!APPLY) {
    console.log(`~ would set passwordHash for ${email} (userId ${user.userId}, role ${user.role})`);
    continue;
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await ddb.send(
    new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId: user.userId },
      UpdateExpression: "SET passwordHash = :ph, updatedAt = :u",
      ExpressionAttributeValues: { ":ph": passwordHash, ":u": Date.now() },
    })
  );
  console.log(`✅ set passwordHash for ${email} (userId ${user.userId}, role ${user.role})`);
  updated++;
}

console.log(`\nDone. ${APPLY ? `Updated ${updated}` : `Would update ${TARGET_EMAILS.length - missing}`}, missing ${missing}.`);
if (!APPLY) console.log("Re-run with APPLY=1 to write.");
