// Consumer contract: carrier-web -> loadlead-api
//
// CARRIER_ADMIN's distinct surface: dashboard aggregations, driver roster,
// member invitations. Different from driver-web (which is a per-truck loop)
// and from oo-web (which is a one-person business). The carrier-web UI
// reads the org-scoped dashboard, manages a roster, and invites team
// members under the IAM matrix.

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, expect } from 'vitest';

const { eachLike, like, string, regex } = MatchersV3;

const provider = new PactV3({
  consumer: 'carrier-web',
  provider: 'loadlead-api',
  dir:      path.resolve(__dirname, '../../../pact/pacts'),
  logLevel: 'warn',
});

describe('Contract: carrier-web -> loadlead-api', () => {
  it('[H6] GET /api/org/:orgId/dashboard returns the dispatcher view shape', async () => {
    provider
      .given('a carrier org has 3 active drivers and 5 loads in flight')
      .uponReceiving('a request for the carrier dashboard')
      .withRequest({
        method: 'GET',
        path:   '/api/org/org_carrier_test_1/dashboard',
        headers: { Cookie: 'token=test-carrier-admin-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: like({
          orgId: regex('^org_[a-zA-Z0-9_-]+$', 'org_carrier_test_1'),
          activeLoads: like({
            inTransit: like(5),
            unassigned: like(0),
          }),
          drivers: eachLike({
            driverId: regex('^driver_[a-zA-Z0-9_-]+$', 'driver_abc123'),
            firstName: string('Sam'),
            lastName: string('Driver'),
            idvStatus: regex('^(UNVERIFIED|PENDING|VERIFIED|REJECTED|EXPIRED)$', 'VERIFIED'),
            status: regex('^(AVAILABLE|ON_LOAD|UNAVAILABLE)$', 'AVAILABLE'),
          }, 1),
          revenue: like({
            grossRevenue: like(42000),
            rpm: like(2.45),
          }),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/org/org_carrier_test_1/dashboard`, {
        headers: { Cookie: 'token=test-carrier-admin-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.orgId).toBe('org_carrier_test_1');
      expect(Array.isArray(body.drivers)).toBe(true);
      expect(body.drivers[0].idvStatus).toMatch(/UNVERIFIED|PENDING|VERIFIED|REJECTED|EXPIRED/);
    });
  });

  it('[H6] POST /api/org/:orgId/invitations issues a membership invite for a new team member', async () => {
    provider
      .given('a carrier org owner is logged in')
      .uponReceiving('a request to invite a DISPATCHER to the org')
      .withRequest({
        method: 'POST',
        path:   '/api/org/org_carrier_test_1/invitations',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'token=test-carrier-admin-jwt',
        },
        body: like({
          email: 'dispatcher@example.com',
          orgRole: 'DISPATCHER',
        }),
      })
      .willRespondWith({
        status: 201,
        body: like({
          invitation: like({
            token: regex('^[a-f0-9-]+$', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
            email: string('dispatcher@example.com'),
            orgRole: regex('^(OWNER|MANAGER|DISPATCHER|ORG_DRIVER|SHIPPER_USER)$', 'DISPATCHER'),
            expiresAt: like(1800000000000),
          }),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/org/org_carrier_test_1/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'token=test-carrier-admin-jwt' },
        body: JSON.stringify({ email: 'dispatcher@example.com', orgRole: 'DISPATCHER' }),
      });
      expect(r.status).toBe(201);
      const body = await r.json();
      expect(body.invitation.email).toBe('dispatcher@example.com');
    });
  });

  // AuthZ-as-contract: an ORG_DRIVER (lowest org role) requesting the
  // dashboard must get 403, not 200-with-empty-data. The dashboard UI
  // routes 403 to the "insufficient permission" empty state. Flipping
  // this to 200 would leak aggregate revenue to drivers.
  it('[H6] GET /api/org/:orgId/dashboard returns 403 for a member without dashboard:read permission', async () => {
    provider
      .given('an ORG_DRIVER is a member of the org but lacks dashboard:read permission')
      .uponReceiving('a request for the carrier dashboard from an ORG_DRIVER')
      .withRequest({
        method: 'GET',
        path:   '/api/org/org_carrier_test_1/dashboard',
        headers: { Cookie: 'token=test-org-driver-jwt' },
      })
      .willRespondWith({
        status: 403,
        body: like({ error: string('Insufficient permission') }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/org/org_carrier_test_1/dashboard`, {
        headers: { Cookie: 'token=test-org-driver-jwt' },
      });
      expect(r.status).toBe(403);
    });
  });
});
