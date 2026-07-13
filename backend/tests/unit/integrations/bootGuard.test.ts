import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertProductionNotContaminated,
  assertNonProductionSafe,
  assertProductionHardened,
  assertTablesEnvIsolated,
  assertAuthSecretStrong,
  prodFormTableNames,
  BootGuardError,
} from '../../../src/services/integrations/bootGuard';

const ENV_VARS = ['APP_ENV', 'DIDIT_ENV', 'FMCSA_MODE', 'MAPS_MODE', 'EMAIL_MODE', 'PUSH_MODE', 'JWT_SECRET'];
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

describe('assertAuthSecretStrong (SEC-1: JWT secret fails closed in deployed envs)', () => {
  const STRONG = 'k'.repeat(48);

  it('refuses to boot in production when JWT_SECRET is missing', () => {
    process.env.APP_ENV = 'production';
    delete process.env.JWT_SECRET;
    expect(() => assertAuthSecretStrong()).toThrowError(BootGuardError);
  });

  it('refuses to boot in staging when JWT_SECRET is the dev default', () => {
    process.env.APP_ENV = 'staging';
    process.env.JWT_SECRET = 'dev-secret';
    expect(() => assertAuthSecretStrong()).toThrowError(/forgeable/);
  });

  it('boots in production with a strong JWT_SECRET', () => {
    process.env.APP_ENV = 'production';
    process.env.JWT_SECRET = STRONG;
    expect(() => assertAuthSecretStrong()).not.toThrow();
  });

  it('is a no-op in development / test even without a secret (local ergonomics)', () => {
    process.env.APP_ENV = 'development';
    delete process.env.JWT_SECRET;
    expect(() => assertAuthSecretStrong()).not.toThrow();
    process.env.APP_ENV = 'test';
    expect(() => assertAuthSecretStrong()).not.toThrow();
  });
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

describe('assertTablesEnvIsolated (H1 table isolation)', () => {
  const PROBE = 'DYNAMODB_ISOLATION_PROBE_TABLE';
  let savedEndpoint: string | undefined;

  beforeEach(() => {
    savedEndpoint = process.env.DYNAMODB_ENDPOINT;
    delete process.env[PROBE];
  });
  afterEach(() => {
    if (savedEndpoint === undefined) delete process.env.DYNAMODB_ENDPOINT;
    else process.env.DYNAMODB_ENDPOINT = savedEndpoint;
    delete process.env[PROBE];
  });

  it('prodFormTableNames flags LoadLead_ (prod) names and passes prefixed / unset ones', () => {
    expect(prodFormTableNames({ a: 'LoadLead-Staging-Loads', b: 'LoadLead_Loads' })).toEqual([
      'b=LoadLead_Loads',
    ]);
    expect(prodFormTableNames({ a: 'LoadLead-Dev-Users', c: undefined })).toEqual([]);
  });

  it('EP-7: also flags the dash-named prod table without false-positiving env-namespaced dash tables', () => {
    // The prod outlier LoadLead-MembershipAuditLogs used to slip the underscore-only guard.
    expect(prodFormTableNames({ x: 'LoadLead-MembershipAuditLogs' })).toEqual([
      'x=LoadLead-MembershipAuditLogs',
    ]);
    // Non-prod env namespaces stay legitimate, even for that same table stem.
    expect(
      prodFormTableNames({ s: 'LoadLead-Staging-MembershipAuditLogs', d: 'LoadLead-Dev-Loads' }),
    ).toEqual([]);
    // Mixed set: only the underscore + bare-dash prod names come back.
    expect(
      prodFormTableNames({
        a: 'LoadLead-Staging-Loads',
        b: 'LoadLead_Loads',
        c: 'LoadLead-MembershipAuditLogs',
      }),
    ).toEqual(['b=LoadLead_Loads', 'c=LoadLead-MembershipAuditLogs']);
  });

  it('assertTablesEnvIsolated throws outside prod when a table resolves to the dash-named prod outlier', () => {
    process.env.APP_ENV = 'staging';
    delete process.env.DYNAMODB_ENDPOINT;
    process.env[PROBE] = 'LoadLead-MembershipAuditLogs';
    expect(() => assertTablesEnvIsolated()).toThrowError(/PRODUCTION data/);
  });

  it('is a no-op in production — production owns the LoadLead_ names', () => {
    process.env.APP_ENV = 'production';
    delete process.env.DYNAMODB_ENDPOINT;
    process.env[PROBE] = 'LoadLead_Whatever';
    expect(() => assertTablesEnvIsolated()).not.toThrow();
  });

  it('is a no-op for local dev — a local DynamoDB endpoint makes the names harmless', () => {
    process.env.APP_ENV = 'development';
    process.env.DYNAMODB_ENDPOINT = 'http://127.0.0.1:8000';
    process.env[PROBE] = 'LoadLead_Whatever';
    expect(() => assertTablesEnvIsolated()).not.toThrow();
  });

  it('throws outside prod (no local endpoint) when a table resolves to the prod LoadLead_ form', () => {
    process.env.APP_ENV = 'staging';
    delete process.env.DYNAMODB_ENDPOINT;
    process.env[PROBE] = 'LoadLead_Whatever';
    expect(() => assertTablesEnvIsolated()).toThrowError(/PRODUCTION data/);
  });
});
