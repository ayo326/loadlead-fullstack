/**
 * Teardown for the Lane Liquidity (beta metrics) seed. Removes exactly the
 * SEEDLIQ-* loads this fixture set inserts, by their fixed ids, and nothing
 * else. Refuses to run outside local/dev/test.
 *
 * Run: npm run teardown:beta-metrics   (from backend/, with DYNAMODB_ENDPOINT set)
 */

import { Database } from "../src/config/database";
import config from "../src/config/environment";
import { assertSafeEnvironment, buildSeedLoads } from "./betaMetricsFixtures";

async function main() {
  assertSafeEnvironment("teardown:beta-metrics");
  const loads = buildSeedLoads();
  for (const load of loads) {
    await Database.deleteItem(config.dynamodb.loadsTable, { loadId: load.loadId });
  }
  // eslint-disable-next-line no-console
  console.log(`removed ${loads.length} SEEDLIQ-* loads from ${config.dynamodb.loadsTable}.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.message || err);
  process.exit(1);
});
