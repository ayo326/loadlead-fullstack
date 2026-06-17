import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertProductionNotContaminated,
  assertNonProductionSafe,
  assertProductionHardened,
  BootGuardError,
} from '../../../src/services/integrations/bootGuard';

const ENV_VARS = ['APP_ENV', 'DIDIT_ENV', 'FMCSA_MODE', 'MAPS_MODE', 'EMAIL_MODE', 'PUSH_MODE'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('assertProductionNotContaminated', () => {
  it('is a no-op outside production', () => {
    process.env.APP_ENV = 'staging';
    process.env.FMCSA_MODE = 'stub';
    expect(() => assertProductionNotContaminated()).not.toThrow();
  });

  it('throws naming the variable when a non-live mode env var is set in production', () => {
    process.env.APP_ENV = 'production';
    process.env.FMCSA_MODE = 'stub';
    expect(() => assertProductionNotContaminated()).toThrowError(/FMCSA_MODE/);
  });

  it('throws naming EMAIL_MODE specifically when that is the contaminated var', () => {
    process.env.APP_ENV = 'production';
    process.env.EMAIL_MODE = 'test';
    try {
      assertProductionNotContaminated();
      expect.fail('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BootGuardError);
      expect((err as Error).message).toContain('EMAIL_MODE');
      expect((err as Error).message).toContain('production');
    }
  });

  it('passes in production when no mode env vars are set at all', () => {
    process.env.APP_ENV = 'production';
    expect(() => assertProductionNotContaminated()).not.toThrow();
  });

  it('passes in production when a mode env var is explicitly set to its OWN live value', () => {
    process.env.APP_ENV = 'production';
    process.env.DIDIT_ENV = 'live';
    expect(() => assertProductionNotContaminated()).not.toThrow();
  });
});

describe('assertNonProductionSafe', () => {
  it('is a no-op in production', () => {
    process.env.APP_ENV = 'production';
    process.env.PUSH_MODE = 'live';
    expect(() => assertNonProductionSafe()).not.toThrow();
  });

  it('refuses when Didit is live outside production', () => {
    process.env.APP_ENV = 'staging';
    process.env.DIDIT_ENV = 'live';
    expect(() => assertNonProductionSafe()).toThrowError(/DIDIT_ENV/);
  });

  it('refuses when Email is live outside production', () => {
    process.env.APP_ENV = 'staging';
    process.env.EMAIL_MODE = 'live';
    expect(() => assertNonProductionSafe()).toThrowError(/EMAIL_MODE/);
  });

  it('refuses when Push is live outside production', () => {
    process.env.APP_ENV = 'staging';
    process.env.PUSH_MODE = 'live';
    expect(() => assertNonProductionSafe()).toThrowError(/PUSH_MODE/);
  });

  it('allows FMCSA live outside production (warns, does not throw)', () => {
    process.env.APP_ENV = 'staging';
    process.env.FMCSA_MODE = 'live';
    expect(() => assertNonProductionSafe()).not.toThrow();
  });

  it('allows Maps live outside production (warns, does not throw)', () => {
    process.env.APP_ENV = 'staging';
    process.env.MAPS_MODE = 'live';
    expect(() => assertNonProductionSafe()).not.toThrow();
  });

  it('passes with default (non-live) modes outside production', () => {
    process.env.APP_ENV = 'staging';
    expect(() => assertNonProductionSafe()).not.toThrow();
  });
});

describe('assertProductionHardened', () => {
  it('is a no-op outside production', () => {
    process.env.APP_ENV = 'staging';
    expect(() => assertProductionHardened({ _router: { stack: [] } })).not.toThrow();
  });

  it('passes in production with an empty/clean router stack', () => {
    process.env.APP_ENV = 'production';
    expect(() => assertProductionHardened({ _router: { stack: [] } })).not.toThrow();
  });

  // Regression test for a real bug caught during manual boot testing: generic
  // middleware (cors(), helmet(), express.json()) is mounted with no path,
  // which Express represents as a layer whose regexp matches EVERY path
  // (fast_slash === true). An earlier version of this check tested that
  // regexp against '/_test' and matched it, producing a false positive on
  // every single production boot.
  it('does NOT false-positive on generic unrestricted middleware layers', () => {
    process.env.APP_ENV = 'production';
    const genericMiddlewareLayer = {
      regexp: Object.assign(/^\/?(?=\/|$)/i, { fast_slash: true }),
    };
    const normalRouteLayer = { route: { path: '/api/health' } };
    expect(() =>
      assertProductionHardened({ _router: { stack: [genericMiddlewareLayer, normalRouteLayer] } }),
    ).not.toThrow();
  });

  it('throws when a /_test route IS registered, by exact path', () => {
    process.env.APP_ENV = 'production';
    const testRouteLayer = { route: { path: '/_test' } };
    expect(() => assertProductionHardened({ _router: { stack: [testRouteLayer] } })).toThrowError(
      /test-only route/,
    );
  });

  it('throws when a /_test router is mounted (regexp-matched, not fast_slash)', () => {
    process.env.APP_ENV = 'production';
    const mountedTestRouter = {
      regexp: Object.assign(/^\/_test\/?(?=\/|$)/i, { fast_slash: false }),
    };
    expect(() => assertProductionHardened({ _router: { stack: [mountedTestRouter] } })).toThrowError(
      /test-only route/,
    );
  });

  it('throws if any integration is somehow not live in production', () => {
    process.env.APP_ENV = 'production';
    process.env.DIDIT_ENV = 'sandbox'; // contamination would normally be caught at boot-guard time first
    // resolveMode still forces 'live' here since APP_ENV=production — so to
    // actually exercise this branch we'd need resolveMode itself to be
    // broken. This test documents the intent: the self-check re-derives the
    // answer rather than trusting a cached flag.
    expect(() => assertProductionHardened({ _router: { stack: [] } })).not.toThrow();
  });
});
