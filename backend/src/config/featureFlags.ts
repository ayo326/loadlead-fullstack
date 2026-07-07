/**
 * Persona / feature flags. Read once at boot; never mutated after.
 *
 * The single source of truth for persona muting. Every callsite (signup gate,
 * carrier route guards, broadcast pool filter, notification targeting) reads
 * the helper here instead of touching process.env directly, so flipping a
 * persona on/off is exactly one env change plus a restart - no code edits.
 *
 * Flags:
 *   FLEET_CARRIER_PERSONA_ENABLED - when false (default), the fleet-carrier
 *     PERSONA is muted: the account type is hidden at signup, fleet-carrier
 *     logins land on an interstitial, the carrier-persona routes and endpoints
 *     return PERSONA_DISABLED, and fleet-carrier accounts are excluded as
 *     broadcast/notification TARGETS. Owner-operators - which are carrier
 *     entities referenced by carrier id - are UNAFFECTED: none of the shared
 *     carrier code (claims, negotiation, e-sign, accessorials, factoring,
 *     telematics, settlement) is gated by this flag. Platform Admin visibility
 *     is never gated. Set to true (one env change + deploy) to bring the fleet
 *     persona back with no code edits.
 */

function readBool(value: string | undefined, dflt: boolean): boolean {
  if (value === undefined) return dflt;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  return dflt;
}

const FLEET_CARRIER_PERSONA_ENABLED_DEFAULT = false;

export interface FeatureFlags {
  readonly fleetCarrierPersonaEnabled: boolean;
}

let cached: FeatureFlags | null = null;

export function getFeatureFlags(): FeatureFlags {
  if (cached) return cached;
  cached = {
    fleetCarrierPersonaEnabled: readBool(
      process.env.FLEET_CARRIER_PERSONA_ENABLED,
      FLEET_CARRIER_PERSONA_ENABLED_DEFAULT,
    ),
  };
  return cached;
}

/** Convenience predicate - equivalent to getFeatureFlags().fleetCarrierPersonaEnabled. */
export function isFleetCarrierPersonaEnabled(): boolean {
  return getFeatureFlags().fleetCarrierPersonaEnabled;
}

/**
 * Test-only: clear the memoized flags so a fresh process.env can be read.
 * Production code never calls this. Tests use it to flip a flag within a
 * single process.
 */
export function _resetFeatureFlagsForTests(): void {
  cached = null;
}
