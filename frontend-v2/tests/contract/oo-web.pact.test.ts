// Consumer contract: oo-web -> loadlead-api
//
// Owner Operator's surface blends two things no other persona has at once:
// a self-driver (they're their own driver) PLUS a one-person business with
// fleet ownership. The OO dashboard aggregates both; the verification
// surface needs TWO gates (authority + identity) where Driver needs only
// identity and Carrier needs only authority.

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, expect } from 'vitest';

const { eachLike, like, string, regex } = MatchersV3;

const provider = new PactV3({
  consumer: 'oo-web',
  provider: 'loadlead-api',
  dir:      path.resolve(__dirname, '../../../pact/pacts'),
  logLevel: 'warn',
});

describe('Contract: oo-web -> loadlead-api', () => {
  it('GET /api/owner-operator/dashboard returns blended self-haul + fleet metrics', async () => {
    provider
      .given('an owner operator has 1 self-driver and 2 fleet drivers')
      .uponReceiving('a request for the OO blended dashboard')
      .withRequest({
        method: 'GET',
        path:   '/api/owner-operator/dashboard',
        headers: { Cookie: 'token=test-oo-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: like({
          operatorId: regex('^op_[a-zA-Z0-9_-]+$', 'op_test_1'),
          selfDriver: like({
            driverId:  regex('^driver_[a-zA-Z0-9_-]+$', 'driver_oo_self'),
            isSelf:    like(true),
            status:    regex('^(AVAILABLE|ON_LOAD|UNAVAILABLE)$', 'AVAILABLE'),
          }),
          fleetDrivers: eachLike({
            driverId:  regex('^driver_[a-zA-Z0-9_-]+$', 'driver_fleet_1'),
            isSelf:    like(false),
            status:    regex('^(AVAILABLE|ON_LOAD|UNAVAILABLE)$', 'AVAILABLE'),
          }, 1),
          activeLoads: like(3),
          grossRevenue: like(18500),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/owner-operator/dashboard`, {
        headers: { Cookie: 'token=test-oo-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.selfDriver.isSelf).toBe(true);
      expect(Array.isArray(body.fleetDrivers)).toBe(true);
    });
  });

  it('GET /api/owner-operator/verification returns the carrier-authority gate state', async () => {
    provider
      .given('an owner operator has submitted FMCSA + KYB but not yet IDV')
      .uponReceiving('a request for the OO carrier-authority verification state')
      .withRequest({
        method: 'GET',
        path:   '/api/owner-operator/verification',
        headers: { Cookie: 'token=test-oo-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: like({
          verification: like({
            entityType: regex('^OWNER_OPERATOR$', 'OWNER_OPERATOR'),
            verificationStatus: regex('^(UNVERIFIED|PENDING|VERIFIED|REJECTED|EXPIRED)$', 'PENDING'),
            fmcsaStatus: regex('^(active|inactive|unknown)$', 'active'),
            kybStatus: regex('^(PASSED|PENDING|FAILED)$', 'PASSED'),
          }),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/owner-operator/verification`, {
        headers: { Cookie: 'token=test-oo-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.verification.entityType).toBe('OWNER_OPERATOR');
    });
  });

  it('GET /api/owner-operator/fleet/invites returns the pending fleet invitations list', async () => {
    provider
      .given('an owner operator has 2 pending fleet driver invitations')
      .uponReceiving('a request for the OO fleet invites list')
      .withRequest({
        method: 'GET',
        path:   '/api/owner-operator/fleet/invites',
        headers: { Cookie: 'token=test-oo-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: like({
          invites: eachLike({
            inviteId: regex('^invite_[a-zA-Z0-9_-]+$', 'invite_abc'),
            email:    string('newdriver@example.com'),
            token:    regex('^[a-f0-9-]+$', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
            expiresAt: like(1800000000000),
          }, 1),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/owner-operator/fleet/invites`, {
        headers: { Cookie: 'token=test-oo-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(Array.isArray(body.invites)).toBe(true);
    });
  });
});
