/**
 * Owner Operator routes — /api/owner-operator
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
import { OfferStatus } from '../types';
import { requireVerifiedCarrier, submitCarrierDocs, submitDriverIdv, getVerification, EntityType } from '../services/verification';

const router = express.Router();
router.use(authenticate);
router.use(requireOwnerOperator);

// ── Profile ──────────────────────────────────────────────────────────────────

router.get('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) return res.status(404).json({ message: 'Profile not found' });
  // Lazy backfill — covers Owner Operators created before self-drivers existed.
  await OwnerOperatorService.ensureSelfDriver(profile);
  res.json({ ownerOperator: profile });
}));

router.post('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (existing) throw new AppError('Profile already exists — use PUT to update', 409);
  const profile = await OwnerOperatorService.createProfile({
    userId: req.user!.userId,
    ...req.body,
  });
  res.status(201).json({ ownerOperator: profile });
}));

router.put('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found — create it first', 404);
  await OwnerOperatorService.updateProfile(profile.operatorId, req.body);
  res.json({ ownerOperator: { ...profile, ...req.body } });
}));

// ── Loadboard (fan-out loads from shippers, same as driver loadboard) ─────────

router.get('/loadboard', asyncHandler(async (req: AuthRequest, res) => {
  // Owner operator sees loads that have been broadcast to any of their fleet
  // drivers, PLUS loads directly matched to their own self-driver — without
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
// Mirrors driver offer routes. The OO acts on behalf of a fleet driver — the
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
  if (!candidates.length) throw new AppError('No drivers available — no self-driver or fleet', 400);

  if (requestedDriverId) {
    if (!candidates.includes(requestedDriverId)) {
      throw new AppError('Driver is not yours (self-driver or fleet)', 403);
    }
    return requestedDriverId;
  }

  // No driverId supplied — find the first candidate with an active offer for this load.
  for (const dId of candidates) {
    const offer = await OfferService.getOffer(loadId, dId);
    if (offer && offer.status === OfferStatus.OFFERED) return dId;
  }
  throw new AppError('No active offer found for this load', 404);
}

// GET /api/owner-operator/offers/:loadId — offer + load detail for a fleet driver
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

  // Notify shipper — best effort
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
  // or re-parented (spec §5, §6) — it isn't in fleetDriverIds anyway, but
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

// GET /api/owner-operator/history — accepted loads across self-driver + fleet
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

// GET /api/owner-operator/verification — current carrier AUTHORITY status
// (FMCSA + KYB, keyed by operatorId — gate 1 for any of this OO's drivers).
router.get('/verification', asyncHandler(async (req: AuthRequest, res) => {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Profile not found', 404);

  const verification = await getVerification(profile.operatorId);
  res.json({ verification: verification ?? { verificationStatus: 'UNVERIFIED' } });
}));

// POST /api/owner-operator/verification/submit — submit MC/DOT docs for carrier AUTHORITY
// (FMCSA + KYB only). Personal identity is separate — see /verification/idv.
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

// GET /api/owner-operator/verification/idv — this OO's own personal IDV status.
// Keyed by userId — the same identity record their self-driver's acceptance
// gate reads, and the same one a fleet driver maintains for themselves.
router.get('/verification/idv', asyncHandler(async (req: AuthRequest, res) => {
  const verification = await getVerification(req.user!.userId);
  res.json({ verification: verification ?? { verificationStatus: 'UNVERIFIED' } });
}));

// POST /api/owner-operator/verification/idv — start this OO's own personal IDV.
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

export default router;
