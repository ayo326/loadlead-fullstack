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

// PACT_DELIBERATE_BREAK — reproducible @H11 cross-persona break fixture.
// When set to a consumer name, the provider stub intentionally violates
// that consumer's contract while satisfying every other consumer. Used
// by the @H11 BDD scenario to prove the cross-persona gate names the
// broken consumer and blocks the deploy. Honored only when explicitly
// set; main never ships with the break active.
//
// Supported values:
//   oo-web   — drops `selfDriver.isSelf` from the OO dashboard response
//              (which oo-web's contract requires). Satisfies every other
//              consumer; would slip through any per-persona check.
const DELIBERATE_BREAK = process.env.PACT_DELIBERATE_BREAK ?? '';
if (DELIBERATE_BREAK) {
  console.warn(`[verify-provider] PACT_DELIBERATE_BREAK=${DELIBERATE_BREAK} — provider will intentionally violate ONE consumer's contract for @H11 demo.`);
}

// Mutable state container the state-setup hooks write into, and the route
// handlers read from. Reset between interactions. One field per
// distinct "given" the consumer contracts introduce; resetState() puts
// everything back to a vanilla-happy-path default.
const state: {
  driverAffiliated:    boolean;
  driverHasOffers:     boolean;
  shipperHasLoads:     boolean;
  shipperHasProfile:   boolean;
  loadOwnedByOther:    boolean;
  carrierHasFleet:     boolean;
  carrierMemberLacksPermission: boolean;
  ooHasFleet:          boolean;
  ooHasInvites:        boolean;
  receiverHasInbound:  boolean;
  receiverLoadUnsigned: boolean;
  receiverLoadForOther: boolean;
  adminHasOrgs:        boolean;
  adminOrgToSuspend:   boolean;
} = {
  driverAffiliated:    true,
  driverHasOffers:     true,
  shipperHasLoads:     true,
  shipperHasProfile:   true,
  loadOwnedByOther:    false,
  carrierHasFleet:     true,
  carrierMemberLacksPermission: false,
  ooHasFleet:          true,
  ooHasInvites:        true,
  receiverHasInbound:  true,
  receiverLoadUnsigned: false,
  receiverLoadForOther: false,
  adminHasOrgs:        true,
  adminOrgToSuspend:   true,
};

function resetState() {
  state.driverAffiliated  = true;
  state.driverHasOffers   = true;
  state.shipperHasLoads   = true;
  state.shipperHasProfile = true;
  state.loadOwnedByOther  = false;
  state.carrierHasFleet   = true;
  state.carrierMemberLacksPermission = false;
  state.ooHasFleet        = true;
  state.ooHasInvites      = true;
  state.receiverHasInbound = true;
  state.receiverLoadUnsigned = false;
  state.receiverLoadForOther = false;
  state.adminHasOrgs      = true;
  state.adminOrgToSuspend = true;
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

  // ── Carrier endpoints (carrier-web pact) ────────────────────────────────
  app.get('/api/org/:orgId/dashboard', (req: Request, res: Response) => {
    if (state.carrierMemberLacksPermission) {
      return res.status(403).json({ error: 'Insufficient permission' });
    }
    res.json({
      orgId: req.params.orgId,
      activeLoads: { inTransit: 5, unassigned: 0 },
      drivers: state.carrierHasFleet ? [{
        driverId:  'driver_abc123',
        firstName: 'Sam',
        lastName:  'Driver',
        idvStatus: 'VERIFIED',
        status:    'AVAILABLE',
      }] : [],
      revenue: { grossRevenue: 42000, rpm: 2.45 },
    });
  });

  app.post('/api/org/:orgId/invitations', (req: Request, res: Response) => {
    res.status(201).json({
      invitation: {
        token:    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        email:    req.body?.email ?? 'invited@example.com',
        orgRole:  req.body?.orgRole ?? 'DISPATCHER',
        expiresAt: 1800000000000,
      },
    });
  });

  // ── Owner Operator endpoints (oo-web pact) ──────────────────────────────
  app.get('/api/owner-operator/dashboard', (_req: Request, res: Response) => {
    // @H11 deliberate break — drops selfDriver.isSelf when the flag
    // targets oo-web. carrier-web's pact doesn't touch this endpoint;
    // shipper/driver/receiver/admin don't either. Only oo-web breaks.
    const selfDriver = DELIBERATE_BREAK === 'oo-web'
      ? { driverId: 'driver_oo_self', status: 'AVAILABLE' /* isSelf intentionally dropped */ }
      : { driverId: 'driver_oo_self', isSelf: true, status: 'AVAILABLE' };

    res.json({
      operatorId: 'op_test_1',
      selfDriver,
      fleetDrivers: state.ooHasFleet ? [{
        driverId: 'driver_fleet_1',
        isSelf:   false,
        status:   'AVAILABLE',
      }] : [],
      activeLoads: 3,
      grossRevenue: 18500,
    });
  });

  app.get('/api/owner-operator/verification', (_req: Request, res: Response) => {
    res.json({
      verification: {
        entityType: 'OWNER_OPERATOR',
        verificationStatus: 'PENDING',
        fmcsaStatus: 'active',
        kybStatus:   'PASSED',
      },
    });
  });

  app.get('/api/owner-operator/fleet/invites', (_req: Request, res: Response) => {
    res.json({
      invites: state.ooHasInvites ? [{
        inviteId:  'invite_abc',
        email:     'newdriver@example.com',
        token:     'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        expiresAt: 1800000000000,
      }] : [],
    });
  });

  // ── Receiver endpoints (receiver-web pact) ──────────────────────────────
  app.get('/api/receiver/incoming', (_req: Request, res: Response) => {
    res.json({
      loads: state.receiverHasInbound ? [{
        loadId:           'load_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        status:           'IN_TRANSIT',
        pickupCity:       'Houston',
        pickupState:      'TX',
        deliveryCity:     'Dallas',
        deliveryState:    'TX',
        assignedDriverId: 'driver_abc',
      }] : [],
    });
  });

  app.post('/api/receiver/loads/:loadId/confirm', (_req: Request, res: Response) => {
    if (state.receiverLoadUnsigned) {
      return res.status(412).json({
        message:    'RECEIVER_CONFIRM signature is required',
        statusCode: 412,
      });
    }
    res.json({ ok: true });
  });

  app.get('/api/receiver/loads/:id', (_req: Request, res: Response) => {
    if (state.receiverLoadForOther) {
      return res.status(404).json({ error: 'Load not found' });
    }
    res.json({ loadId: _req.params.id });
  });

  // ── Admin console endpoints (admin-console pact) ────────────────────────
  app.get('/api/admin/orgs', (_req: Request, res: Response) => {
    res.json({
      orgs: state.adminHasOrgs ? [{
        orgId: 'org_carrier_1',
        name:  'Acme Trucking',
        capabilities: ['CARRIER'],
        memberCount: 7,
        isSuspended: false,
      }] : [],
      cursor: null,
    });
  });

  app.post('/api/admin/orgs/:orgId/suspend', (req: Request, res: Response) => {
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < 6) {
      return res.status(400).json({ error: 'reason is required (at least 6 characters)' });
    }
    res.json({ ok: true, orgId: req.params.orgId, suspended: true });
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

      // carrier-web
      case 'a carrier org has 3 active drivers and 5 loads in flight':
        state.carrierHasFleet = true; break;
      case 'a carrier org owner is logged in':
        break;
      case 'an ORG_DRIVER is a member of the org but lacks dashboard:read permission':
        state.carrierMemberLacksPermission = true; break;

      // oo-web
      case 'an owner operator has 1 self-driver and 2 fleet drivers':
        state.ooHasFleet = true; break;
      case 'an owner operator has submitted FMCSA + KYB but not yet IDV':
        break;
      case 'an owner operator has 2 pending fleet driver invitations':
        state.ooHasInvites = true; break;

      // receiver-web
      case 'a receiver has 2 in-transit shipments assigned to their facility':
        state.receiverHasInbound = true; break;
      case 'a load IN_TRANSIT to this receiver has no RECEIVER_CONFIRM signature yet':
        state.receiverLoadUnsigned = true; break;
      case 'a load exists destined for a different receiver facility':
        state.receiverLoadForOther = true; break;

      // admin-console
      case 'the admin org list has at least one active and one suspended org':
        state.adminHasOrgs = true; break;
      case 'a STAFF_ADMIN is logged in and an active org exists at org_to_suspend':
        state.adminOrgToSuspend = true; break;

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
