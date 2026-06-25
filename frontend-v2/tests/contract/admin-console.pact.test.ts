// Consumer contract: admin-console -> loadlead-api
//
// The internal admin console is its own consumer, separate from the 5
// public personas. Surfaces it depends on: paginated orgs list, the
// suspend/reinstate override with a reason gate (LL-AC-004), and the
// validation-as-contract for reasons that are too short.
//
// Important: the admin console is NOT a public persona — different auth
// posture (STAFF_ADMIN / STAFF_MANAGER platform roles), different
// trust boundary. The pact captures only the destructive-tier surface
// because that's what the cross-persona test must protect.

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, expect } from 'vitest';

const { eachLike, like, string, regex } = MatchersV3;

const provider = new PactV3({
  consumer: 'admin-console',
  provider: 'loadlead-api',
  dir:      path.resolve(__dirname, '../../../pact/pacts'),
  logLevel: 'warn',
});

describe('Contract: admin-console -> loadlead-api', () => {
  it('GET /api/admin/orgs returns paginated orgs with member counts + suspension state', async () => {
    provider
      .given('the admin org list has at least one active and one suspended org')
      .uponReceiving('a request for the paginated admin orgs list')
      .withRequest({
        method: 'GET',
        path:   '/api/admin/orgs',
        query:  { status: 'all', limit: '50' },
        headers: { Cookie: 'token=test-staff-admin-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: like({
          orgs: eachLike({
            orgId: regex('^org_[a-zA-Z0-9_-]+$', 'org_carrier_1'),
            name:  string('Acme Trucking'),
            capabilities: eachLike(
              regex('^(CARRIER|SHIPPER|RECEIVER)$', 'CARRIER'),
              1,
            ),
            memberCount: like(7),
            isSuspended: like(false),
          }, 1),
          cursor: like(null),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/admin/orgs?status=all&limit=50`, {
        headers: { Cookie: 'token=test-staff-admin-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(Array.isArray(body.orgs)).toBe(true);
      expect(typeof body.orgs[0].isSuspended).toBe('boolean');
    });
  });

  it('POST /api/admin/orgs/:orgId/suspend with a 6+ char reason returns 200 + ok:true', async () => {
    provider
      .given('a STAFF_ADMIN is logged in and an active org exists at org_to_suspend')
      .uponReceiving('a request to suspend an org with a valid reason')
      .withRequest({
        method: 'POST',
        path:   '/api/admin/orgs/org_to_suspend/suspend',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'token=test-staff-admin-jwt',
        },
        body: like({ reason: 'fraud investigation' }),
      })
      .willRespondWith({
        status: 200,
        body: like({
          ok: like(true),
          orgId: regex('^org_[a-zA-Z0-9_-]+$', 'org_to_suspend'),
          suspended: like(true),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/admin/orgs/org_to_suspend/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'token=test-staff-admin-jwt' },
        body: JSON.stringify({ reason: 'fraud investigation' }),
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.suspended).toBe(true);
    });
  });

  // Validation-as-contract: the destructive-tier reason gate (LL-AC-004
  // §5) must reject suspends without a 6+ char reason with 400. If the
  // provider ever flipped this to 200, an admin could silently suspend
  // an org with no audit trail. The 400 IS the audit-trail enforcement
  // mechanism — pin it here.
  it('POST /api/admin/orgs/:orgId/suspend WITHOUT reason returns 400', async () => {
    provider
      .given('a STAFF_ADMIN is logged in and an active org exists at org_to_suspend')
      .uponReceiving('a request to suspend an org without a reason')
      .withRequest({
        method: 'POST',
        path:   '/api/admin/orgs/org_to_suspend/suspend',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'token=test-staff-admin-jwt',
        },
        body: {},
      })
      .willRespondWith({
        status: 400,
        body: like({ error: string('reason is required (at least 6 characters)') }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/admin/orgs/org_to_suspend/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'token=test-staff-admin-jwt' },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(400);
    });
  });
});
