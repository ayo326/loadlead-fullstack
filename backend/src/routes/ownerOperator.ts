/**
 * Owner Operator routes - /api/owner-operator
 *
 * Owner Operators are independent truck owners who:
 *  - Can drive themselves (have a driver-like profile)
 *  - Can manage a small fleet of assigned drivers
 *  - Can see shipper fan-out loads on their loadboard
 *  - Are NOT part of the org/IAM system
 */
import express from 'express';
import { OwnerOperatorService } from '../services/ownerOperatorService';
import { DriverService } from '../services/driverService';
import { OfferService } from '../services/offerService';
import { LoadService } from '../services/loadService';
import { Database } from '../config/database';
import config from '../config/environment';
import { authenticate, requireOwnerOperator, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { Helpers } from '../utils/helpers';
import { PushService } from '../services/pushService';
import { OfferStatus, LoadStatus, Driver, Load, Offer } from '../types';
import { requireVerifiedCarrier, submitCarrierDocs, submitDriverIdv, getVerification, EntityType } from '../services/verification';
import { resolveInvoicePayee } from '../services/factoring';
import * as Calc from '../services/dashboardCalc';
import { flagW9RefreshRequired } from '../services/compliance/w9Service';
import { NotificationService } from '../services/notificationService';

const router = express.Router();
router.use(authenticate);
router.use(requireOwnerOperator);

// ── Profile ──────────────────────────────────────────────────────────────────

router.get('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) return res.status(404).json({ message: 'Profile not found' });
  // Lazy backfill - covers Owner Operators created before self-drivers existed.
  await OwnerOperatorService.ensureSelfDriver(profile);
  res.json({ ownerOperator: profile });
}));

router.post('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (existing) throw new AppError('Profile already exists - use PUT to update', 409);
  const profile = await OwnerOperatorService.createProfile({
    userId: req.user!.userId,
    ...req.body,
  });
  res.status(201).json({ ownerOperator: profile });
}));

router.put('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found - create it first', 404);
  await OwnerOperatorService.updateProfile(profile.operatorId, req.body);

  // Re-collection trigger: a legal-name or business-name change requires a new
  // W-9 (IRS instructions). Flag the current W-9 for refresh and notify. The old
  // version stays append-only. Best-effort: never fails the profile save.
  const nameChanged =
    (req.body.legalName !== undefined && req.body.legalName !== profile.legalName) ||
    (req.body.businessName !== undefined && req.body.businessName !== (profile as any).businessName);
  if (nameChanged) {
    try {
      const flagged = await flagW9RefreshRequired('HAULER', profile.operatorId, 'Legal or business name changed');
      if (flagged) {
        await NotificationService.record({
          userId: profile.userId,
          kind: 'VERIFICATION_UPDATE',
          title: 'W-9 refresh needed',
          body: 'Your name changed, so a new W-9 is required. Please complete an updated W-9.',
        }).catch(() => undefined);
      }
    } catch { /* never block the profile save on the trigger */ }
  }

  res.json({ ownerOperator: { ...profile, ...req.body } });
}));

// ── Loadboard (fan-out loads from shippers, same as driver loadboard) ─────────

router.get('/loadboard', asyncHandler(async (req: AuthRequest, res) => {
  // Owner operator sees loads that have been broadcast to any of their fleet
  // drivers, PLUS loads directly matched to their own self-driver - without
  // the self-driver, a solo OO with no fleet would see an empty loadboard.
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) return res.json({ loads: [] });

  const selfDriver = await DriverService.getProfileByUserId(profile.userId);
  const driverIds = [
    ...(selfDriver ? [selfDriver.driverId] : []),
    ...(profile.fleetDriverIds ?? []),
  ];

  // Gather offers for self-driver + all fleet drivers
  const allOfferSets = await Promise.all(
    driverIds.map(dId => OfferService.getActiveOffersByDriver(dId))
  );
  const allOffers = allOfferSets.flat();

  // Dedupe by loadId
  const seen = new Set<string>();
  const uniqueOffers = allOffers.filter(o => {
    if (seen.has(o.loadId)) return false;
    seen.add(o.loadId);
    return true;
  });

  const loads = await Promise.all(
    uniqueOffers.map(async offer => ({
      load: await LoadService.getLoadById(offer.loadId),
      offer,
    }))
  );

  res.json({ loads: loads.filter(l => l.load) });
}));

// ── Offer management ─────────────────────────────────────────────────────────
// Mirrors driver offer routes. The OO acts on behalf of a fleet driver - the
// offer record is keyed by driverId (whoever the broadcast was sent to).
// Body param `driverId` selects which fleet driver's offer to act on; if omitted
// the first active offer found for that load across the fleet is used.

// Resolve which driver (the OO's own self-driver, or a fleet member) holds
// the offer for a given load, or validate an explicitly-supplied driverId
// belongs to this operator (self-driver or fleet). Self-driver is checked
// first so a solo OO with no fleet drivers still resolves correctly.
async function resolveFleetDriverForLoad(
  profile: { userId: string; operatorId: string; fleetDriverIds?: string[] },
  loadId: string,
  requestedDriverId?: string,
): Promise<string> {
  const selfDriver = await DriverService.getProfileByUserId(profile.userId);
  const candidates = [
    ...(selfDriver ? [selfDriver.driverId] : []),
    ...(profile.fleetDriverIds ?? []),
  ];
  if (!candidates.length) throw new AppError('No drivers available - no self-driver or fleet', 400);

  if (requestedDriverId) {
    if (!candidates.includes(requestedDriverId)) {
      throw new AppError('Driver is not yours (self-driver or fleet)', 403);
    }
    return requestedDriverId;
  }

  // No driverId supplied - find the first candidate with an active offer for this load.
  for (const dId of candidates) {
    const offer = await OfferService.getOffer(loadId, dId);
    if (offer && offer.status === OfferStatus.OFFERED) return dId;
  }
  throw new AppError('No active offer found for this load', 404);
}

// GET /api/owner-operator/offers/:loadId - offer + load detail for a fleet driver
router.get('/offers/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const { driverId } = req.query as { driverId?: string };

  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found', 404);

  const resolvedDriverId = await resolveFleetDriverForLoad(profile, loadId, driverId);
  const [offer, load] = await Promise.all([
    OfferService.getOffer(loadId, resolvedDriverId),
    LoadService.getLoadById(loadId),
  ]);

  res.json({ offer, load, driverId: resolvedDriverId });
}));

// POST /api/owner-operator/offers/:loadId/accept
router.post('/offers/:loadId/accept', requireVerifiedCarrier(), asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const { driverId: requestedDriverId } = req.body as { driverId?: string };

  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found', 404);

  const driverId = await resolveFleetDriverForLoad(profile, loadId, requestedDriverId);
  await OfferService.acceptOffer(loadId, driverId);

  // Notify shipper - best effort
  try {
    const [load, driver] = await Promise.all([
      LoadService.getLoadById(loadId),
      DriverService.getProfileById(driverId),
    ]);
    if (load?.shipperId) {
      const origin = `${load.pickupCity}, ${load.pickupState}`;
      const destination = `${load.deliveryCity}, ${load.deliveryState}`;
      const driverName = driver?.fullName || 'A driver';
      await PushService.send(
        load.shipperId,
        '✅ Load Accepted',
        `${driverName} accepted your load: ${origin} → ${destination}`,
        `https://loadleadapp.com/shipper/loads/${loadId}`,
      );
    }
  } catch (_) {}

  res.json({ message: 'Offer accepted successfully', driverId });
}));

// POST /api/owner-operator/offers/:loadId/decline
router.post('/offers/:loadId/decline', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const { driverId: requestedDriverId } = req.body as { driverId?: string };

  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found', 404);

  const driverId = await resolveFleetDriverForLoad(profile, loadId, requestedDriverId);
  await OfferService.declineOffer(loadId, driverId);

  res.json({ message: 'Offer declined successfully', driverId });
}));

// ── Fleet management ──────────────────────────────────────────────────────────

/** List all drivers in this operator's fleet */
router.get('/fleet', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) return res.json({ drivers: [] });

  const fleetDriverIds = profile.fleetDriverIds ?? [];
  const drivers = await Promise.all(
    fleetDriverIds.map(id => DriverService.getProfileById(id))
  );
  res.json({ drivers: drivers.filter(Boolean) });
}));

/** Remove a driver from fleet */
router.delete('/fleet/:driverId', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found', 404);

  const { driverId } = req.params;

  // The self-driver is permanently bound to its own OO and cannot be removed
  // or re-parented (spec §5, §6) - it isn't in fleetDriverIds anyway, but
  // guard explicitly in case the same userId's self-driver id is passed here.
  const target = await DriverService.getProfileById(driverId);
  if (target?.isSelf) {
    throw new AppError('Cannot remove an Owner Operator\'s self-driver', 409);
  }

  await OwnerOperatorService.removeFleetDriver(profile.operatorId, driverId);

  // Clear the driver's ownedByOperatorId link
  await Database.updateItem(
    config.dynamodb.driversTable,
    { driverId },
    { ownedByOperatorId: null }
  );

  res.json({ ok: true });
}));

/** Create a fleet invite link for a driver to join */
router.post('/fleet/invite', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found', 404);

  const { email } = req.body;
  if (!email) throw new AppError('email is required', 400);

  const invite = await OwnerOperatorService.createFleetInvite(profile.operatorId, email);
  res.status(201).json({ invite });
}));

// GET /api/owner-operator/history - accepted loads across self-driver + fleet
router.get('/history', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) return res.json({ loads: [] });

  const selfDriver = await DriverService.getProfileByUserId(profile.userId);
  const driverIds: string[] = [
    ...(selfDriver ? [selfDriver.driverId] : []),
    ...(profile.fleetDriverIds ?? []),
  ];

  // Gather all offers from self-driver + fleet drivers, then filter to ACCEPTED
  const offerSets = await Promise.all(
    driverIds.map((dId) => OfferService.getOffersByDriver(dId))
  );
  const acceptedOffers = offerSets.flat().filter((o: any) => o.status === 'ACCEPTED');

  // Dedupe by loadId (multiple fleet drivers may have offers on the same load)
  const seen = new Set<string>();
  const unique = acceptedOffers.filter((o: any) => {
    if (seen.has(o.loadId)) return false;
    seen.add(o.loadId);
    return true;
  });

  const loadsWithOffers = await Promise.all(
    unique.map(async (offer: any) => ({
      load: await LoadService.getLoadById(offer.loadId),
      offer,
    }))
  );

  const result = loadsWithOffers
    .filter((item) => item.load)
    .sort((a, b) => (b.offer.acceptedAt ?? 0) - (a.offer.acceptedAt ?? 0));

  res.json({ loads: result });
}));

// ── Verification ─────────────────────────────────────────────────────────────

// GET /api/owner-operator/verification - current carrier AUTHORITY status
// (FMCSA + KYB, keyed by operatorId - gate 1 for any of this OO's drivers).
router.get('/verification', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found', 404);

  const verification = await getVerification(profile.operatorId);
  res.json({ verification: verification ?? { verificationStatus: 'UNVERIFIED' } });
}));

// POST /api/owner-operator/verification/submit - submit MC/DOT docs for carrier AUTHORITY
// (FMCSA + KYB only). Personal identity is separate - see /verification/idv.
router.post('/verification/submit', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found', 404);

  const { mcNumber, dotNumber } = req.body;
  if (!mcNumber && !dotNumber) throw new AppError('mcNumber or dotNumber is required', 400);

  const verification = await submitCarrierDocs(
    profile.operatorId,
    EntityType.OWNER_OPERATOR,
    mcNumber ?? '',
    dotNumber ?? '',
  );
  res.status(201).json({ verification });
}));

// GET /api/owner-operator/verification/idv - this OO's own personal IDV status.
// Keyed by userId - the same identity record their self-driver's acceptance
// gate reads, and the same one a fleet driver maintains for themselves.
router.get('/verification/idv', asyncHandler(async (req: AuthRequest, res) => {
  const verification = await getVerification(req.user!.userId);
  res.json({ verification: verification ?? { verificationStatus: 'UNVERIFIED' } });
}));

// POST /api/owner-operator/verification/idv - start this OO's own personal IDV.
// An OO who also drives verifies identity once; it covers their self-driver.
router.post('/verification/idv', asyncHandler(async (req: AuthRequest, res) => {
  const verification = await submitDriverIdv(req.user!.userId);
  res.status(201).json({ verification });
}));

/** List pending fleet invites */
router.get('/fleet/invites', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) return res.json({ invites: [] });

  const all = await OwnerOperatorService.getFleetInvitesForOperator(profile.operatorId);
  const now = Helpers.getCurrentTimestamp();
  const pending = all.filter(i => !i.acceptedAt && i.expiresAt > now);
  res.json({ invites: pending });
}));

// ─── Owner Operator settings aggregation (canonical sections) ───────────────
// Read-only aggregation of the spec §3 canonical sections, bound to this
// OO's canonical records. Writes are NOT here - they go through existing
// canonical endpoints (PUT /profile, POST /verification/submit, etc.).
//
// Independent of the carrier-org settings endpoint per the Independence
// Principle. Members & roles is ABSENT (not stubbed) per spec §3 - OO is its
// own owner; the fleet section already covers the only people it manages.
router.get('/settings', requireOwnerOperator, asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Owner Operator profile not found', 404);

  const fleetDriverIds = profile.fleetDriverIds ?? [];
  const selfDriver = await DriverService.getProfileByUserId(req.user!.userId);
  const fleetDrivers = (await Promise.all(
    fleetDriverIds.map(id => DriverService.getProfileById(id)),
  )).filter((d): d is Driver => !!d);

  const allDrivers: Driver[] = [];
  const seen = new Set<string>();
  if (selfDriver) { allDrivers.push(selfDriver); seen.add(selfDriver.driverId); }
  for (const d of fleetDrivers) if (!seen.has(d.driverId)) { allDrivers.push(d); seen.add(d.driverId); }

  const [authority, identity] = await Promise.all([
    getVerification(profile.operatorId),
    getVerification(req.user!.userId),
  ]);

  const driverUsers = await Promise.all(
    allDrivers.map(d =>
      Database.getItem<{ userId: string; email: string; idvStatus?: string }>(
        config.dynamodb.usersTable, { userId: d.userId },
      ),
    ),
  );

  res.json({
    parentType: 'OWNER_OPERATOR',
    sections: {
      profile: {
        editable: true,
        endpoint: `PUT /api/owner-operator/profile`,
        data: {
          legalName: profile.legalName,
          dba: profile.dba,
          mcNumber: profile.mcNumber,
          dotNumber: profile.dotNumber,
          city: profile.city,
          state: profile.state,
        },
      },
      verification: {
        editable: false,            // read-only mirror with re-verify action
        action: { endpoint: `POST /api/owner-operator/verification/submit` },
        data: {
          status: authority?.verificationStatus ?? 'UNVERIFIED',
          fmcsaAuthorityActive: authority?.fmcsaAuthorityActive ?? null,
          kybStatus: authority?.kybStatus ?? null,
          reverifyAfter: authority?.reverifyAfter ?? null,
        },
      },
      identity: {
        editable: false,            // self-driver + fleet drivers' user.idvStatus
        action: { endpoint: `POST /api/owner-operator/verification/idv` },
        data: {
          self: identity?.verificationStatus ?? 'UNVERIFIED',
          fleet: driverUsers.filter(Boolean).map(u => ({
            userId: u!.userId,
            email: u!.email,
            idvStatus: u!.idvStatus ?? 'UNVERIFIED',
          })),
        },
      },
      driversFleet: {
        editable: true,
        endpoints: {
          roster: `GET /api/owner-operator/fleet`,
          invite: `POST /api/owner-operator/fleet/invite`,
          remove: `DELETE /api/owner-operator/fleet/:driverId`,
        },
        // self-driver is shown via roster but flagged non-removable on the wire
        data: {
          count: allDrivers.length,
          selfDriverId: selfDriver?.driverId ?? null,
        },
      },
      factoring: {
        editable: true,
        endpoint: `GET/PUT /api/factoring/profile?carrierId=${profile.operatorId}`,
        data: { carrierId: profile.operatorId },
      },
      notifications: {
        editable: true,
        endpoint: `GET/PUT /api/notifications/preferences`,
        data: { pushEnabled: null, emailEnabled: null },
      },
      // membersAndRoles: ABSENT per spec - OO is its own owner.
      capabilities: {
        editable: false,            // CARRIER is inherent for an OO; read-only mirror
        data: { current: ['CARRIER'] },
      },
    },
  });
}));

// ─── Owner Operator dashboard aggregation ───────────────────────────────────
// Independent implementation per the spec's Independence Principle - does NOT
// share container code with the carrier dashboard. Composes the persona-neutral
// calc service (dashboardCalc) for the math, and an OO-specific "My haul" panel
// for the blended driver-and-dispatcher view.
//
// 🔴 fields return { available:false } - no fabrication.
router.get('/dashboard', requireOwnerOperator, asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Owner Operator profile not found', 404);

  const fleetDriverIds = profile.fleetDriverIds ?? [];
  // Self-driver lives on the OO themselves: its userId === OO userId.
  // OO fleet may overlap (or not) with the self-driver, so handle both paths.
  const selfDriver = await DriverService.getProfileByUserId(req.user!.userId);
  const fleetDrivers = (await Promise.all(
    fleetDriverIds.map(id => DriverService.getProfileById(id)),
  )).filter((d): d is Driver => !!d);

  // Combined driver set: self-driver (if exists, isSelf flag carried) + fleet.
  // Deduplicate in case the self-driver is also in the fleet array.
  const allDrivers: Driver[] = [];
  const seen = new Set<string>();
  if (selfDriver) { allDrivers.push(selfDriver); seen.add(selfDriver.driverId); }
  for (const d of fleetDrivers) if (!seen.has(d.driverId)) { allDrivers.push(d); seen.add(d.driverId); }

  // Fan out per-driver lookups in parallel.
  const [driverLoads, driverOffers, authority, identity] = await Promise.all([
    Promise.all(allDrivers.map(d => LoadService.getLoadsByAssignedDriver(d.driverId))),
    Promise.all(allDrivers.map(d => OfferService.getOffersByDriver(d.driverId))),
    getVerification(profile.operatorId),
    getVerification(req.user!.userId),
  ]);

  const loads: Load[] = driverLoads.flat();
  const offers: Offer[] = driverOffers.flat();

  // Per-driver user records (idvStatus mirror)
  const driverUsers = await Promise.all(
    allDrivers.map(d =>
      Database.getItem<{ userId: string; idvStatus?: string }>(
        config.dynamodb.usersTable, { userId: d.userId },
      ),
    ),
  );

  // ── My haul (the blended OO-specific panel) ─────────────────────────────
  const myHaul = (() => {
    if (!selfDriver) return null;
    const active = loads.find(l =>
      l.assignedDriverId === selfDriver.driverId &&
      (l.status === LoadStatus.BOOKED || l.status === LoadStatus.IN_TRANSIT),
    );
    if (!active) return null;
    return {
      loadId: active.loadId,
      status: active.status,
      pickup: { city: active.pickupCity, state: active.pickupState, at: active.pickupDate },
      delivery: { city: active.deliveryCity, state: active.deliveryState, at: active.deliveryDate },
      rate: active.rateAmount,
      miles: active.totalMiles,
      // selfEta: live tracking ETA - Calc.etaAtRisk would surface it, but for
      // "my haul" we just expose the deliveryDate target. Real ETA needs a
      // tracking provider wired (🟡).
      selfEta: null,
    };
  })();

  // ── Fleet & onboarding (parity with carrier 1.2) ─────────────────────────
  const driversPanel = allDrivers.map(d => {
    const u = driverUsers.find(uu => uu?.userId === d.userId);
    return {
      driverId: d.driverId,
      name: d.legalName,
      availability: Calc.driverAvailability(d.driverId, offers, loads),
      idvStatus: u?.idvStatus ?? 'UNVERIFIED',
      isSelf: d.isSelf === true,
    };
  });
  const onboarding = Calc.onboardingRollup(driverUsers.filter(Boolean) as Array<{ idvStatus?: string }>);
  const compliancePosture = Calc.complianceRollup(authority ?? null);

  // ── Alerts (parity with carrier 1.1) ─────────────────────────────────────
  const activeLoads = Calc.activeLoadCounts(loads);
  const unassigned = Calc.unassignedLoads(loads).map(l => ({
    loadId: l.loadId,
    pickup: { city: l.pickupCity, state: l.pickupState, at: l.pickupDate },
    delivery: { city: l.deliveryCity, state: l.deliveryState, at: l.deliveryDate },
    rate: l.rateAmount,
  }));
  const etaAtRisk = Calc.etaAtRisk(loads);

  // ── Financial (parity with carrier 1.3) ──────────────────────────────────
  const grossRevenue = Calc.grossRevenue(loads);
  const rpm = Calc.rpmBreakdown(loads);

  const deliveredLoads = loads.filter(l => l.status === LoadStatus.DELIVERED);
  const payees = [];
  for (const l of deliveredLoads) {
    const total = l.rateType === 'PER_MILE'
      ? (l.totalMiles ? l.rateAmount * l.totalMiles : 0)
      : l.rateAmount;
    if (total <= 0) continue;
    try {
      const p = await resolveInvoicePayee(l.loadId);
      payees.push({ payee: p.payee, amount: total });
    } catch { /* per-load resolution failure shouldn't fail the dashboard */ }
  }
  const payeeBreakdown = Calc.payeeBreakdown(payees);

  // ── Loadboard ────────────────────────────────────────────────────────────
  const tendered = offers
    .filter(o => o.status === OfferStatus.OFFERED)
    .map(o => {
      const l = loads.find(ll => ll.loadId === o.loadId);
      if (!l) return null;
      // OO can accept as self (when offered to self-driver) or as fleet
      const acceptAs: 'self' | 'fleet' =
        selfDriver && o.driverId === selfDriver.driverId ? 'self' : 'fleet';
      return {
        loadId: l.loadId,
        driverId: o.driverId,
        acceptAs,
        origin: { city: l.pickupCity, state: l.pickupState },
        dest: { city: l.deliveryCity, state: l.deliveryState },
        weight: l.totalWeightLbs,
        commodity: l.commodityDescription,
        equipment: l.equipmentType,
        payout: l.rateType === 'PER_MILE' ? (l.totalMiles ?? 0) * l.rateAmount : l.rateAmount,
        expiresAt: o.expiresAt,
      };
    })
    .filter(Boolean);

  // ── SLA (parity with carrier 1.5) ────────────────────────────────────────
  const acceptance = Calc.acceptanceMetrics(offers);
  const otp = Calc.otpMetrics(loads);

  res.json({
    operatorId: profile.operatorId,
    operatorName: profile.legalName,
    // OO-specific blended panel
    myHaul,
    // Verification: authority (OO-level) + identity (per-person on User)
    verification: {
      authority: compliancePosture,
      identity: {
        status: identity?.verificationStatus ?? 'UNVERIFIED',
        daysToExpiry: identity?.reverifyAfter
          ? Math.round((new Date(identity.reverifyAfter).getTime() - Date.now()) / 86_400_000)
          : null,
      },
    },
    // Alerts (same categories as carrier 1.1, operator-scoped)
    alerts: {
      activeLoads,
      unassigned,
      etaAtRisk,
      hosWarnings: Calc.NOT_CONNECTED,
      reeferDeviations: Calc.NOT_CONNECTED,
    },
    // Fleet (same categories as carrier 1.2, operator-scoped, self-driver non-removable)
    fleet: {
      drivers: driversPanel,
      onboarding,
      authorityExpiry: compliancePosture.daysToExpiry,
      insurance: Calc.PENDING_CAPTURE,
      hosRemaining: Calc.NOT_CONNECTED,
      equipmentHealth: Calc.NOT_CONNECTED,
    },
    // Financial (same categories as carrier 1.3, operator-scoped)
    financial: {
      grossRevenue,
      rpm,
      payeeBreakdown,
      factoringPipeline: Calc.factoringPipeline([]),
      fuelSpend: Calc.NOT_CONNECTED,
      tolls: Calc.NOT_CONNECTED,
    },
    // Loadboard (parity, plus the OO-only acceptAs hint per row)
    loadboard: {
      tendered,
      capabilityWarnings: [],
      dwell: Calc.dwell(loads),
      deadhead: Calc.PENDING_CAPTURE,
    },
    // SLA (same categories as carrier 1.5)
    sla: {
      otp,
      acceptance,
      compliancePosture,
      csaScores: Calc.NOT_CONNECTED,
    },
  });
}));

export default router;
