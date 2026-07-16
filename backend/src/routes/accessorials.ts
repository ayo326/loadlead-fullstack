/**
 * Accessorial + stop-event routes - /api/accessorials
 *
 * Stop check-in/check-out (mover side), charge compute, the carrier's e-sign
 * acceptance of the accessorial policy, and the shipper's approve/adjust/dispute
 * lifecycle. All routes require authentication; each action is role-gated with the
 * existing guards. Carrier means a fleet carrier or an owner-operator.
 *
 * These call the services in Phase 3-5; no business logic lives here.
 */

import express from 'express';
import { body, param, query } from 'express-validator';
import { ACCESSORIAL_BOUNDS } from '../config/accessorialPolicy';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { UserRole } from '../types';
import { LoadService } from '../services/loadService';
import { DriverService } from '../services/driverService';
import { ShipperService } from '../services/shipperService';
import { resolveCarrierOfRecord } from '../services/carrierOfRecord';
import { StopEventService } from '../services/stopEventService';
import { AccessorialPolicyService } from '../services/accessorialPolicyService';
import { AccessorialChargeService } from '../services/accessorialChargeService';

const router = express.Router();
router.use(authenticate);

const moverRoles = [UserRole.DRIVER, UserRole.OWNER_OPERATOR, UserRole.ADMIN];
const carrierRoles = [UserRole.DRIVER, UserRole.OWNER_OPERATOR, UserRole.CARRIER_ADMIN, UserRole.ADMIN];
const shipperRoles = [UserRole.SHIPPER, UserRole.ADMIN];

async function requireLoad(loadId: string) {
  const load = await LoadService.getLoadById(loadId);
  if (!load) throw new AppError(`Load ${loadId} not found`, 404);
  return load;
}

/** Best-effort resolution of the mover (carrier of record) id for a load, by id. */
async function resolveMoverId(load: any): Promise<string> {
  if (!load.assignedDriverId) return 'unassigned';
  const driver = await DriverService.getProfileById(load.assignedDriverId);
  const cor = driver ? await resolveCarrierOfRecord(driver) : null;
  return cor?.entityId ?? load.assignedDriverId;
}

/** The caller's mover identity: their own driver id and carrier-of-record id (if any). */
async function callerMoverIds(req: AuthRequest): Promise<{ driverId: string | null; carrierEntityId: string | null }> {
  const driver = await DriverService.getProfileByUserId(req.user!.userId).catch(() => null);
  if (!driver) return { driverId: null, carrierEntityId: null };
  const cor = await resolveCarrierOfRecord(driver).catch(() => null);
  return { driverId: driver.driverId, carrierEntityId: cor?.entityId ?? driver.driverId };
}

/**
 * M2 (audit v6): stop events (check-in/check-out) drive detention/accessorial CENTS
 * and land in the append-only stop-event log. requireRole only proves the caller is
 * *a* mover; without this any driver/OO could fabricate or suppress detention on ANY
 * load. The caller must be the load's ASSIGNED mover (ADMIN bypasses for support).
 */
async function assertCallerIsAssignedMover(req: AuthRequest, load: any): Promise<void> {
  if (req.user!.role === UserRole.ADMIN) return;
  if (!load.assignedDriverId) throw new AppError('Load has no assigned mover', 403);
  const [{ driverId, carrierEntityId }, moverId] = await Promise.all([callerMoverIds(req), resolveMoverId(load)]);
  const ok = (driverId && driverId === load.assignedDriverId) || (carrierEntityId && carrierEntityId === moverId);
  if (!ok) throw new AppError('Not authorized for this load', 403);
}

/**
 * M1 (audit v6): accessorial charge amounts (cents) + carrier identity are party data.
 * The listing was authenticated but ungated, so any persona could enumerate any load's
 * charges. Restrict to the load's shipper OR its assigned mover (ADMIN bypasses).
 */
async function assertCallerIsLoadParty(req: AuthRequest, loadId: string): Promise<void> {
  if (req.user!.role === UserRole.ADMIN) return;
  const load = await LoadService.getLoadById(loadId);
  if (!load) throw new AppError(`Load ${loadId} not found`, 404);
  const shipper = await ShipperService.getProfileByUserId(req.user!.userId).catch(() => null);
  if (shipper && load.shipperId === shipper.shipperId) return;
  const [{ driverId, carrierEntityId }, moverId] = await Promise.all([callerMoverIds(req), resolveMoverId(load)]);
  if ((driverId && driverId === load.assignedDriverId) || (carrierEntityId && carrierEntityId === moverId)) return;
  throw new AppError('Not authorized for this load', 403);
}

// ── Stop events (mover side) ────────────────────────────────────────────────

/** POST /api/accessorials/loads/:loadId/stops/:stopId/check-in */
router.post(
  '/loads/:loadId/stops/:stopId/check-in',
  requireRole(...moverRoles),
  validate([
    param('loadId').isString().isLength({ min: 1, max: 200 }),
    param('stopId').isString().isLength({ min: 1, max: 200 }),
    body('lat').optional().isFloat(),
    body('lng').optional().isFloat(),
    body('geofenceMatch').optional().isBoolean(),
    body('evidencePhotoId').optional().isString().isLength({ max: 200 }),
    body('note').optional().isString().isLength({ max: 2000 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const load = await requireLoad(req.params.loadId);
    await assertCallerIsAssignedMover(req, load);
    const event = await StopEventService.checkIn({
      loadId: req.params.loadId,
      stopId: req.params.stopId,
      actorId: req.user!.userId,
      lat: req.body.lat,
      lng: req.body.lng,
      geofenceMatch: req.body.geofenceMatch,
      evidencePhotoId: req.body.evidencePhotoId,
      note: req.body.note,
    });
    res.status(201).json({ event });
  })
);

/** POST /api/accessorials/loads/:loadId/stops/:stopId/check-out */
router.post(
  '/loads/:loadId/stops/:stopId/check-out',
  requireRole(...moverRoles),
  validate([
    param('loadId').isString().isLength({ min: 1, max: 200 }),
    param('stopId').isString().isLength({ min: 1, max: 200 }),
    body('lat').optional().isFloat(),
    body('lng').optional().isFloat(),
    body('geofenceMatch').optional().isBoolean(),
    body('evidencePhotoId').optional().isString().isLength({ max: 200 }),
    body('note').optional().isString().isLength({ max: 2000 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const load = await requireLoad(req.params.loadId);
    await assertCallerIsAssignedMover(req, load);
    const event = await StopEventService.checkOut({
      loadId: req.params.loadId,
      stopId: req.params.stopId,
      actorId: req.user!.userId,
      lat: req.body.lat,
      lng: req.body.lng,
      geofenceMatch: req.body.geofenceMatch,
      evidencePhotoId: req.body.evidencePhotoId,
      note: req.body.note,
    });
    res.status(201).json({ event });
  })
);

/** POST /api/accessorials/loads/:loadId/stops/:stopId/compute -> compute the charge */
router.post(
  '/loads/:loadId/stops/:stopId/compute',
  requireRole(UserRole.DRIVER, UserRole.OWNER_OPERATOR, UserRole.SHIPPER, UserRole.ADMIN),
  validate([
    param('loadId').isString().isLength({ min: 1, max: 200 }),
    param('stopId').isString().isLength({ min: 1, max: 200 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const load = await requireLoad(req.params.loadId);
    // Audit v6 L1: compute writes/updates the charge (money) for this stop, so
    // restrict it to the load's parties - same guard as GET .../charges. Without
    // it any driver/OO/shipper could recompute charges on any load by id.
    await assertCallerIsLoadParty(req, req.params.loadId);
    const charge = await AccessorialChargeService.computeForStop(
      { loadId: load.loadId, hazmat: load.hazmat, equipmentType: load.equipmentType },
      req.params.stopId,
      req.user!.userId
    );
    res.json({ charge });
  })
);

/**
 * GET /api/accessorials/rate-card?equipmentType=&hazmat=
 * The prefilled disclosure for a freight class + the allowed override bounds.
 * Used by the shipper's Post Load confirmation before the load exists.
 */
router.get(
  '/rate-card',
  validate([
    query('equipmentType').optional().isString().isLength({ max: 40 }),
    query('hazmat').optional().isString(),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const equipmentType = String(req.query.equipmentType || 'DRY_VAN');
    const hazmat = req.query.hazmat === 'true' || req.query.hazmat === '1';
    const disclosure = AccessorialPolicyService.rateCardDisclosure({ equipmentType, hazmat });
    res.json({ disclosure, bounds: ACCESSORIAL_BOUNDS });
  })
);

// ── Accessorial policy (carrier accepts at claim) ───────────────────────────

/** GET /api/accessorials/policy/:loadId */
router.get(
  '/policy/:loadId',
  validate([param('loadId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    const load = await requireLoad(req.params.loadId);
    const policy = await AccessorialPolicyService.getOrCreateForLoad({
      loadId: load.loadId,
      hazmat: load.hazmat,
      equipmentType: load.equipmentType,
    });
    // disclosure = the single freight-class detention rate + free time + layover
    // terms the offer summary and acknowledgment modal display.
    res.json({ policy, disclosure: AccessorialPolicyService.disclosureOf(policy) });
  })
);

/** POST /api/accessorials/policy/:loadId/accept  { signatureType, signatureData, consentGiven } */
router.post(
  '/policy/:loadId/accept',
  requireRole(...carrierRoles),
  validate([
    param('loadId').isString().isLength({ min: 1, max: 200 }),
    body('signatureType').isString().isIn(['typed', 'drawn', 'click']),
    body('signatureData').isString().isLength({ min: 1, max: 5000 }),
    body('consentGiven').isBoolean(),
    body('acknowledged').optional().isBoolean(),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const load = await requireLoad(req.params.loadId);
    // Audit v6 L1 (residual, flagged not fixed here): acceptance happens "at
    // claim" and the acknowledgment modal is shown at OFFER time, i.e. BEFORE the
    // driver is assigned - so a load-party / assigned-mover guard would 403 a
    // legitimate pre-assignment accept. The correct guard is offer/claim
    // eligibility (does the caller have an active offer/broadcast on this load),
    // a Marketplace x Settlements seam decision. Left ungated pending that.
    const acceptance = await AccessorialPolicyService.acceptPolicy({
      load: { loadId: load.loadId, hazmat: load.hazmat, equipmentType: load.equipmentType },
      acceptedByUserId: req.user!.userId,
      signerRole: req.user!.role,
      signatureType: req.body.signatureType,
      signatureData: req.body.signatureData,
      consentGiven: req.body.consentGiven,
      acknowledged: req.body.acknowledged === true,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || undefined,
    });
    res.status(201).json({ acceptance });
  })
);

// ── Charge lifecycle ────────────────────────────────────────────────────────

/** GET /api/accessorials/loads/:loadId/charges */
router.get(
  '/loads/:loadId/charges',
  validate([param('loadId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    await assertCallerIsLoadParty(req, req.params.loadId);
    const charges = await AccessorialChargeService.listForLoad(req.params.loadId);
    res.json({ charges, count: charges.length });
  })
);

/**
 * SEC-H2: approve/adjust/dispute may only be done by the shipper that owns the
 * charge's load (ADMIN bypasses for support). requireRole only proves the caller
 * is *a* shipper - without this, any shipper could approve any load's charge to
 * billable, set an arbitrary amount, or raise a TRUST_INCIDENT against an
 * arbitrary carrier.
 */
async function assertCallerIsLoadShipper(req: AuthRequest, loadId: string): Promise<void> {
  if (req.user!.role === UserRole.ADMIN) return;
  const [load, shipper] = await Promise.all([
    LoadService.getLoadById(loadId),
    ShipperService.getProfileByUserId(req.user!.userId).catch(() => null),
  ]);
  if (!load || !shipper || load.shipperId !== shipper.shipperId) {
    throw new AppError('Not authorized for this charge', 403);
  }
}

/** POST /api/accessorials/charges/:chargeId/approve  (shipper) */
router.post(
  '/charges/:chargeId/approve',
  requireRole(...shipperRoles),
  validate([param('chargeId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    const existing = await AccessorialChargeService.getCharge(req.params.chargeId);
    if (!existing) throw new AppError(`Charge ${req.params.chargeId} not found`, 404);
    await assertCallerIsLoadShipper(req, existing.loadId);
    const charge = await AccessorialChargeService.approve(req.params.chargeId, req.user!.userId);
    res.json({ charge });
  })
);

/** POST /api/accessorials/charges/:chargeId/adjust  { newAmountCents, reason? }  (shipper) */
router.post(
  '/charges/:chargeId/adjust',
  requireRole(...shipperRoles),
  validate([
    param('chargeId').isString().isLength({ min: 1, max: 200 }),
    body('newAmountCents').isInt({ min: 0 }),
    body('reason').optional().isString().isLength({ max: 2000 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const existing = await AccessorialChargeService.getCharge(req.params.chargeId);
    if (!existing) throw new AppError(`Charge ${req.params.chargeId} not found`, 404);
    await assertCallerIsLoadShipper(req, existing.loadId);
    const charge = await AccessorialChargeService.adjust(
      req.params.chargeId,
      parseInt(String(req.body.newAmountCents), 10),
      req.user!.userId,
      req.body.reason
    );
    res.json({ charge });
  })
);

/** POST /api/accessorials/charges/:chargeId/dispute  { reason? }  (shipper) */
router.post(
  '/charges/:chargeId/dispute',
  requireRole(...shipperRoles),
  validate([
    param('chargeId').isString().isLength({ min: 1, max: 200 }),
    body('reason').optional().isString().isLength({ max: 2000 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const existing = await AccessorialChargeService.getCharge(req.params.chargeId);
    if (!existing) throw new AppError(`Charge ${req.params.chargeId} not found`, 404);
    await assertCallerIsLoadShipper(req, existing.loadId);
    const load = await LoadService.getLoadById(existing.loadId);
    const carrierId = load ? await resolveMoverId(load) : 'unassigned';
    const charge = await AccessorialChargeService.dispute(req.params.chargeId, req.user!.userId, carrierId, req.body.reason);
    res.json({ charge });
  })
);

export default router;
