/**
 * requireFleetCarrierPersona middleware.
 *
 * While the fleet-carrier persona is muted, endpoints that exist only to
 * serve that persona return 403 with a machine-readable { code:
 * 'PERSONA_DISABLED' } so the FE can render the friendly interstitial. When
 * the persona is enabled the gate is transparent. Platform Admin always
 * bypasses so oversight over existing fleet accounts is never blocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserRole } from '../../../src/types';

vi.mock('../../../src/config/environment', () => {
  const cfg = {
    dynamodb: { membershipsTable: 'Memberships', orgsTable: 'Organizations' },
    jwt: { secret: 'test' },
    aws: {},
    appEnv: 'test',
    nodeEnv: 'test',
  };
  return { config: cfg, default: cfg };
});

import { requireFleetCarrierPersona } from '../../../src/middleware/auth';
import { _resetFeatureFlagsForTests } from '../../../src/config/featureFlags';

const ENV_KEY = 'FLEET_CARRIER_PERSONA_ENABLED';

function mockReqRes(role?: UserRole) {
  const req: any = { user: role ? { userId: 'U1', email: 't@t.com', role } : undefined };
  const res: any = {
    statusCode: 0,
    body: undefined,
    status: vi.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: vi.fn(function (this: any, b: any) { this.body = b; return this; }),
  };
  const next = vi.fn();
  return { req, res, next };
}

function setFlag(on: boolean) {
  process.env[ENV_KEY] = on ? 'true' : 'false';
  _resetFeatureFlagsForTests();
}

beforeEach(() => { delete process.env[ENV_KEY]; _resetFeatureFlagsForTests(); });
afterEach(() => { delete process.env[ENV_KEY]; _resetFeatureFlagsForTests(); });

describe('requireFleetCarrierPersona', () => {
  it('muted: a fleet-carrier admin is blocked with PERSONA_DISABLED (403)', () => {
    setFlag(false);
    const { req, res, next } = mockReqRes(UserRole.CARRIER_ADMIN);
    requireFleetCarrierPersona(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'PERSONA_DISABLED' });
  });

  it('muted: an unauthenticated caller (public carrier signup) is blocked', () => {
    setFlag(false);
    const { req, res, next } = mockReqRes(undefined);
    requireFleetCarrierPersona(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'PERSONA_DISABLED' });
  });

  it('muted: Platform Admin bypasses the gate (oversight never blocked)', () => {
    setFlag(false);
    const { req, res, next } = mockReqRes(UserRole.ADMIN);
    requireFleetCarrierPersona(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('enabled: the gate is transparent for a fleet-carrier admin', () => {
    setFlag(true);
    const { req, res, next } = mockReqRes(UserRole.CARRIER_ADMIN);
    requireFleetCarrierPersona(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
