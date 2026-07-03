// services/integrations/bootGuard.ts
//
// Fail-closed boot guards. Every check here either passes silently or throws
// — there is no "warn and continue" path for anything that can touch real
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
 * production environment carries ANY non-live mode override at all — for
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
          `Production always runs every integration live, no exceptions — a non-live ` +
          `value present here means this environment's configuration leaked from (or ` +
          `was copied out of) a non-production environment, which may also be carrying ` +
          `sandbox/test secrets. Remove ${varName} from this environment entirely.`,
      );
    }
  }
}

/**
 * Outside production, defense layer 2: Didit, Email, and Push can each touch
 * a real human (a real identity check, a real inbox, a real phone) — so
 * "live" outside production is not allowed under any circumstance. FMCSA and
 * Maps only touch a government lookup API and a paid mapping API — live is
 * allowed outside production (e.g. a deliberate staging smoke test against
 * the real FMCSA registry) but is loud about it every single boot.
 */
const NEVER_LIVE_OUTSIDE_PROD: IntegrationName[] = ['didit', 'email', 'push'];
const WARN_IF_LIVE_OUTSIDE_PROD: IntegrationName[] = ['fmcsa', 'maps'];

export function assertNonProductionSafe(): void {
  if (isProduction()) return;

  const offending = NEVER_LIVE_OUTSIDE_PROD.filter((i) => resolveMode(i) === LIVE_MODE[i]);
  if (offending.length > 0) {
    const detail = offending.map((i) => `${MODE_ENV_VAR[i]}=${resolveMode(i)}`).join(', ');
    throw new BootGuardError(
      `Refusing to boot outside production with a live integration enabled: ${detail}. ` +
        `Didit, Email, and Push can affect real identities, real inboxes, and real ` +
        `devices — they must be sandbox/test/capture in every environment except ` +
        `production. This is not adjustable by warning-and-continuing.`,
    );
  }

  for (const integration of WARN_IF_LIVE_OUTSIDE_PROD) {
    if (resolveMode(integration) === LIVE_MODE[integration]) {
      Logger.warn(
        `[bootGuard] ${MODE_ENV_VAR[integration]}=${resolveMode(integration)} outside production — ` +
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
 * PRODUCTION data — a silent cross-environment contamination. Fail closed.
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
  // LoadLead_ names there are harmless — it's a different database, not prod.
  // The hazard is ONLY a non-prod env pointed at real AWS with prod-form names.
  if (process.env.DYNAMODB_ENDPOINT) return;

  const names: Record<string, string | undefined> = {};
  // (a) Everything resolved through the central config — covers negotiations,
  //     compliance, and payments (the H1-critical subsystems).
  for (const [k, v] of Object.entries(config.dynamodb)) {
    if (k.endsWith('Table') && typeof v === 'string') names[`config.${k}`] = v;
  }
  // (b) Plus any table override explicitly present in the environment — catches
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

/** Run every boot-time guard. Throws BootGuardError on the first violation. */
export function runBootGuards(): void {
  assertProductionNotContaminated();
  assertNonProductionSafe();
  assertTablesEnvIsolated();
}

/**
 * Production self-check, run AFTER the Express app and all routes (including
 * the conditionally-mounted test routes) have been assembled, but BEFORE the
 * server starts listening. Independently re-verifies what the guards above
 * and the guarded-import pattern are supposed to already guarantee — this is
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

  // Note: the literal '/_test' below is safe to write directly — it matches
  // neither of deploy-backend.sh's forbidden markers ("routes/_test" has a
  // "routes/" prefix this doesn't have; "_test/outbox" has an "/outbox"
  // suffix this doesn't have). Don't extend this to a fuller path like
  // '/_test/outbox' without re-checking against deploy-backend.sh's marker
  // list first — that exact substring IS a forbidden marker.
  //
  // IMPORTANT: generic middleware mounted with no path (cors(), helmet(),
  // express.json(), ...) shares one catch-all regexp whose `fast_slash` flag
  // is true and which matches EVERY path, including '/_test' — that is not
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
