/**
 * Fleet-carrier persona flag semantics.
 *
 * The whole mute is driven by ONE flag, FLEET_CARRIER_PERSONA_ENABLED, read
 * through a single helper. Re-enabling the persona is exactly one env change
 * plus a restart - no code edits. These tests pin that contract: the default
 * is muted, the env parses the usual truthy/falsy spellings, and flipping the
 * env (with the test-only cache reset that stands in for a process restart)
 * flips the predicate with no code change.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isFleetCarrierPersonaEnabled,
  getFeatureFlags,
  _resetFeatureFlagsForTests,
} from '../../../src/config/featureFlags';

const ENV_KEY = 'FLEET_CARRIER_PERSONA_ENABLED';

beforeEach(() => {
  delete process.env[ENV_KEY];
  _resetFeatureFlagsForTests();
});

afterEach(() => {
  delete process.env[ENV_KEY];
  _resetFeatureFlagsForTests();
});

describe('FLEET_CARRIER_PERSONA_ENABLED', () => {
  it('defaults to muted (false) when the env is unset', () => {
    expect(isFleetCarrierPersonaEnabled()).toBe(false);
  });

  it('parses truthy spellings as enabled', () => {
    for (const v of ['1', 'true', 'on', 'yes', 'TRUE', ' On ']) {
      process.env[ENV_KEY] = v;
      _resetFeatureFlagsForTests();
      expect(isFleetCarrierPersonaEnabled()).toBe(true);
    }
  });

  it('parses falsy spellings as muted', () => {
    for (const v of ['0', 'false', 'off', 'no', 'FALSE']) {
      process.env[ENV_KEY] = v;
      _resetFeatureFlagsForTests();
      expect(isFleetCarrierPersonaEnabled()).toBe(false);
    }
  });

  it('falls back to the muted default on an unrecognised value', () => {
    process.env[ENV_KEY] = 'maybe';
    _resetFeatureFlagsForTests();
    expect(isFleetCarrierPersonaEnabled()).toBe(false);
  });

  it('flips config-only: an env change plus a restart is enough, no code edit', () => {
    // Muted at boot.
    expect(isFleetCarrierPersonaEnabled()).toBe(false);
    // Operator sets the env and restarts (modelled by the cache reset).
    process.env[ENV_KEY] = 'true';
    _resetFeatureFlagsForTests();
    expect(isFleetCarrierPersonaEnabled()).toBe(true);
    // And back again.
    process.env[ENV_KEY] = 'false';
    _resetFeatureFlagsForTests();
    expect(isFleetCarrierPersonaEnabled()).toBe(false);
  });

  it('memoises within a run so mid-request env changes do not take effect', () => {
    expect(getFeatureFlags().fleetCarrierPersonaEnabled).toBe(false);
    process.env[ENV_KEY] = 'true'; // no reset -> still cached
    expect(getFeatureFlags().fleetCarrierPersonaEnabled).toBe(false);
  });
});
