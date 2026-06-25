/**
 * Private-beta configuration. Read once at boot; never mutated after.
 *
 * The single source of truth for "are we in private beta?" — every callsite
 * (signup gate, login gate, landing-page redirect, dashboard banner) reads
 * `isBetaMode()` instead of touching process.env directly, so flipping the
 * flag is one env change + one restart.
 *
 * Default ON in production. To open public signup (the public-launch flip):
 *   BETA_MODE=off  → gate lifts; betaUser flags on existing accounts persist
 *                    for cohort separation but stop affecting auth.
 *
 * Other knobs:
 *   BETA_CURRENT_COHORT     — string tag stamped on every new beta account
 *                             (e.g. "wave-1"). Default "wave-1".
 *   BETA_COHORT_CAP         — soft cap shown on the dashboard balance widget.
 *                             Not enforced server-side (staff judgment). 0 = none.
 *   TALLY_SIGNING_SECRET    — HMAC signing key from Tally. If unset, the
 *                             Tally webhook endpoint is INERT (returns 503
 *                             "form not connected") and the dashboard shows
 *                             the same status. No fabricated applications.
 *                             (TALLY_WEBHOOK_SECRET is accepted as a
 *                             back-compat alias.)
 *   TALLY_FORM_ID           — the Tally form id (optional; used as a sanity
 *                             check against the payload's `formId`).
 *   TALLY_REQUIRE_SOURCE_HEADER — when "true", the webhook additionally
 *                             requires the custom header X-Beta-Source=tally
 *                             (defence-in-depth alongside the signature).
 */

function readBool(value: string | undefined, dflt: boolean): boolean {
  if (value === undefined) return dflt;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  return dflt;
}

const BETA_MODE_DEFAULT = true;

export interface BetaConfig {
  readonly betaMode: boolean;
  readonly currentCohort: string;
  readonly cohortCap: number;
  readonly tallySigningSecret: string | null;
  readonly tallyFormId: string | null;
  readonly tallyRequireSourceHeader: boolean;
}

let cached: BetaConfig | null = null;

export function getBetaConfig(): BetaConfig {
  if (cached) return cached;
  cached = {
    betaMode: readBool(process.env.BETA_MODE, BETA_MODE_DEFAULT),
    currentCohort: process.env.BETA_CURRENT_COHORT?.trim() || 'wave-1',
    cohortCap: Number(process.env.BETA_COHORT_CAP || '0') || 0,
    // TALLY_SIGNING_SECRET is the canonical name; TALLY_WEBHOOK_SECRET is a
    // back-compat alias from the initial beta-program build.
    tallySigningSecret:
      process.env.TALLY_SIGNING_SECRET?.trim() ||
      process.env.TALLY_WEBHOOK_SECRET?.trim() ||
      null,
    tallyFormId: process.env.TALLY_FORM_ID?.trim() || null,
    tallyRequireSourceHeader: readBool(process.env.TALLY_REQUIRE_SOURCE_HEADER, false),
  };
  return cached;
}

/** Convenience predicate — equivalent to `getBetaConfig().betaMode`. */
export function isBetaMode(): boolean {
  return getBetaConfig().betaMode;
}

/** Is the Tally form wired up? When false, the webhook endpoint is inert
 *  and the admin dashboard surfaces a "form not connected" notice. */
export function isTallyConnected(): boolean {
  return getBetaConfig().tallySigningSecret !== null;
}

/**
 * Test-only: clear the memoized config so a fresh process.env can be read.
 * Production code never calls this. Tests use it to flip BETA_MODE within a
 * single process.
 */
export function _resetBetaConfigForTests(): void {
  cached = null;
}
