// Consumer contract: driver-web -> loadlead-api
//
// What this proves to the provider: the Driver persona depends on these
// request/response shapes from the API. If the provider verification step
// later rejects any of them, the API can't deploy until the contract is
// re-aligned (either provider catches up, or driver-web releases a new
// pact that drops the expectation).
//
// Interactions captured here mirror what frontend-v2/src/lib/api.ts uses
// on /api/driver/*. We assert TYPES via Pact matchers, not exact values —
// the provider is free to vary the data as long as the shape holds.

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, expect } from 'vitest';

const { eachLike, like, string, regex } = MatchersV3;

const provider = new PactV3({
  consumer: 'driver-web',
  provider: 'loadlead-api',
  dir:      path.resolve(__dirname, '../../../pact/pacts'),
  logLevel: 'warn',
});

describe('Contract: driver-web -> loadlead-api', () => {
  it('[H8] GET /api/driver/loadboard returns offers with the fields the dashboard reads', async () => {
    provider
      .given('the authenticated driver has at least one OFFERED load matched to their truck')
      .uponReceiving('a request for the driver loadboard')
      .withRequest({
        method: 'GET',
        path:   '/api/driver/loadboard',
        headers: { Cookie: 'token=test-driver-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: like({
          loads: eachLike({
            load: like({
              loadId:        regex('^load_[a-f0-9-]+$', 'load_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
              pickupCity:    string('Houston'),
              pickupState:   regex('^[A-Z]{2}$', 'TX'),
              deliveryCity:  string('Dallas'),
              deliveryState: regex('^[A-Z]{2}$', 'TX'),
              status:        regex('^(OPEN|IN_TRANSIT|DELIVERED|CANCELED)$', 'OPEN'),
              equipmentType: string('DRY_VAN'),
              rateAmount:    like(1200),
            }),
            offer: like({
              offerId:   regex('^offer_[a-zA-Z0-9_-]+$', 'offer_abc123'),
              status:    regex('^(OFFERED|ACCEPTED|DECLINED|EXPIRED)$', 'OFFERED'),
              expiresAt: like(1700000000000),
            }),
          }, 1),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/driver/loadboard`, {
        headers: { Cookie: 'token=test-driver-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(Array.isArray(body.loads)).toBe(true);
      expect(body.loads[0].load.status).toMatch(/OPEN|IN_TRANSIT|DELIVERED|CANCELED/);
      expect(body.loads[0].offer.status).toMatch(/OFFERED|ACCEPTED|DECLINED|EXPIRED/);
    });
  });

  it('[H8] GET /api/driver/affiliation returns AFFILIATED with carrier of record', async () => {
    provider
      .given('the authenticated driver is affiliated with an owner operator')
      .uponReceiving('a request for the driver affiliation status')
      .withRequest({
        method: 'GET',
        path:   '/api/driver/affiliation',
        headers: { Cookie: 'token=test-driver-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: like({
          status: regex('^(AFFILIATED|UNAFFILIATED|NO_PROFILE)$', 'AFFILIATED'),
          carrier: like({
            entityType: regex('^(OWNER_OPERATOR|CARRIER_ORG)$', 'OWNER_OPERATOR'),
            entityId:   string('op_1f26205e-941e-46a3-8efb-ae61c1381e91'),
          }),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/driver/affiliation`, {
        headers: { Cookie: 'token=test-driver-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(['AFFILIATED','UNAFFILIATED','NO_PROFILE']).toContain(body.status);
      if (body.status === 'AFFILIATED') {
        expect(body.carrier).toHaveProperty('entityType');
        expect(body.carrier).toHaveProperty('entityId');
      }
    });
  });

  // AuthZ-as-contract: the Driver UI EXPECTS that an unaffiliated request
  // for the loadboard still returns 200 with an empty list (because
  // /affiliation is the dedicated UNAFFILIATED signal, not /loadboard).
  // If the provider ever flipped this to 403, the dashboard would crash
  // instead of showing the "Awaiting affiliation" banner. This pact pins
  // the role-gated behavior the driver UI relies on.
  it('[H8] GET /api/driver/loadboard returns empty list for an unaffiliated driver (not 403)', async () => {
    provider
      .given('the authenticated driver has NO carrier of record')
      .uponReceiving('a request for the loadboard from an unaffiliated driver')
      .withRequest({
        method: 'GET',
        path:   '/api/driver/loadboard',
        headers: { Cookie: 'token=test-unaffiliated-driver-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: { loads: [] },
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/driver/loadboard`, {
        headers: { Cookie: 'token=test-unaffiliated-driver-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.loads).toEqual([]);
    });
  });
});
