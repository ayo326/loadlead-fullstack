// services/integrations/bootGuard.ts
//
// Fail-closed boot guards. Every check here either passes silently or throws
// - there is no "warn and continue" path for anything that can touch real
// users, real money, or real government data. Called once, synchronously,
// before the HTTP server starts listening (see index.ts).

import {
  IntegrationName,
  INTEGRATIONS,
  MODE_ENV_VAR,
  LIVE_MODE,
  rawModeEnvValue,
  resolveMode,
} from './modeResolver';
import Logger from '../../utils/logger';
import config from '../../config/environment';

export class BootGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootGuardError';
  }
}

function isProduction(): boolean {
  return process.env.APP_ENV === 'production';
}

/**
 * Production-locked mode resolution, defense layer 1: refuse to boot if the
 * production environment carries ANY non-live mode override at all - for
 * any integration. resolveMode() already ignores these env vars in
 * production, but their mere presence here means this environment's config
 * was copied from (or shares secrets with) a non-production environment.
 * That is treated as a hard incident, not a quirk to shrug off.
 */
export function assertProductionNotContaminated(): void {
  if (!isProduction()) return;

  for (const integration of INTEGRATIONS) {
    const raw = rawModeEnvValue(integration);
    if (raw === undefined) continue;

    const liveValue = LIVE_MODE[integration];
    if (raw !== liveValue) {
      const varName = MODE_ENV_VAR[integration];
      throw new BootGuardError(
        `Refusing to boot: ${varName} is set to "${raw}" while APP_ENV=production. ` +
          `Production always runs every integration live, no exceptions - a non-live ` +
          `value present here means this environment's configuration leaked from (or ` +
          `was copied out of) a non-production environment, which may also be carrying ` +
          `sandbox/test secrets. Remove ${varName} from this environment entirely.`,
      );
    }
  }
}

/**
 * Outside production, defense layer 2: Didit, Email, and Push can each touch
 * a real human (a real identity check, a real inbox, a real phone) - so
 * "live" outside production is not allowed under any circumstance. FMCSA and
 * Maps only touch a government lookup API and a paid mapping API - live is
 * allowed outside production (e.g. a deliberate staging smoke test against
 * the real FMCSA registry) but is loud about it every single boot.
 */
// Canopy joins didit/email/push: 'production' mode pulls a real policyholder's
// insurance data through a live consent flow, so it must be sandbox in every
// environment except production. There is no warning-and-continuing path.
const NEVER_LIVE_OUTSIDE_PROD: IntegrationName[] = ['didit', 'email', 'push', 'canopy'];
const WARN_IF_LIVE_OUTSIDE_PROD: IntegrationName[] = ['fmcsa', 'maps'];

export function assertNonProductionSafe(): void {
  if (isProduction()) return;

  const offending = NEVER_LIVE_OUTSIDE_PROD.filter((i) => resolveMode(i) === LIVE_MODE[i]);
  if (offending.length > 0) {
    const detail = offending.map((i) => `${MODE_ENV_VAR[i]}=${resolveMode(i)}`).join(', ');
    throw new BootGuardError(
      `Refusing to boot outside production with a live integration enabled: ${detail}. ` +
        `Didit, Email, and Push can affect real identities, real inboxes, and real ` +
        `devices - they must be sandbox/test/capture in every environment except ` +
        `production. This is not adjustable by warning-and-continuing.`,
    );
  }

  for (const integration of WARN_IF_LIVE_OUTSIDE_PROD) {
    if (resolveMode(integration) === LIVE_MODE[integration]) {
      Logger.warn(
        `[bootGuard] ${MODE_ENV_VAR[integration]}=${resolveMode(integration)} outside production - ` +
          `this environment will make REAL ${integration === 'fmcsa' ? 'FMCSA government registry' : 'Google Maps (billed)'} ` +
          `calls. Confirm this is intentional.`,
      );
    }
  }
}

/**
 * Table-isolation guard, defense layer 3 (the H1 fix). Production owns the
 * canonical `LoadLead_*` (underscore) table names; every OTHER environment must
 * namespace its tables (`LoadLead-Staging-*`, `LoadLead-Dev-*`). If a non-prod
 * environment resolves ANY table name to the production `LoadLead_` form it
 * means an override was never set and this process would read and write
 * PRODUCTION data - a silent cross-environment contamination. Fail closed.
 *
 * Pure so it can be unit-tested without touching global env: given the resolved
 * table names, return the ones in production form.
 */
export function prodFormTableNames(names: Record<string, string | undefined>): string[] {
  return Object.entries(names)
    .filter(([, v]) => typeof v === 'string' && v.startsWith('LoadLead_'))
    .map(([k, v]) => `${k}=${v}`);
}

export function assertTablesEnvIsolated(): void {
  if (isProduction()) return;
  // Local development talks to a local DynamoDB (DYNAMODB_ENDPOINT set); the
  // LoadLead_ names there are harmless - it's a different database, not prod.
  // The hazard is ONLY a non-prod env pointed at real AWS with prod-form names.
  if (process.env.DYNAMODB_ENDPOINT) return;

  const names: Record<string, string | undefined> = {};
  // (a) Everything resolved through the central config - covers negotiations,
  //     compliance, and payments (the H1-critical subsystems).
  for (const [k, v] of Object.entries(config.dynamodb)) {
    if (k.endsWith('Table') && typeof v === 'string') names[`config.${k}`] = v;
  }
  // (b) Plus any table override explicitly present in the environment - catches
  //     the handful of tables read via process.env directly, not through config.
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DYNAMODB_[A-Z_]+_TABLE$/.test(k)) names[k] = v;
  }

  const offenders = prodFormTableNames(names);
  if (offenders.length > 0) {
    throw new BootGuardError(
      `Refusing to boot outside production: ${offenders.length} DynamoDB table name(s) resolved to the ` +
        `production "LoadLead_" form, so this environment (APP_ENV=${process.env.APP_ENV ?? 'development'}) ` +
        `would read and write PRODUCTION data. Offending: ${offenders.join(', ')}. Set the matching ` +
        `DYNAMODB_*_TABLE override(s) for this environment (see scripts/check-table-env-parity.mjs).`,
    );
  }
}

/**
 * Fail closed if a DEPLOYED environment is missing a real JWT signing secret.
 * environment.ts falls back to 'dev-secret' so local dev + CI boot without a
 * secret - but that default is a forge-anyone's-token landmine the moment it
 * reaches a deployed env (this platform's recurring out-of-band-env failure
 * mode). So outside development/test we refuse to boot unless JWT_SECRET is
 * present and not the dev default. A present-but-short secret is a loud warning
 * (never a hard fail) so this guard can never brick a real env whose generated
 * secret happens to be short. (Audit v5 SEC-1.)
 */
const MIN_JWT_SECRET_LEN = 32;
export function assertAuthSecretStrong(): void {
  const appEnv = process.env.APP_ENV ?? 'development';
  if (appEnv === 'development' || appEnv === 'test') return;
  const secret = process.env.JWT_SECRET ?? '';
  if (!secret || secret === 'dev-secret') {
    throw new BootGuardError(
      `Refusing to boot: JWT_SECRET is missing or the dev default while APP_ENV=${appEnv}. ` +
        `A missing/default signing secret makes every auth token forgeable (ADMIN 2FA does not help - ` +
        `forgery skips login). Set a strong JWT_SECRET for this environment.`,
    );
  }
  if (secret.length < MIN_JWT_SECRET_LEN) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bootGuard] JWT_SECRET is set but shorter than ${MIN_JWT_SECRET_LEN} chars in APP_ENV=${appEnv}; ` +
        `rotate it to a longer random value.`,
    );
  }
}

/** Run every boot-time guard. Throws BootGuardError on the first violation. */
export function runBootGuards(): void {
  assertProductionNotContaminated();
  assertNonProductionSafe();
  assertTablesEnvIsolated();
  assertAuthSecretStrong();
}

/**
 * Production self-check, run AFTER the Express app and all routes (including
 * the conditionally-mounted test routes) have been assembled, but BEFORE the
 * server starts listening. Independently re-verifies what the guards above
 * and the guarded-import pattern are supposed to already guarantee - this is
 * the belt for the suspenders, not a duplicate of the same check.
 */
type ExpressLayer = {
  regexp?: RegExp & { fast_slash?: boolean };
  route?: { path?: string };
};

export function assertProductionHardened(app: { _router?: { stack: ExpressLayer[] } }): void {
  if (!isProduction()) return;

  for (const integration of INTEGRATIONS) {
    if (resolveMode(integration) !== LIVE_MODE[integration]) {
      throw new BootGuardError(
        `Production self-check failed: ${integration} resolved to "${resolveMode(integration)}", not live. Refusing to boot.`,
      );
    }
  }

  // Note: the literal '/_test' below is safe to write directly - it matches
  // neither of deploy-backend.sh's forbidden markers ("routes/_test" has a
  // "routes/" prefix this doesn't have; "_test/outbox" has an "/outbox"
  // suffix this doesn't have). Don't extend this to a fuller path like
  // '/_test/outbox' without re-checking against deploy-backend.sh's marker
  // list first - that exact substring IS a forbidden marker.
  //
  // IMPORTANT: generic middleware mounted with no path (cors(), helmet(),
  // express.json(), ...) shares one catch-all regexp whose `fast_slash` flag
  // is true and which matches EVERY path, including '/_test' - that is not
  // a test route, it's every unrelated middleware layer. Those must be
  // skipped or this check is a permanent false positive on every boot.
  const stack = app._router?.stack ?? [];
  const hasTestRoute = stack.some((layer) => {
    const path = layer.route?.path;
    if (typeof path === 'string') return path.startsWith('/_test');
    if (!layer.regexp || layer.regexp.fast_slash) return false; // unrestricted middleware, not a mounted router
    return layer.regexp.test('/_test');
  });

  if (hasTestRoute) {
    throw new BootGuardError(
      'Production self-check failed: a test-only route is registered on this app instance. Refusing to boot.',
    );
  }
}

/**
 * Audit v4 H3c/COA-3A: required-GSI assertion. negsForLoad's silent scan
 * fallback under 1-second long-polling turns a missing index into a
 * self-DoS that "works" until the table grows. In production a missing
 * REQUIRED index refuses boot (EB keeps the previous healthy version
 * serving); everywhere else it logs loudly. EXPECTED indexes are the new
 * COA-3A ones - warn-only until they are confirmed backfilled in every
 * environment, then promote them to required.
 */
export async function assertRequiredIndexesActive(): Promise<void> {
  // Lazy imports keep this file's top-level dependency-light (it runs at
  // the very start of boot, before most modules are needed).
  const { DescribeTableCommand } = await import('@aws-sdk/client-dynamodb');
  const { dynamoClient } = await import('../../config/aws');
  const config = (await import('../../config/environment')).default;

  const REQUIRED = [
    { table: config.dynamodb.loadNegotiationsTable, index: 'loadId-createdAt-index' },
    { table: config.dynamodb.negotiationOffersTable, index: 'negotiationId-createdAt-index' },
    // Promoted from EXPECTED 2026-07-10 (audit v4 COA-4): confirmed ACTIVE in
    // both staging and prod after the COA-3A backfill.
    { table: config.dynamodb.loadsTable, index: 'shipperId-index' },
    { table: config.dynamodb.accessorialChargesTable, index: 'loadId-index' },
    { table: config.dynamodb.complianceDocumentsTable, index: 'ownerId-index' },
  ];
  // New indexes start here warn-only, then get promoted once ACTIVE everywhere.
  const EXPECTED: { table: string; index: string }[] = [];

  const check = async (table: string, index: string): Promise<'ok' | string> => {
    try {
      const r = await dynamoClient.send(new DescribeTableCommand({ TableName: table }));
      const gsi = (r.Table?.GlobalSecondaryIndexes ?? []).find((g) => g.IndexName === index);
      if (!gsi) return `index ${index} missing on ${table}`;
      if (gsi.IndexStatus !== 'ACTIVE') return `index ${index} on ${table} is ${gsi.IndexStatus} (backfilling)`;
      return 'ok';
    } catch (e: any) {
      return `cannot describe ${table}: ${e?.name ?? e}`;
    }
  };

  const requiredProblems: string[] = [];
  for (const { table, index } of REQUIRED) {
    const res = await check(table, index);
    if (res !== 'ok') requiredProblems.push(res);
  }
  for (const { table, index } of EXPECTED) {
    const res = await check(table, index);
    if (res !== 'ok') console.error(`[index-check] EXPECTED (warn-only): ${res} - hot reads will [scan-fallback] until it is live`);
  }

  if (requiredProblems.length > 0) {
    const detail = requiredProblems.join('; ');
    if (process.env.APP_ENV === 'production') {
      throw new BootGuardError(`Required DynamoDB indexes unavailable: ${detail}. Refusing to boot (long-poll scan fallback is a self-DoS at scale).`);
    }
    console.error(`[index-check] REQUIRED index problem (non-production, continuing): ${detail}`);
  }
}
