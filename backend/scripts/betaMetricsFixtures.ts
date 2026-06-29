/**
 * Shared fixtures + safety guard for the Lane Liquidity (beta metrics) seed,
 * teardown, and verifier scripts.
 *
 * The loads are built with the existing aLoad() test factory so they always
 * match the real Load schema. Ids are fixed (SEEDLIQ-*) so re-seeding upserts
 * the same records rather than duplicating, and teardown removes exactly this
 * set by those ids.
 *
 * The dataset mirrors the demo loads in liquidityMetrics.test.ts (two lanes,
 * four active weeks, the 50/57/67/75 cumulative trend) but anchored to recent
 * weeks relative to now, so the seeded loads fall inside the panel window.
 */

import config from "../src/config/environment";
import { aLoad } from "../tests/fixtures/factories";
import { LoadStatus, type Load } from "../src/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Refuse to run outside an explicitly local, dev, or test environment. */
export function assertSafeEnvironment(scriptName: string): void {
  const allowed = ["development", "dev", "local", "test"];
  const appEnv = (config.appEnv || "").toLowerCase();
  if (!allowed.includes(appEnv)) {
    throw new Error(
      `[${scriptName}] refusing to run: APP_ENV is "${config.appEnv}", not one of ${allowed.join(", ")}. ` +
        `This script writes loads and must never run against prod or staging.`
    );
  }
  // Belt and suspenders: this is a writing/destructive script, so require a
  // non default DynamoDB endpoint (DynamoDB Local) rather than the AWS prod
  // endpoint, unless APP_ENV is test (unit harness uses mocks).
  if (appEnv !== "test" && !config.dynamodb.endpoint) {
    throw new Error(
      `[${scriptName}] refusing to run: DYNAMODB_ENDPOINT is not set. Point it at DynamoDB Local ` +
        `(for example http://127.0.0.1:8000) so this never touches AWS tables.`
    );
  }
}

function mondayUTC(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const back = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - back * DAY_MS);
}

interface WeekSpec {
  lane: string;
  pickupCity: string;
  deliveryCity: string;
  week: number; // 0 is the oldest seeded week
  total: number;
  covered: number;
}

// Same shape as the unit test demo loads: Austin to Houston 4/3/5/4 with
// 2/2/4/4 covered (cumulative 50, 57, 67, 75), and Austin to Dallas-Fort Worth
// 3/3 with 2/3 covered (67 then 83).
const WEEK_SPECS: WeekSpec[] = [
  { lane: "Austin to Houston", pickupCity: "Austin", deliveryCity: "Houston", week: 0, total: 4, covered: 2 },
  { lane: "Austin to Houston", pickupCity: "Austin", deliveryCity: "Houston", week: 1, total: 3, covered: 2 },
  { lane: "Austin to Houston", pickupCity: "Austin", deliveryCity: "Houston", week: 2, total: 5, covered: 4 },
  { lane: "Austin to Houston", pickupCity: "Austin", deliveryCity: "Houston", week: 3, total: 4, covered: 4 },
  { lane: "Austin to Dallas-Fort Worth", pickupCity: "Austin", deliveryCity: "Dallas-Fort Worth", week: 0, total: 3, covered: 2 },
  { lane: "Austin to Dallas-Fort Worth", pickupCity: "Austin", deliveryCity: "Dallas-Fort Worth", week: 1, total: 3, covered: 3 },
];

/** Expected aggregate totals, locked by the verifier. */
export const EXPECTED = {
  loadsPosted: WEEK_SPECS.reduce((a, w) => a + w.total, 0), // 22
  loadsCovered: WEEK_SPECS.reduce((a, w) => a + w.covered, 0), // 17
  lanes: ["Austin to Dallas-Fort Worth", "Austin to Houston"], // sorted
  ttcHours: 3,
};

/** Deterministic fixed ids, anchored to the four most recent COMPLETE weeks. */
export function buildSeedLoads(now = new Date()): Load[] {
  // Start four Mondays back so every seeded load (week 0 to week 3) lands in a
  // past, complete week. Week 3 is last week, never the current partial week, so
  // no load is dated after "now" and the endpoint's createdAt <= now filter keeps
  // all of them.
  const baseMonday = new Date(mondayUTC(now).getTime() - 4 * 7 * DAY_MS); // oldest of 4 weeks
  const loads: Load[] = [];
  for (const spec of WEEK_SPECS) {
    const weekStart = new Date(baseMonday.getTime() + spec.week * 7 * DAY_MS);
    for (let k = 0; k < spec.total; k++) {
      const postedAt = new Date(weekStart.getTime() + (k % 5) * DAY_MS).getTime();
      const isCovered = k < spec.covered;
      const slug = spec.lane.replace(/[^A-Za-z]/g, "").toUpperCase();
      loads.push(
        aLoad({
          loadId: `SEEDLIQ-${slug}-W${spec.week}-${k}`,
          pickupCity: spec.pickupCity,
          deliveryCity: spec.deliveryCity,
          status: isCovered ? LoadStatus.BOOKED : LoadStatus.OPEN,
          createdAt: postedAt,
          updatedAt: postedAt,
          offeredDriverCount: 12,
          ...(isCovered
            ? { assignedAt: postedAt + 3 * 60 * 60 * 1000, assignedDriverId: `SEEDLIQ-driver-${spec.week}-${k}` }
            : {}),
        })
      );
    }
  }
  return loads;
}

export const SEED_PREFIX = "SEEDLIQ-";
