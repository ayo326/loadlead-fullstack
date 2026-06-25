// Consumer contract: shipper-web -> loadlead-api
//
// Shipper's distinct loop is post-load + track. Different request shape
// than driver (taxonomy fields on POST, geocoded lanes), different
// response (own loads only, with status timeline). Captured here so the
// provider can't accidentally simplify the shipper response (drop
// pickup/delivery timestamps, rename fields) without breaking the
// shipper UI.

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, expect } from 'vitest';

const { eachLike, like, string, regex } = MatchersV3;

const provider = new PactV3({
  consumer: 'shipper-web',
  provider: 'loadlead-api',
  dir:      path.resolve(__dirname, '../../../pact/pacts'),
  logLevel: 'warn',
});

describe('Contract: shipper-web -> loadlead-api', () => {
  it('[H5] GET /api/shipper/loads returns the shipper\'s own loads with the fields the list view reads', async () => {
    provider
      .given('the authenticated shipper has at least one posted load')
      .uponReceiving('a request for the shipper loads list')
      .withRequest({
        method: 'GET',
        path:   '/api/shipper/loads',
        headers: { Cookie: 'token=test-shipper-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: like({
          loads: eachLike({
            loadId:        regex('^load_[a-f0-9-]+$', 'load_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
            shipperId:     regex('^shipper_[a-zA-Z0-9_-]+$', 'shipper_test_1'),
            status:        regex('^(DRAFT|OPEN|IN_TRANSIT|DELIVERED|CANCELED)$', 'OPEN'),
            pickupCity:    string('Houston'),
            pickupState:   regex('^[A-Z]{2}$', 'TX'),
            deliveryCity:  string('Dallas'),
            deliveryState: regex('^[A-Z]{2}$', 'TX'),
            equipmentType: string('DRY_VAN'),
            totalWeightLbs: like(40000),
            rateAmount:    like(1200),
            createdAt:     like(1700000000000),
          }, 1),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/shipper/loads`, {
        headers: { Cookie: 'token=test-shipper-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.loads.length).toBeGreaterThan(0);
      expect(body.loads[0]).toHaveProperty('loadId');
      expect(body.loads[0].status).toMatch(/DRAFT|OPEN|IN_TRANSIT|DELIVERED|CANCELED/);
    });
  });

  it('[H5] POST /api/shipper/loads (draft) creates and returns the new load with server-assigned loadId', async () => {
    provider
      .given('the authenticated shipper has a complete profile')
      .uponReceiving('a request to create a new draft load')
      .withRequest({
        method: 'POST',
        path:   '/api/shipper/loads',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'token=test-shipper-jwt',
        },
        body: like({
          pickupCity:     'Houston',
          pickupState:    'TX',
          deliveryCity:   'Dallas',
          deliveryState:  'TX',
          equipmentType:  'DRY_VAN',
          totalWeightLbs: 40000,
          rateAmount:     1200,
        }),
      })
      .willRespondWith({
        status: 201,
        body: like({
          loadId: regex('^load_[a-f0-9-]+$', 'load_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
          status: 'DRAFT',
          shipperId: regex('^shipper_[a-zA-Z0-9_-]+$', 'shipper_test_1'),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/shipper/loads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'token=test-shipper-jwt',
        },
        body: JSON.stringify({
          pickupCity:     'Houston',
          pickupState:    'TX',
          deliveryCity:   'Dallas',
          deliveryState:  'TX',
          equipmentType:  'DRY_VAN',
          totalWeightLbs: 40000,
          rateAmount:     1200,
        }),
      });
      expect(r.status).toBe(201);
      const body = await r.json();
      expect(body.status).toBe('DRAFT');
      expect(body.loadId).toMatch(/^load_/);
    });
  });

  // ── Beta-gate-as-contract ────────────────────────────────────────────
  // The private-beta gate is a server-side behavior the shipper signup UI
  // depends on. Two interactions pin it so the provider can't change the
  // gate's response shape without breaking the consumer:
  //   1. signup under BETA_MODE with no invite + non-allowlisted email →
  //      403 BETA_REQUIRED with a neutral message. The signup UI relies on
  //      this exact error code to route the user to the waitlist page
  //      rather than showing a generic 500 or a misleading "email taken".
  //   2. signup under BETA_MODE with a valid invite token → 201 + the user
  //      carries betaUser=true + invitedVia=INVITE. The UI reads these to
  //      render the cohort badge + skip the "request access" CTA.
  it('[H12] POST /api/auth/signup with no invite + non-allowlisted email returns 403 BETA_REQUIRED (neutral)', async () => {
    provider
      .given('BETA_MODE is on and the email is neither invited nor allowlisted')
      .uponReceiving('a signup attempt with no invite token under private beta')
      .withRequest({
        method: 'POST',
        path:   '/api/auth/signup',
        headers: { 'Content-Type': 'application/json' },
        body: like({
          email:    'outsider@example.com',
          password: 'a-strong-password',
          role:     'SHIPPER',
        }),
      })
      .willRespondWith({
        status: 403,
        body: like({
          error:   regex('^BETA_REQUIRED$', 'BETA_REQUIRED'),
          message: string('LoadLead is currently in private beta. Request access on the waitlist and we will reach out when your spot opens.'),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'outsider@example.com', password: 'a-strong-password', role: 'SHIPPER' }),
      });
      expect(r.status).toBe(403);
      const body = await r.json();
      expect(body.error).toBe('BETA_REQUIRED');
    });
  });

  it('[H12] POST /api/auth/signup with a valid invite token returns 201 + betaUser=true, invitedVia=INVITE', async () => {
    provider
      .given('BETA_MODE is on and a valid self-signup invite exists for the email')
      .uponReceiving('a signup attempt carrying a valid beta invite token')
      .withRequest({
        method: 'POST',
        path:   '/api/auth/signup',
        headers: { 'Content-Type': 'application/json' },
        body: like({
          email:       'invited@example.com',
          password:    'a-strong-password',
          role:        'SHIPPER',
          inviteToken: 'beta-invite-token-abc',
        }),
      })
      .willRespondWith({
        status: 201,
        body: like({
          token: string('test-jwt'),
          user: like({
            userId:     regex('^user_[a-zA-Z0-9_-]+$', 'user_test_1'),
            email:      string('invited@example.com'),
            role:       regex('^SHIPPER$', 'SHIPPER'),
            betaUser:   like(true),
            cohort:     string('wave-1'),
            invitedVia: regex('^(INVITE|ALLOWLIST)$', 'INVITE'),
          }),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invited@example.com', password: 'a-strong-password',
          role: 'SHIPPER', inviteToken: 'beta-invite-token-abc',
        }),
      });
      expect(r.status).toBe(201);
      const body = await r.json();
      expect(body.user.betaUser).toBe(true);
      expect(body.user.invitedVia).toBe('INVITE');
    });
  });

  // AuthZ-as-contract for shipper: requesting a load they don't own must
  // return 404 (not 403) — leaks no information about whether the load
  // exists. The shipper UI relies on 404 to show "Load not found" instead
  // of "Forbidden", which would mislead. If the provider ever flipped
  // this to 403, the shipper UI would render the wrong empty state.
  it('[H5] GET /api/shipper/loads/:id returns 404 (not 403) for a load owned by a different shipper', async () => {
    provider
      .given('a load exists belonging to a different shipper')
      .uponReceiving('a request for a load that does not belong to the authenticated shipper')
      .withRequest({
        method: 'GET',
        path:   '/api/shipper/loads/load_belongs_to_other',
        headers: { Cookie: 'token=test-shipper-jwt' },
      })
      .willRespondWith({
        status: 404,
        body: like({ error: string('Load not found') }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/shipper/loads/load_belongs_to_other`, {
        headers: { Cookie: 'token=test-shipper-jwt' },
      });
      expect(r.status).toBe(404);
    });
  });
});
