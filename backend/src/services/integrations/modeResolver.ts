// services/integrations/modeResolver.ts
//
// THE single source of truth for "which mode is integration X in right now."
// Every adapter, the boot guard, and the production self-check all call
// resolveMode() - there is no second place in the codebase that reads
// DIDIT_ENV / FMCSA_MODE / MAPS_MODE / EMAIL_MODE / PUSH_MODE directly.
//
// Production lock: when APP_ENV === 'production', resolveMode() returns the
// live value UNCONDITIONALLY for every integration - it does not even look
// at the mode env var. The env var is still read separately by the boot
// guard (assertProductionNotContaminated, below) purely to detect and refuse
// boot on a leaked/contaminated value; resolveMode() itself never lets a
// stray env var override production.

export type IntegrationName = 'didit' | 'fmcsa' | 'maps' | 'email' | 'push';

export const INTEGRATIONS: IntegrationName[] = ['didit', 'fmcsa', 'maps', 'email', 'push'];

/** The env var each integration's mode is read from outside production. */
export const MODE_ENV_VAR: Record<IntegrationName, string> = {
  didit: 'DIDIT_ENV',
  fmcsa: 'FMCSA_MODE',
  maps: 'MAPS_MODE',
  email: 'EMAIL_MODE',
  push: 'PUSH_MODE',
};

/** The value that means "really call the real provider" for each integration. */
export const LIVE_MODE: Record<IntegrationName, string> = {
  didit: 'live',
  fmcsa: 'live',
  maps: 'live',
  email: 'live',
  push: 'live',
};

/** Default mode used outside production when the env var is unset. */
export const DEFAULT_NONPROD_MODE: Record<IntegrationName, string> = {
  didit: 'sandbox',
  fmcsa: 'stub',
  maps: 'stub',
  email: 'test',
  push: 'capture',
};

function isProduction(): boolean {
  return process.env.APP_ENV === 'production';
}

/**
 * Resolve the active mode for an integration. This is what every adapter
 * calls before deciding how to behave.
 *
 *   - In production: always the live value, full stop. The mode env var is
 *     not consulted at all here (see assertProductionNotContaminated for the
 *     separate refuse-to-boot check on that same env var).
 *   - Outside production: the env var's value, or the safe default if unset.
 */
export function resolveMode(integration: IntegrationName): string {
  if (isProduction()) return LIVE_MODE[integration];

  const raw = process.env[MODE_ENV_VAR[integration]];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : DEFAULT_NONPROD_MODE[integration];
}

/** Raw, unresolved env var value - used only by the boot guard's contamination check. */
export function rawModeEnvValue(integration: IntegrationName): string | undefined {
  const raw = process.env[MODE_ENV_VAR[integration]];
  return raw?.trim() || undefined;
}

export function isLive(integration: IntegrationName): boolean {
  return resolveMode(integration) === LIVE_MODE[integration];
}
