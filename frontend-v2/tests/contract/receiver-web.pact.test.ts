// Consumer contract: receiver-web -> loadlead-api
//
// Receiver's surface is intentionally small: inbound shipments list +
// confirm delivery. The persona has no role in posting loads or
// dispatching; the contract is mostly read-side with one critical
// write (POST /confirm gated by a RECEIVER_CONFIRM signature on the
// chain, per the attestation flow).

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, expect } from 'vitest';

const { eachLike, like, string, regex } = MatchersV3;

const provider = new PactV3({
  consumer: 'receiver-web',
  provider: 'loadlead-api',
  dir:      path.resolve(__dirname, '../../../pact/pacts'),
  logLevel: 'warn',
});

describe('Contract: receiver-web -> loadlead-api', () => {
  it('[H9] GET /api/receiver/incoming returns inbound shipments for the receiver facility', async () => {
    provider
      .given('a receiver has 2 in-transit shipments assigned to their facility')
      .uponReceiving('a request for the receiver incoming list')
      .withRequest({
        method: 'GET',
        path:   '/api/receiver/incoming',
        headers: { Cookie: 'token=test-receiver-jwt' },
      })
      .willRespondWith({
        status: 200,
        body: like({
          loads: eachLike({
            loadId:        regex('^load_[a-f0-9-]+$', 'load_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
            status:        regex('^IN_TRANSIT$', 'IN_TRANSIT'),
            pickupCity:    string('Houston'),
            pickupState:   regex('^[A-Z]{2}$', 'TX'),
            deliveryCity:  string('Dallas'),
            deliveryState: regex('^[A-Z]{2}$', 'TX'),
            assignedDriverId: regex('^driver_[a-zA-Z0-9_-]+$', 'driver_abc'),
          }, 1),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/receiver/incoming`, {
        headers: { Cookie: 'token=test-receiver-jwt' },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.loads[0].status).toBe('IN_TRANSIT');
    });
  });

  it('[H9] POST /api/receiver/loads/:loadId/confirm without RECEIVER_CONFIRM signature returns 412', async () => {
    provider
      .given('a load IN_TRANSIT to this receiver has no RECEIVER_CONFIRM signature yet')
      .uponReceiving('a request to confirm delivery without first signing')
      .withRequest({
        method: 'POST',
        path:   '/api/receiver/loads/load_test_incoming/confirm',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'token=test-receiver-jwt',
        },
        body: like({}),
      })
      .willRespondWith({
        status: 412,
        body: like({
          message: string('RECEIVER_CONFIRM signature is required'),
          statusCode: like(412),
        }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/receiver/loads/load_test_incoming/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'token=test-receiver-jwt' },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(412);
    });
  });

  // AuthZ-as-contract: a receiver requesting a load they aren't the
  // assigned receiver on must get 404 (not 403) — same existence-leak
  // protection as the shipper contract on the other end.
  it('[H9] GET /api/receiver/loads/:id returns 404 for a load destined for a different receiver', async () => {
    provider
      .given('a load exists destined for a different receiver facility')
      .uponReceiving('a request for a load that does not belong to this receiver')
      .withRequest({
        method: 'GET',
        path:   '/api/receiver/loads/load_other_receiver',
        headers: { Cookie: 'token=test-receiver-jwt' },
      })
      .willRespondWith({
        status: 404,
        body: like({ error: string('Load not found') }),
      });

    await provider.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/receiver/loads/load_other_receiver`, {
        headers: { Cookie: 'token=test-receiver-jwt' },
      });
      expect(r.status).toBe(404);
    });
  });
});
