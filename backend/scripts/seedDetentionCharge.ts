#!/usr/bin/env node
/**
 * Seed a real detention accessorial charge so the payments flow can be exercised
 * end to end: compute -> shipper approve / adjust / dispute -> factoring export.
 *
 * It inserts a BACKDATED check-in / check-out pair (Phase 4 stop events) with a
 * long enough dwell that the detention calc (Phase 5) produces a target amount,
 * then computes the charge exactly as the live path does (AccessorialChargeService
 * .computeForStop). Nothing here fakes an amount: the dwell is real evidence and
 * the money comes from the same engine production uses.
 *
 * Usage (from backend/):
 *   node -r ts-node-dev/node_modules/ts-node/register/transpile-only \
 *     scripts/seedDetentionCharge.ts seed   [flags]
 *   ... scripts/seedDetentionCharge.ts purge [flags]
 *   ... scripts/seedDetentionCharge.ts seed --dry-run
 * Or via the npm aliases: `npm run seed:detention` / `npm run purge:detention`.
 *
 * Flags:
 *   --load-id <id>     Target load. Default: SEEDDET-DEMO (safe synthetic load).
 *   --stop-id <id>     Stop. Default: DELIVERY.
 *   --amount <usd>     Target detention dollars. Default: 150.
 *   --equipment <T>    TrailerType for rate-class pre-fill (synthetic loads).
 *                      Default: DRY_VAN (STANDARD band, $50/hr).
 *   --hazmat           Treat as hazmat (HAZMAT band) for a synthetic load.
 *   --actor <id>       Actor id recorded on the events/charge. Default: seed-script.
 *   --dry-run          Print the plan; write nothing (reads only).
 *   --force            Required to target a NON-SEEDDET (real) load, and to run
 *                      when APP_ENV=production.
 *
 * Target: AWS by default (AWS_REGION or us-east-1, table names from env / the
 * app config). Point DYNAMODB_ENDPOINT at DynamoDB Local to seed locally.
 *
 * SAFE BY DESIGN: the default load id is prefixed "SEEDDET-", and the stop events
 * use deterministic ids, so re-running `seed` upserts the SAME clean arrival +
 * departure pair (no duplicates) and recomputes the SAME deterministic charge.
 * The Load model is never touched (charges reference the load by id only). Real
 * loads are only touched with an explicit --force.
 */

import { createHash } from 'node:crypto';
import { Database } from '../src/config/database';
import config from '../src/config/environment';
import { AccessorialPolicyService } from '../src/services/accessorialPolicyService';
import { AccessorialChargeService } from '../src/services/accessorialChargeService';
import { computeAccessorialFromDwell } from '../src/services/accessorialCalc';
import {
  DEFAULT_ACCESSORIAL_POLICY,
  resolveRateClass,
  AccessorialPolicy,
} from '../src/config/accessorialPolicy';
import type { StopEvent } from '../src/services/stopEventService';
import { TrailerType } from '../src/types';

const SAFE_PREFIX = 'SEEDDET-';

// ── args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'seed';
  const flags = new Map<string, string>();
  const bool = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { flags.set(key, next); i++; }
    else bool.add(key);
  }
  return {
    cmd,
    loadId: flags.get('load-id') ?? `${SAFE_PREFIX}DEMO`,
    stopId: flags.get('stop-id') ?? 'DELIVERY',
    amountUsd: Number(flags.get('amount') ?? '150'),
    equipment: (flags.get('equipment') ?? 'DRY_VAN') as TrailerType,
    hazmat: bool.has('hazmat'),
    actor: flags.get('actor') ?? 'seed-script',
    dryRun: bool.has('dry-run'),
    force: bool.has('force'),
  };
}

const fmtUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtMins = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
function roundUpTo(value: number, increment: number): number {
  return increment <= 0 ? value : Math.ceil(value / increment) * increment;
}
function eventId(loadId: string, stopId: string, type: 'ARRIVAL' | 'DEPARTURE'): string {
  const slug = `${loadId}|${stopId}`.replace(/[^A-Za-z0-9]+/g, '_');
  return `stopevt_SEEDDET_${slug}_${type}`;
}

/** Choose the dwell (minutes) that makes the detention engine produce ~targetCents. */
function planDwell(policy: AccessorialPolicy, rateClass: keyof AccessorialPolicy['detentionHourlyRateCents'], targetCents: number) {
  const rate = policy.detentionHourlyRateCents[rateClass];
  const detainedIdeal = (targetCents * 60) / rate; // minutes to bill exactly target
  let detained = roundUpTo(Math.round(detainedIdeal), policy.billingIncrementMinutes);
  let dwell = policy.freeTimeMinutes + detained;
  let clampedToDetention = false;
  // Keep it detention, not layover: dwell must stay at/under the layover threshold.
  if (dwell > policy.layoverThresholdMinutes) {
    dwell = policy.layoverThresholdMinutes;
    detained = roundUpTo(Math.max(0, dwell - policy.freeTimeMinutes), policy.billingIncrementMinutes);
    clampedToDetention = true;
  }
  return { rate, detained, dwell, clampedToDetention };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const isSafeLoad = args.loadId.startsWith(SAFE_PREFIX);
  const region = process.env.AWS_REGION || 'us-east-1';
  const endpoint = process.env.DYNAMODB_ENDPOINT || `AWS (${region})`;

  console.log(`\n▶  detention seed helper  [${args.cmd}]`);
  console.log(`   target: ${endpoint}   APP_ENV=${config.appEnv}`);
  console.log(`   load=${args.loadId}  stop=${args.stopId}  ${isSafeLoad ? '(synthetic, safe)' : '(REAL load)'}`);

  // Guards: real load or production both require an explicit --force.
  if (!isSafeLoad && !args.force) {
    console.error(`\n❌  ${args.loadId} is not a ${SAFE_PREFIX}* synthetic load. Re-run with --force to touch a real load's accessorial data.`);
    process.exit(1);
  }
  if (config.appEnv === 'production' && !args.force && !args.dryRun) {
    console.error('\n❌  APP_ENV=production. Re-run with --force to confirm seeding production, or --dry-run to preview.');
    process.exit(1);
  }
  if (!Number.isFinite(args.amountUsd) || args.amountUsd <= 0) {
    console.error(`\n❌  --amount must be a positive number of dollars (got ${args.amountUsd}).`);
    process.exit(1);
  }

  if (args.cmd === 'purge') return purge(args, isSafeLoad);

  const load = { loadId: args.loadId, hazmat: args.hazmat, equipmentType: args.equipment };

  // Read (or, for a real run, get-or-create) the policy to learn the rate/free time.
  const existing = await AccessorialPolicyService.getForLoad(args.loadId);
  const rateClass = existing?.rateClass ?? resolveRateClass(load);
  const policy: AccessorialPolicy = existing?.policy ?? DEFAULT_ACCESSORIAL_POLICY;

  const targetCents = Math.round(args.amountUsd * 100);
  const { rate, detained, dwell, clampedToDetention } = planDwell(policy, rateClass, targetCents);
  const preview = computeAccessorialFromDwell(dwell, rateClass, policy);
  const willAutoApprove = detained / 60 <= policy.detentionAutoApproveMaxHours;

  console.log(`\n   rate class ${rateClass} @ ${fmtUsd(rate)}/hr, free ${fmtMins(policy.freeTimeMinutes)}, increment ${policy.billingIncrementMinutes}m, auto-approve <= ${policy.detentionAutoApproveMaxHours}h`);
  console.log(`   dwell ${fmtMins(dwell)}  ->  ${preview.detainedMinutes}m billable  ->  ${fmtUsd(preview.amountCents)} ${preview.type}` + (clampedToDetention ? '  (clamped below layover threshold)' : ''));
  if (Math.abs(preview.amountCents - targetCents) > 0) {
    console.log(`   note: nearest billable amount to the ${fmtUsd(targetCents)} target given the ${policy.billingIncrementMinutes}m increment.`);
  }
  console.log(`   expected status on close: ${willAutoApprove ? 'APPROVED (auto — <= auto-approve hours)' : 'PENDING_REVIEW (routes to shipper review)'}`);
  if (willAutoApprove) {
    console.log(`   ⚠️  this amount auto-approves, so there is nothing to "approve". Raise --amount above ${fmtUsd(Math.round((policy.detentionAutoApproveMaxHours * 60 * rate) / 60))} to land in PENDING_REVIEW.`);
  }

  if (args.dryRun) {
    console.log('\n✅  dry run — nothing written.\n');
    return;
  }

  // Materialise the policy (upsert v1 prefill for a synthetic load) so the charge
  // freezes a real snapshot, then write the backdated evidence pair.
  await AccessorialPolicyService.getOrCreateForLoad(load);

  const now = Date.now();
  const departureAt = now;
  const arrivalAt = now - dwell * 60000;
  const arrival: StopEvent = {
    eventId: eventId(args.loadId, args.stopId, 'ARRIVAL'),
    loadId: args.loadId, stopId: args.stopId, eventType: 'ARRIVAL',
    eventAt: arrivalAt, actorId: args.actor, note: 'seeded backdated check-in', createdAt: now,
  };
  const departure: StopEvent = {
    eventId: eventId(args.loadId, args.stopId, 'DEPARTURE'),
    loadId: args.loadId, stopId: args.stopId, eventType: 'DEPARTURE',
    eventAt: departureAt, actorId: args.actor, note: 'seeded backdated check-out', createdAt: now + 1,
  };
  await Database.putItem(config.dynamodb.stopEventsTable, arrival);
  await Database.putItem(config.dynamodb.stopEventsTable, departure);

  // Compute the charge exactly as the live close path does.
  const charge = await AccessorialChargeService.computeForStop(load, args.stopId, args.actor);
  if (!charge) throw new Error('computeForStop returned null (no arrival) — unexpected after seeding a pair');

  console.log('\n✅  seeded. Real charge created via the production calc:');
  console.log(`     chargeId : ${charge.chargeId}`);
  console.log(`     type     : ${charge.type}`);
  console.log(`     amount   : ${fmtUsd(charge.amountCents)}  (${charge.billableMinutes}m billable, dwell ${fmtMins(charge.dwellMinutes)})`);
  console.log(`     status   : ${charge.status}`);
  console.log(`     policy   : v${charge.policyVersion} ${charge.policyHash.slice(0, 12)}…`);

  console.log('\n   Exercise the flow from here (as the shipper, then the mover):');
  console.log(`     • Review UI: shipper opens load ${args.loadId} → Accessorial charges → Approve / Adjust / Dispute`);
  console.log('     • Or via API (needs the shipper session cookie):');
  console.log(`         POST /api/accessorials/charges/${charge.chargeId}/approve`);
  console.log(`         POST /api/accessorials/charges/${charge.chargeId}/adjust   { "newAmountCents": 12000, "reason": "..." }`);
  console.log(`         POST /api/accessorials/charges/${charge.chargeId}/dispute   { "reason": "..." }`);
  console.log(`     • Inspect: GET /api/accessorials/loads/${args.loadId}/charges`);
  console.log('     • Once APPROVED, it is billable and flows into the factoring-ready invoice package / export.');
  console.log(`\n   Re-run to reset (idempotent), or purge:  scripts/seedDetentionCharge.ts purge --load-id ${args.loadId}\n`);
}

async function purge(args: ReturnType<typeof parseArgs>, isSafeLoad: boolean) {
  if (!isSafeLoad && !args.force) {
    console.error(`\n❌  refusing to purge accessorial data for a real load without --force.`);
    process.exit(1);
  }
  let deleted = { events: 0, charges: 0, history: 0, policy: 0 };

  const events = (await Database.scan<StopEvent>(config.dynamodb.stopEventsTable)).filter((e) => e.loadId === args.loadId);
  const charges = (await Database.scan<{ chargeId: string; loadId: string }>(config.dynamodb.accessorialChargesTable)).filter((c) => c.loadId === args.loadId);
  const history = (await Database.scan<{ historyId: string; loadId: string }>(config.dynamodb.chargeStatusHistoryTable)).filter((h) => h.loadId === args.loadId);

  if (args.dryRun) {
    console.log(`\n   would delete: ${events.length} stop events, ${charges.length} charges, ${history.length} history rows, 1 policy row (if present).`);
    console.log('   dry run — nothing deleted.\n');
    return;
  }

  for (const e of events) { await Database.deleteItem(config.dynamodb.stopEventsTable, { eventId: e.eventId }); deleted.events++; }
  for (const c of charges) { await Database.deleteItem(config.dynamodb.accessorialChargesTable, { chargeId: c.chargeId }); deleted.charges++; }
  for (const h of history) { await Database.deleteItem(config.dynamodb.chargeStatusHistoryTable, { historyId: h.historyId }); deleted.history++; }
  if (await AccessorialPolicyService.getForLoad(args.loadId)) {
    await Database.deleteItem(config.dynamodb.accessorialPoliciesTable, { loadId: args.loadId }); deleted.policy = 1;
  }

  console.log(`\n✅  purged load ${args.loadId}: ${deleted.events} events, ${deleted.charges} charges, ${deleted.history} history, ${deleted.policy} policy.\n`);
}

main().catch((err) => { console.error('\n❌  seed failed:', err); process.exit(1); });
