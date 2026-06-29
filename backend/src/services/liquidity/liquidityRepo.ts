/**
 * DynamoDB access for beta loads, adapted to the LoadLead schema.
 *
 * The CONFIG block below is mapped to the real LoadLead_Loads item shape found
 * in discovery: timestamps are stored as epoch milliseconds (numbers), not ISO
 * strings, so this adapter converts between the two. The pure metric math in
 * liquidityMetrics.ts is unchanged and still consumes ISO strings.
 *
 * Covered logic: a load counts as covered when its status is one of
 * coveredStatuses, or when it has an assignedAt timestamp.
 *
 * No suitable time based GSI exists on LoadLead_Loads (only a status-index), so
 * this uses a scan with a createdAt range filter. That is fine at beta volume.
 * TODO before scale: add a GSI keyed for range queries on the numeric createdAt
 * (for example a constant partition key plus createdAt as the numeric sort key)
 * and set useScanFallback to false.
 */

import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/aws";
import type { LoadRecord } from "./liquidityMetrics";

// ---------------------------------------------------------------------------
// Mapped to the real LoadLead_Loads schema. Change only this block to re-point.
// ---------------------------------------------------------------------------
const CONFIG = {
  tableName: process.env.DYNAMODB_LOADS_TABLE ?? "LoadLead_Loads",

  // A GSI that range queries loads by time. LoadLead_Loads does not have one
  // yet (only a status-index), so the scan fallback below is used.
  index: {
    name: process.env.LOADS_TIME_INDEX ?? "gsi1",
    partitionKeyName: "gsi1pk",
    partitionKeyValue: "LOAD",
    sortKeyName: "gsi1sk", // would hold the numeric createdAt if the GSI existed
  },

  // No time GSI on LoadLead_Loads, so scan. Switch to the index before scale.
  useScanFallback: true,

  // Attribute names on the LoadLead_Loads item. Right hand side is the real name.
  attr: {
    loadId: "loadId",
    originCity: "pickupCity",
    destCity: "deliveryCity",
    lane: "lane", // not present on Load; lane is derived from pickup and delivery city
    equipment: "equipmentType",
    postedAt: "createdAt", // epoch ms number, set when the load is created
    coveredAt: "assignedAt", // epoch ms number, set when a driver is assigned
    status: "status",
    carrierId: "assignedDriverId",
    broadcastCount: "offeredDriverCount",
    // No-show and trust-incident are NOT Load fields. They live in the
    // BetaTrustEvents store and the liquidity route overrides the two dials from
    // BetaTrustEventService.getCounts. These mappings stay absent (read as false)
    // on purpose; the store is the source of truth.
    noShow: "noShow",
    trustIncident: "trustIncident",
  },

  // A LoadLead_Loads status that counts as covered (a carrier took the load).
  coveredStatuses: ["BOOKED", "IN_TRANSIT", "DELIVERED"],
};

// Reuse the app's shared DynamoDB document client (config/aws.ts) so this honors
// the same region, credentials, and DYNAMODB_ENDPOINT (DynamoDB Local in dev) as
// every other query. Do not instantiate a separate client here.
const ddb = docClient;

/** LoadLead stores timestamps as epoch ms numbers. Convert to ISO for the metrics. */
function epochToIso(value: unknown): string | null {
  if (value == null) return null;
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function deriveLane(item: Record<string, any>): string {
  const explicit = item[CONFIG.attr.lane];
  if (explicit) return String(explicit);
  const o = item[CONFIG.attr.originCity];
  const d = item[CONFIG.attr.destCity];
  return o && d ? `${o} to ${d}` : "Unknown lane";
}

function isCovered(item: Record<string, any>): boolean {
  const status = item[CONFIG.attr.status];
  if (status && CONFIG.coveredStatuses.includes(String(status))) return true;
  return Boolean(item[CONFIG.attr.coveredAt]);
}

export function mapItemToLoad(item: Record<string, any>): LoadRecord {
  return {
    loadId: String(item[CONFIG.attr.loadId] ?? ""),
    lane: deriveLane(item),
    equipment: item[CONFIG.attr.equipment] ? String(item[CONFIG.attr.equipment]) : undefined,
    postedAt: epochToIso(item[CONFIG.attr.postedAt]) ?? "",
    coveredAt: epochToIso(item[CONFIG.attr.coveredAt]),
    covered: isCovered(item),
    carrierId: item[CONFIG.attr.carrierId] ? String(item[CONFIG.attr.carrierId]) : null,
    broadcastCount:
      typeof item[CONFIG.attr.broadcastCount] === "number" ? item[CONFIG.attr.broadcastCount] : undefined,
    noShow: Boolean(item[CONFIG.attr.noShow]),
    trustIncident: Boolean(item[CONFIG.attr.trustIncident]),
  };
}

/**
 * Fetch every load posted between fromIso and toIso (inclusive), handling
 * pagination. The repo stores createdAt as an epoch ms number, so the range
 * bounds are converted to numbers for the query and filter.
 */
export async function getLoadsInRange(fromIso: string, toIso: string): Promise<LoadRecord[]> {
  const items: Record<string, any>[] = [];
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);

  if (CONFIG.useScanFallback) {
    // Scan fallback: filters on the numeric createdAt. Fine for beta volume.
    let lastKey: Record<string, any> | undefined = undefined;
    do {
      const out: any = await ddb.send(
        new ScanCommand({
          TableName: CONFIG.tableName,
          FilterExpression: "#p BETWEEN :from AND :to",
          ExpressionAttributeNames: { "#p": CONFIG.attr.postedAt },
          ExpressionAttributeValues: { ":from": fromMs, ":to": toMs },
          ExclusiveStartKey: lastKey,
        })
      );
      items.push(...(out.Items ?? []));
      lastKey = out.LastEvaluatedKey;
    } while (lastKey);
  } else {
    let lastKey: Record<string, any> | undefined = undefined;
    do {
      const out: any = await ddb.send(
        new QueryCommand({
          TableName: CONFIG.tableName,
          IndexName: CONFIG.index.name,
          KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :from AND :to",
          ExpressionAttributeNames: {
            "#pk": CONFIG.index.partitionKeyName,
            "#sk": CONFIG.index.sortKeyName,
          },
          ExpressionAttributeValues: {
            ":pk": CONFIG.index.partitionKeyValue,
            ":from": fromMs,
            ":to": toMs,
          },
          ExclusiveStartKey: lastKey,
        })
      );
      items.push(...(out.Items ?? []));
      lastKey = out.LastEvaluatedKey;
    } while (lastKey);
  }

  return items.map(mapItemToLoad).filter((l) => l.loadId && l.postedAt);
}
