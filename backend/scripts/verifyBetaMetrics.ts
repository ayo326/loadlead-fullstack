/**
 * Live verifier for the Lane Liquidity (beta metrics) endpoint.
 *
 * Targets a running backend (BASE_URL, default http://localhost:4000), obtains
 * an admin session the same way the app mints one (Helpers.generateToken, the
 * exact JWT the login route issues), calls GET /api/admin/liquidity, and asserts
 * HTTP 200 plus the full payload shape and types the panel depends on.
 *
 * It explicitly locks the two not-yet-populated dials, no-show count and trust
 * incident count, to PRESENT and 0, so the expected zero state is asserted, not
 * assumed. After Phase 2 wires those dials to the BetaTrustEvents store, this
 * assertion still holds with no events seeded (a real 0, not a placeholder).
 *
 * Run: npm run test:beta-metrics   (requires a running backend; seed first)
 */

import { Helpers } from "../src/utils/helpers";
import { UserRole } from "../src/types";
import { assertSafeEnvironment, EXPECTED } from "./betaMetricsFixtures";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4000";
const WEEKS = 8;

const failures: string[] = [];
function check(label: string, cond: boolean) {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    // eslint-disable-next-line no-console
    console.log(`  FAIL ${label}`);
  }
}
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isArr = (v: unknown) => Array.isArray(v);

async function main() {
  // The verifier only reads, but it mints an admin token and exercises a seeded
  // dataset, so keep it on the same local/dev/test rails as the seed.
  assertSafeEnvironment("test:beta-metrics");

  const token = Helpers.generateToken({
    userId: "verify-admin",
    email: "verify-admin@loadlead.local",
    role: UserRole.ADMIN,
  });

  const url = `${BASE_URL}/api/admin/liquidity?weeks=${WEEKS}`;
  // eslint-disable-next-line no-console
  console.log(`GET ${url}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  check(`HTTP 200 (got ${res.status})`, res.status === 200);
  if (res.status !== 200) {
    throw new Error(`endpoint returned ${res.status}; is the backend running and seeded?`);
  }

  const body: any = await res.json();

  // Top level shape.
  check("range present", body.range && typeof body.range === "object");
  check("range.weeks is the requested number", body.range?.weeks === WEEKS);
  check("lanes is an array", isArr(body.lanes));
  check("dials is an object", body.dials && typeof body.dials === "object");
  check("byLane is an array", isArr(body.byLane));
  check("cumulativeByLaneOverTime is an array", isArr(body.cumulativeByLaneOverTime));
  check("avgTimeToCoverByLaneOverTime is an array", isArr(body.avgTimeToCoverByLaneOverTime));
  check("gateTargets is an object", body.gateTargets && typeof body.gateTargets === "object");
  check("generatedAt is a string", typeof body.generatedAt === "string");

  // Dials: types.
  const d = body.dials ?? {};
  check("dials.loadsPosted is a number", isNum(d.loadsPosted));
  check("dials.loadsCovered is a number", isNum(d.loadsCovered));
  check("dials.fillRate is a number", isNum(d.fillRate));
  check("dials.avgTimeToCoverHours is number or null", d.avgTimeToCoverHours === null || isNum(d.avgTimeToCoverHours));
  check("dials.avgBroadcastSize is number or null", d.avgBroadcastSize === null || isNum(d.avgBroadcastSize));

  // The whole point of the zero-state lock: present AND exactly 0.
  check("dials.noShows is present", "noShows" in d);
  check("dials.noShows === 0", d.noShows === 0);
  check("dials.trustIncidents is present", "trustIncidents" in d);
  check("dials.trustIncidents === 0", d.trustIncidents === 0);

  // Gate targets surfaced to the panel.
  check("gateTargets.fillRate === 0.65", body.gateTargets?.fillRate === 0.65);
  check("gateTargets.maxTimeToCoverHours === 4", body.gateTargets?.maxTimeToCoverHours === 4);

  // Seeded data flowed through. A shared local DynamoDB may hold other dev loads,
  // so assert the seed's contribution is present (>=), not that it is the only data.
  check(`dials.loadsPosted >= ${EXPECTED.loadsPosted} (seeded)`, d.loadsPosted >= EXPECTED.loadsPosted);
  check(`dials.loadsCovered >= ${EXPECTED.loadsCovered} (seeded)`, d.loadsCovered >= EXPECTED.loadsCovered);
  check("seeded lanes present", EXPECTED.lanes.every((l) => body.lanes?.includes(l)));
  // The two seeded lanes carry at least the seeded posted/covered counts, which
  // shows the seed flowed through regardless of unrelated loads on other lanes.
  const byLane: any[] = Array.isArray(body.byLane) ? body.byLane : [];
  const ah = byLane.find((r) => r.lane === "Austin to Houston");
  const adfw = byLane.find((r) => r.lane === "Austin to Dallas-Fort Worth");
  check("Austin to Houston has >= 12 of 16 (seeded)", ah && ah.posted >= 16 && ah.covered >= 12);
  check("Austin to Dallas-Fort Worth has >= 5 of 6 (seeded)", adfw && adfw.posted >= 6 && adfw.covered >= 5);
  check("dials.avgTimeToCoverHours is a positive number", isNum(d.avgTimeToCoverHours) && d.avgTimeToCoverHours > 0);

  // eslint-disable-next-line no-console
  console.log("");
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.error(`FAILED ${failures.length} check(s): ${failures.join("; ")}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("beta metrics endpoint verified: 200, full shape, zero-state dials locked.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.message || err);
  process.exit(1);
});
