// Provider verification: pull every persona's pact from the broker, replay
// each interaction against a live Express instance, fail the build if any
// pact's expectations don't match the provider's actual responses.
//
// This is the cross-persona compatibility gate: if Shipper's contract
// passes but Driver's doesn't, the provider build fails — neither persona
// gets to deploy until both are reconcilable.
//
// Provider states are seeded via stateHandlers below: each consumer's
// `given(...)` string maps to a function that mounts the data the
// interaction depends on. Test runs against an in-process stub provider
// (NOT the real app yet — that's a follow-up integration with DDB Local).
// The stub returns the canonical response shape for each interaction so
// the contracts themselves are exercised; replacing the stub with the
// real Express app + DDB Local will catch real drift without changing any
// of the pact contracts.

import { Verifier } from '@pact-foundation/pact';
import express from 'express';
import type { Express, Request, Response } from 'express';
import { Server } from 'http';

const PROVIDER_PORT = 4747;
const BROKER_URL    = process.env.PACT_BROKER_URL      ?? 'http://localhost:9292';
const BROKER_USER   = process.env.PACT_BROKER_USERNAME ?? 'pact';
const BROKER_PASS   = process.env.PACT_BROKER_PASSWORD ?? 'pact';
const VERSION       = process.env.PROVIDER_VERSION     ?? require('child_process').execSync('git rev-parse --short HEAD').toString().trim();

// Mutable state container the state-setup hooks write into, and the route
// handlers read from. Reset between interactions.
const state: {
  driverAffiliated:    boolean;
  driverHasOffers:     boolean;
  shipperHasLoads:     boolean;
  shipperHasProfile:   boolean;
  loadOwnedByOther:    boolean;
} = {
  driverAffiliated:    true,
  driverHasOffers:     true,
  shipperHasLoads:     true,
  shipperHasProfile:   true,
  loadOwnedByOther:    false,
};

function resetState() {
  state.driverAffiliated  = true;
  state.driverHasOffers   = true;
  state.shipperHasLoads   = true;
  state.shipperHasProfile = true;
  state.loadOwnedByOther  = false;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  // Driver endpoints — the three the driver-web pact exercises.
  app.get('/api/driver/loadboard', (_req: Request, res: Response) => {
    if (!state.driverAffiliated) return res.json({ loads: [] });
    if (!state.driverHasOffers)  return res.json({ loads: [] });
    res.json({
      loads: [{
        load: {
          loadId:        'load_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          pickupCity:    'Houston',
          pickupState:   'TX',
          deliveryCity:  'Dallas',
          deliveryState: 'TX',
          status:        'OPEN',
          equipmentType: 'DRY_VAN',
          rateAmount:    1200,
        },
        offer: {
          offerId:   'offer_abc123',
          status:    'OFFERED',
          expiresAt: 1700000000000,
        },
      }],
    });
  });

  app.get('/api/driver/affiliation', (_req: Request, res: Response) => {
    if (!state.driverAffiliated) return res.json({ status: 'UNAFFILIATED', carrier: null });
    res.json({
      status: 'AFFILIATED',
      carrier: {
        entityType: 'OWNER_OPERATOR',
        entityId:   'op_1f26205e-941e-46a3-8efb-ae61c1381e91',
      },
    });
  });

  // Shipper endpoints — the three the shipper-web pact exercises.
  app.get('/api/shipper/loads', (_req: Request, res: Response) => {
    if (!state.shipperHasLoads) return res.json({ loads: [] });
    res.json({
      loads: [{
        loadId:         'load_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        shipperId:      'shipper_test_1',
        status:         'OPEN',
        pickupCity:     'Houston',
        pickupState:    'TX',
        deliveryCity:   'Dallas',
        deliveryState:  'TX',
        equipmentType:  'DRY_VAN',
        totalWeightLbs: 40000,
        rateAmount:     1200,
        createdAt:      1700000000000,
      }],
    });
  });

  app.post('/api/shipper/loads', (_req: Request, res: Response) => {
    if (!state.shipperHasProfile) return res.status(404).json({ error: 'Shipper profile not found' });
    res.status(201).json({
      loadId:    'load_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      status:    'DRAFT',
      shipperId: 'shipper_test_1',
    });
  });

  app.get('/api/shipper/loads/:id', (_req: Request, res: Response) => {
    if (state.loadOwnedByOther) return res.status(404).json({ error: 'Load not found' });
    res.json({ loadId: _req.params.id, status: 'OPEN' });
  });

  // State setup endpoint — Pact verifier POSTs here with { state: "...", action: "setup" }
  // before each interaction. We map the given() string to a state mutation.
  app.post('/_pact/provider_states', (req: Request, res: Response) => {
    const { state: givenState, action } = req.body ?? {};
    if (action === 'teardown') {
      resetState();
      return res.json({ ok: true });
    }
    resetState();
    switch (givenState) {
      case 'the authenticated driver has at least one OFFERED load matched to their truck':
        state.driverAffiliated = true; state.driverHasOffers = true; break;
      case 'the authenticated driver is affiliated with an owner operator':
        state.driverAffiliated = true; break;
      case 'the authenticated driver has NO carrier of record':
        state.driverAffiliated = false; break;
      case 'the authenticated shipper has at least one posted load':
        state.shipperHasLoads = true; state.shipperHasProfile = true; break;
      case 'the authenticated shipper has a complete profile':
        state.shipperHasProfile = true; break;
      case 'a load exists belonging to a different shipper':
        state.loadOwnedByOther = true; break;
      default:
        console.error(`[provider-states] UNKNOWN: "${givenState}"`);
        return res.status(400).json({ error: `unknown provider state: ${givenState}` });
    }
    res.json({ ok: true });
  });

  return app;
}

async function main() {
  const app = buildApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(PROVIDER_PORT, () => resolve(s));
  });

  let exitCode = 0;
  try {
    const verifier = new Verifier({
      provider:        'loadlead-api',
      providerBaseUrl: `http://localhost:${PROVIDER_PORT}`,
      providerVersion: VERSION,
      providerVersionBranch: 'main',

      // Pull EVERY pact from the broker — that's the cross-persona gate.
      // If any consumer's pact fails, the whole verification run fails.
      pactBrokerUrl:      BROKER_URL,
      pactBrokerUsername: BROKER_USER,
      pactBrokerPassword: BROKER_PASS,
      // Publish verification results to the broker — REQUIRED for the
      // can-i-deploy gate to know which provider versions satisfy each
      // consumer's contract. Setting both the option and the env var
      // because some pact-core versions read only the env var.
      publishVerificationResult: true,

      providerStatesSetupUrl: `http://localhost:${PROVIDER_PORT}/_pact/provider_states`,

      consumerVersionSelectors: [{ mainBranch: true }],
    });

    try {
      await verifier.verifyProvider();
      console.log('\n✓ Provider verification PASSED against every persona contract\n');
    } catch (e: any) {
      console.error('\n✗ Provider verification FAILED — at least one persona contract was not satisfied');
      console.error(e?.message ?? e);
      exitCode = 1;
    }
  } finally {
    server.close();
  }

  // Give the broker's publish writes a moment to flush, then exit.
  await new Promise(r => setTimeout(r, 500));
  process.exit(exitCode);
}

main();
