/**
 * Audit v6 M1 - AML backfill for already-verified entities.
 *
 * Before AML_REQUIRED is flipped on in prod, every VERIFIED carrier/driver must
 * carry a real amlStatus - otherwise the flipped gate would immediately
 * un-verify them (they currently have amlStatus=undefined). This script finds
 * VERIFIED verification records with no definitive amlStatus and screens each
 * one through the SAME screenEntityAml the post-KYB/IDV webhook uses (Didit AML).
 *
 * Dry-run by default: lists what it WOULD screen, makes no external calls and no
 * writes, and never prints the screened person's name. Pass --apply to run the
 * real AML screens and persist amlStatus.
 *
 * Requires: AWS creds, DYNAMODB_VERIFICATIONS_TABLE (or the default), DIDIT_API_KEY.
 * Run: node -r ts-node-dev/node_modules/ts-node/register/transpile-only \
 *        scripts/backfillAml.ts [--apply]
 */
import 'dotenv/config';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../src/config/aws';
import { screenEntityAml, EntityType } from '../src/services/verification';

const TABLE = process.env.DYNAMODB_VERIFICATIONS_TABLE || 'LoadLead_Verifications';
const STATUS_INDEX = 'status-index';
const APPLY = process.argv.includes('--apply');

type Row = { entityId: string; entityType: EntityType; amlStatus?: string };

async function main(): Promise<void> {
  const res = await docClient.send(new QueryCommand({
    TableName: TABLE,
    IndexName: STATUS_INDEX,
    KeyConditionExpression: 'verificationStatus = :s',
    ExpressionAttributeValues: { ':s': 'VERIFIED' },
  }));
  const rows = (res.Items ?? []) as Row[];
  const need = rows.filter((r) => r.amlStatus !== 'pass' && r.amlStatus !== 'fail');

  console.log(`Table ${TABLE}: ${rows.length} VERIFIED, ${need.length} without a definitive amlStatus.`);
  if (!need.length) {
    console.log('Nothing to backfill. (Every verified entity already has a pass/fail amlStatus.)');
    return;
  }

  for (const r of need) {
    if (!APPLY) {
      console.log(`  [dry-run] would screen ${r.entityType} ${r.entityId} (current amlStatus=${r.amlStatus ?? 'none'})`);
      continue;
    }
    try {
      const result = await screenEntityAml(r.entityId, r.entityType);
      console.log(`  screened ${r.entityType} ${r.entityId} -> amlStatus=${result ?? 'SKIPPED (no name resolved)'}`);
    } catch (err) {
      console.error(`  FAILED ${r.entityType} ${r.entityId}:`, err);
    }
  }

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to screen for real and persist amlStatus.');
    console.log('Do this BEFORE flipping AML_REQUIRED=true, and confirm each entity ends up amlStatus=pass.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
