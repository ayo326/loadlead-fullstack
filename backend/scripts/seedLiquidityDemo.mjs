#!/usr/bin/env node
/**
 * Seed or purge realistic Lane Liquidity demo data.
 *
 * Usage (from backend/):
 *   node scripts/seedLiquidityDemo.mjs seed     # replace SEED-* demo data with a fresh set
 *   node scripts/seedLiquidityDemo.mjs purge    # delete the SEED-* demo data only
 *
 * Target: AWS by default (AWS_REGION or us-east-1; tables LoadLead_Loads and
 * LoadLead_BetaTrustEvents, overridable via DYNAMODB_LOADS_TABLE /
 * DYNAMODB_BETA_TRUST_EVENTS_TABLE). Set DYNAMODB_ENDPOINT to point at DynamoDB Local.
 *
 * SAFE BY DESIGN: only ever reads/writes/deletes rows whose id begins with "SEED-".
 * Real loads and real trust events are never touched, so this is safe to run even
 * once real loads exist. Re-running replaces (deterministic ids), never duplicates.
 *
 * Field mapping matches liquidityRepo CONFIG:
 *   createdAt=postedAt, assignedAt=coveredAt, status (coveredStatuses), pickupCity +
 *   deliveryCity=lane, assignedDriverId=carrierId, offeredDriverCount=broadcastCount.
 * No noShow/trustIncident on the Load model; no-shows live in the trust store and
 * reference a load + carrier by id only.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const LOADS = process.env.DYNAMODB_LOADS_TABLE || "LoadLead_Loads";
const TRUST = process.env.DYNAMODB_BETA_TRUST_EVENTS_TABLE || "LoadLead_BetaTrustEvents";
const ENDPOINT = process.env.DYNAMODB_ENDPOINT || undefined;
const PREFIX = "SEED-";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION, endpoint: ENDPOINT }),
  { marshallOptions: { removeUndefinedValues: true } }
);

const DAY = 86400000, HOUR = 3600000;
const COVERED_STATUSES = ["DELIVERED", "IN_TRANSIT", "BOOKED"];

const mondayUTC = (d) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(x.getTime() - ((x.getUTCDay() + 6) % 7) * DAY);
};

const LANES = {
  AH: { pickup: "Austin", delivery: "Houston" },
  ADF: { pickup: "Austin", delivery: "Dallas-Fort Worth" },
  ASA: { pickup: "Austin", delivery: "San Antonio" },
  DFH: { pickup: "Dallas-Fort Worth", delivery: "Houston" },
  SAH: { pickup: "San Antonio", delivery: "Houston" },
};

// Per lane, weekly [posted, covered, ttcHours] for weeks 0 (oldest) .. 5 (recent).
// Austin to Houston is the primary; its fill rises and time-to-cover falls over time.
const PLAN = {
  AH: [[2, 1, 5.0], [2, 1, 4.4], [3, 2, 3.8], [3, 2, 3.2], [4, 3, 2.6], [4, 3, 2.0]],
  ADF: [[1, 0, 0], [1, 1, 3.5], [2, 1, 3.0], [1, 1, 2.8], [2, 1, 2.5], [2, 2, 2.2]],
  ASA: [[1, 1, 1.5], [1, 0, 0], [1, 1, 1.2], [2, 1, 1.0], [1, 1, 0.8], [2, 1, 0.7]],
  DFH: [[1, 0, 0], [1, 1, 4.5], [1, 0, 0], [2, 1, 4.0], [1, 1, 3.5], [2, 1, 3.0]],
  SAH: [[1, 1, 4.0], [1, 0, 0], [1, 1, 3.5], [1, 1, 3.0], [1, 0, 0], [2, 2, 2.8]],
};

function buildLoads(now = new Date()) {
  const baseMonday = mondayUTC(now).getTime() - 6 * 7 * DAY; // week 5 == last full week (all past)
  const loads = [];
  let carrierN = 0;
  for (const [code, weeks] of Object.entries(PLAN)) {
    const { pickup, delivery } = LANES[code];
    weeks.forEach(([posted, covered, ttcH], w) => {
      const weekStart = baseMonday + w * 7 * DAY;
      for (let i = 0; i < posted; i++) {
        const day = i % 5; // Mon..Fri
        const hour = 8 + ((i * 3 + w) % 9); // business hours 8..16
        const min = (i * 17 + w * 7) % 60;
        const createdAt = weekStart + day * DAY + hour * HOUR + min * 60000;
        const isCovered = i < covered;
        const ttc = Math.max(0.5, ttcH + ((i % 3) - 1) * 0.25);
        const load = {
          loadId: `${PREFIX}${code}-w${w}-${i + 1}`,
          seedTag: "SEED-liquidity-demo",
          referenceNumber: `${PREFIX}${code}-${w}${i + 1}`,
          pickupCity: pickup,
          deliveryCity: delivery,
          status: isCovered ? COVERED_STATUSES[i % COVERED_STATUSES.length] : "OPEN",
          createdAt,
          updatedAt: createdAt,
          offeredDriverCount: 8 + ((w * 5 + i * 7) % 18), // 8..25
        };
        if (isCovered) {
          load.assignedAt = createdAt + ttc * HOUR; // coveredAt, never equal to postedAt
          load.assignedDriverId = `${PREFIX}carrier-${(carrierN++ % 6) + 1}`;
        }
        loads.push(load);
      }
    });
  }
  return loads;
}

function buildTrustEvents(loads, now = Date.now()) {
  const coveredAH = loads.filter((l) => l.loadId.startsWith(`${PREFIX}AH`) && l.assignedAt);
  return [
    { eventId: `${PREFIX}btrust-1`, eventType: "NO_SHOW", loadId: coveredAH[0].loadId, carrierId: coveredAH[0].assignedDriverId, recordedByAdminId: "SEED-admin", recordedAt: now - 26 * HOUR, note: "demo no-show" },
    { eventId: `${PREFIX}btrust-2`, eventType: "NO_SHOW", loadId: coveredAH[1].loadId, carrierId: coveredAH[1].assignedDriverId, recordedByAdminId: "SEED-admin", recordedAt: now - 50 * HOUR, note: "demo no-show" },
  ];
}

async function scanSeedKeys(table, idAttr) {
  const keys = [];
  let start;
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: table,
      FilterExpression: "begins_with(#id, :p)",
      ExpressionAttributeNames: { "#id": idAttr },
      ExpressionAttributeValues: { ":p": PREFIX },
      ProjectionExpression: "#id",
      ExclusiveStartKey: start,
    }));
    for (const it of out.Items ?? []) keys.push({ [idAttr]: it[idAttr] });
    start = out.LastEvaluatedKey;
  } while (start);
  return keys;
}

async function batchDelete(table, keys) {
  for (let i = 0; i < keys.length; i += 25) {
    await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } }));
  }
}
async function batchPut(table, items) {
  for (let i = 0; i < items.length; i += 25) {
    await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) } }));
  }
}

async function purge() {
  const loadKeys = await scanSeedKeys(LOADS, "loadId");
  const trustKeys = await scanSeedKeys(TRUST, "eventId");
  if (loadKeys.length) await batchDelete(LOADS, loadKeys);
  if (trustKeys.length) await batchDelete(TRUST, trustKeys);
  console.log(`purged ${loadKeys.length} SEED-* loads + ${trustKeys.length} SEED-* trust events`);
}

async function seed() {
  await purge(); // replace, never duplicate
  const loads = buildLoads();
  const trust = buildTrustEvents(loads);
  await batchPut(LOADS, loads);
  await batchPut(TRUST, trust);
  const covered = loads.filter((l) => l.assignedAt).length;
  console.log(`seeded ${loads.length} SEED-* loads (${covered} covered, ${loads.length - covered} uncovered) + ${trust.length} no-show events (0 trust incidents)`);
}

const cmd = process.argv[2];
if (cmd !== "seed" && cmd !== "purge") {
  console.error("usage: node scripts/seedLiquidityDemo.mjs <seed|purge>");
  process.exit(2);
}
console.log(`Lane Liquidity demo ${cmd} -> table ${LOADS} / ${TRUST} @ ${ENDPOINT || `AWS ${REGION}`} (SEED-* only)`);
(cmd === "seed" ? seed() : purge()).then(() => console.log("done")).catch((e) => { console.error(e); process.exit(1); });
