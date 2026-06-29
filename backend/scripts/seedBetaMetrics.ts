/**
 * Idempotent seed for the Lane Liquidity (beta metrics) panel.
 *
 * Inserts a small deterministic set of loads, with fixed SEEDLIQ-* ids, via the
 * Database access layer the app uses, so re-running upserts the same records
 * instead of duplicating. Refuses to run outside local/dev/test.
 *
 * Run: npm run seed:beta-metrics   (from backend/, with DYNAMODB_ENDPOINT set)
 */

import { Database } from "../src/config/database";
import config from "../src/config/environment";
import { assertSafeEnvironment, buildSeedLoads } from "./betaMetricsFixtures";

async function main() {
  assertSafeEnvironment("seed:beta-metrics");
  const loads = buildSeedLoads();
  for (const load of loads) {
    await Database.putItem(config.dynamodb.loadsTable, load);
  }
  // eslint-disable-next-line no-console
  console.log(
    `seeded ${loads.length} loads into ${config.dynamodb.loadsTable} ` +
      `(endpoint ${config.dynamodb.endpoint ?? "default"}). Re-run is an upsert by fixed id.`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.message || err);
  process.exit(1);
});
