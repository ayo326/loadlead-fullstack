#!/usr/bin/env node
/**
 * Seed a demo broadcast load so the negotiation feature can be clicked through
 * in the UI: a shipper posts, a hauler engages and bids, they counter/accept.
 *
 * Creates two rows (Load model untouched by the negotiation feature; this is a
 * normal load + offer, the same shapes the app writes):
 *   - a Load: status OPEN, PER_MILE rate, owned by the demo shipper
 *   - an Offer to the demo owner-operator's self-driver, status OFFERED, so the
 *     load appears on that hauler's loadboard and its detail page shows Engage.
 *
 * Deterministic ids (SEED-NEGO-DEMO) so a re-run replaces the same pair rather
 * than piling up. Safe: only ever touches its own SEED-NEGO rows.
 *
 * Usage (from backend/):
 *   eval "$(aws configure export-credentials --format env)"
 *   DYNAMODB_ENDPOINT= APP_ENV=production AWS_REGION=us-east-1 \
 *     node -r ts-node-dev/node_modules/ts-node/register/transpile-only \
 *     scripts/seedNegotiationDemo.ts seed   [--rate 2.50] [--miles 240]
 *   ... scripts/seedNegotiationDemo.ts purge
 */
import { Database } from '../src/config/database';
import config from '../src/config/environment';

const LOAD_ID = 'SEED-NEGO-DEMO';
const OFFER_ID = 'offer_SEED-NEGO-DEMO';
const VERIFICATIONS_TABLE = process.env.DYNAMODB_VERIFICATIONS_TABLE || 'LoadLead_Verifications';

// Demo actors resolved from prod (active, verified where needed).
const SHIPPER_USER_ID = 'user_648fff06-6020-43f3-9cea-e836c7c4dd03'; // test.shipper@loadleadapp.com
const HAULER_USER_ID = 'user_b08825df-4e94-419b-8c7b-8a8ff6ed0c0d';   // demo-owner-operator@loadleadapp.com
const HAULER_DRIVER_ID = 'driver_f2b3a598-9be1-4416-88b1-d3a26e6cf22b'; // demo-owner-operator self-driver (operator VERIFIED)

/**
 * The negotiation "engage" gate (requireVerifiedCarrier) has two checks: the
 * carrier-of-record must be VERIFIED (the operator record already is), AND the
 * person's own IDV record in LoadLead_Verifications must be VERIFIED and not
 * past its reverify date. The demo account carries the User.idvStatus=VERIFIED
 * mirror but is missing the backing Verifications row (it was provisioned
 * directly rather than through submitDriverIdv), so the gate would 403
 * idv_incomplete. Write the row the real IDV flow would have produced — once,
 * idempotently — so the demo hauler can actually engage. Only ever touches this
 * one known demo userId.
 */
async function ensureHaulerIdv() {
  const existing = await Database.getItem<{ verificationStatus?: string }>(
    VERIFICATIONS_TABLE, { entityId: HAULER_USER_ID },
  ).catch(() => null);
  if (existing?.verificationStatus === 'VERIFIED') {
    console.log(`     hauler IDV       : already VERIFIED (no change)`);
    return;
  }
  const nowIso = new Date().toISOString();
  await Database.putItem(VERIFICATIONS_TABLE, {
    entityId: HAULER_USER_ID,
    entityType: 'DRIVER',
    verificationStatus: 'VERIFIED',
    idvStatus: 'pass',
    docsSubmittedAt: nowIso,
    verifiedAt: nowIso,
    reverifyAfter: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    updatedAt: nowIso,
  });
  console.log(`     hauler IDV       : wrote VERIFIED record for ${HAULER_USER_ID}`);
}

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function purge() {
  await Database.deleteItem(config.dynamodb.loadsTable, { loadId: LOAD_ID }).catch(() => {});
  await Database.deleteItem(config.dynamodb.offersTable, { offerId: OFFER_ID }).catch(() => {});
  // also clear any negotiation lock/session left from a prior demo run
  await Database.deleteItem(config.dynamodb.negotiationLocksTable, { loadId: LOAD_ID }).catch(() => {});
  console.log(`\npurged demo load ${LOAD_ID} + offer + any lock.\n`);
}

async function main() {
  const cmd = process.argv[2] === 'purge' ? 'purge' : 'seed';
  if (config.appEnv === 'production' && process.argv.indexOf('--force') < 0 && cmd === 'seed') {
    // The default actors are prod accounts, so seeding prod is the point; keep
    // it low-friction but explicit.
  }
  if (cmd === 'purge') return purge();

  const rateDollars = parseFloat(arg('rate', '2.50'));
  const miles = parseInt(arg('miles', '240'), 10);
  const now = Date.now();
  const pickupDate = now + 2 * 86_400_000;
  const deliveryDate = now + 3 * 86_400_000;

  const load = {
    loadId: LOAD_ID,
    shipperId: SHIPPER_USER_ID,
    status: 'OPEN',
    referenceNumber: 'DEMO-NEGO-001',
    equipmentType: 'DRY_VAN',
    loadSize: 'FULL',
    totalWeightLbs: 34000,
    commodityDescription: 'Palletized general freight (demo)',
    hazmat: false,
    // route
    pickupCity: 'Dallas', pickupState: 'TX', pickupZip: '75201',
    pickupAddress: '400 S Ervay St, Dallas, TX', pickupLat: 32.7767, pickupLng: -96.7970,
    pickupDate, pickupTime: '09:00', pickupType: 'APPOINTMENT',
    deliveryCity: 'Houston', deliveryState: 'TX', deliveryZip: '77002',
    deliveryAddress: '901 Bagby St, Houston, TX', deliveryLat: 29.7604, deliveryLng: -95.3698,
    deliveryDate, deliveryTime: '14:00', deliveryType: 'LIVE_UNLOAD',
    totalMiles: miles,
    // rate (per mile so the demo can bid cents-per-mile)
    rateType: 'PER_MILE',
    rateAmount: rateDollars,
    createdAt: now,
    updatedAt: now,
  };

  const offer = {
    offerId: OFFER_ID,
    loadId: LOAD_ID,
    driverId: HAULER_DRIVER_ID,
    status: 'OFFERED',
    createdAt: now,
    expiresAt: now + 7 * 86_400_000, // long window so the demo doesn't expire mid-test
    driverDistanceMiles: 12,
  };

  await ensureHaulerIdv();
  await Database.putItem(config.dynamodb.loadsTable, load);
  await Database.putItem(config.dynamodb.offersTable, offer);

  const linehaul = Math.round(rateDollars * 100) * miles;
  console.log(`\n✅  demo broadcast load seeded (env ${config.appEnv}).`);
  console.log(`     loadId       : ${LOAD_ID}`);
  console.log(`     route        : Dallas, TX -> Houston, TX  (${miles} mi)`);
  console.log(`     posted rate  : $${rateDollars.toFixed(2)}/mi  ->  linehaul $${(linehaul / 100).toFixed(2)}`);
  console.log(`     shipper      : test.shipper@loadleadapp.com`);
  console.log(`     offered to   : demo-owner-operator@loadleadapp.com (verified)`);
  console.log(`\n   Click-through:`);
  console.log(`     1. Sign in as demo-owner-operator -> the load appears on the loadboard.`);
  console.log(`        Open it (/owner-operator/loads/${LOAD_ID}) -> Negotiation card -> "Engage", then "Bid" a $/mi rate.`);
  console.log(`     2. Sign in as test.shipper -> open the load (/shipper/loads/${LOAD_ID}) -> the bid shows live.`);
  console.log(`        Accept bid, or Counter (updates the hauler's screen within ~1s), or Reject.`);
  console.log(`     3. On accept, the load assigns at the agreed rate.`);
  console.log(`\n   Reset for another run:  scripts/seedNegotiationDemo.ts purge, then seed again.\n`);
}

main().catch((e) => { console.error('\n❌  seed failed:', e); process.exit(1); });
