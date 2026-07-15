import express from 'express';
import { ShipperService } from '../services/shipperService';
import { RoutingService } from '../services/routingService';
import { LoadService } from '../services/loadService';
import { DriverService } from '../services/driverService';
import { AccessorialPolicyService } from '../services/accessorialPolicyService';
import { authenticate, requireShipper, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { shipperValidators, loadValidators } from '../utils/validators';
import { validate } from '../middleware/validation';
import { TrackingService } from '../services/trackingService';
import { LegalHoldService } from '../services/legalHoldService';

const router = express.Router();

// All routes require shipper authentication
router.use(authenticate);
router.use(requireShipper);

// ── Ownership guard ────────────────────────────────────────────────────────────
// Fetch the caller's shipper profile and verify they own the requested load.
// Throws AppError 404 if the load or profile doesn't exist, 403 if mismatch.
// Returns { load, shipper } so callers don't need a second DB round-trip.
async function requireOwnLoad(userId: string, loadId: string) {
  const shipper = await ShipperService.getProfileByUserId(userId);
  if (!shipper) throw new AppError(
    JSON.stringify({ error: 'Shipper profile not found', code: 'PROFILE_INCOMPLETE' }),
    400
  );

  const load = await LoadService.getLoadById(loadId);
  if (!load) throw new AppError('Load not found', 404);

  if (load.shipperId !== shipper.shipperId) {
    throw new AppError('Forbidden', 403);
  }
  return { load, shipper };
}

// ── Shipper profile gate ───────────────────────────────────────────────────────
// All routes that require an existing profile (everything except POST /profile)
// are preceded by this middleware. It returns a clear 400 with a JSON hint so
// the frontend can redirect the user to complete onboarding rather than showing
// a generic error page.
async function requireProfile(req: AuthRequest, res: any, next: any) {
  const shipper = await ShipperService.getProfileByUserId(req.user!.userId);
  if (!shipper) {
    return res.status(400).json({
      error: 'Shipper profile not found',
      code:  'PROFILE_INCOMPLETE',
      hint:  'Complete your shipper profile at POST /api/shipper/profile before using this endpoint.',
    });
  }
  (req as any).shipperProfile = shipper;
  next();
}

// POST /api/shipper/profile  - profile creation, no gate needed
router.post('/profile', validate(shipperValidators.createProfile), asyncHandler(async (req: AuthRequest, res) => {
  const shipper = await ShipperService.createProfile(req.user!.userId, req.body);
  res.status(201).json({ shipper });
}));

// GET /api/shipper/profile
router.get('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const shipper = await ShipperService.getProfileByUserId(req.user!.userId);
  res.json({ shipper });
}));

// PUT /api/shipper/profile
router.put('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const shipper = await ShipperService.getProfileByUserId(req.user!.userId);
  if (shipper) {
    await ShipperService.updateProfile(shipper.shipperId, req.body);
    res.json({ message: 'Profile updated successfully' });
  } else {
    res.status(404).json({ error: 'Shipper profile not found' });
  }
}));

// POST /api/shipper/admin-request
router.post('/admin-request', asyncHandler(requireProfile), asyncHandler(async (req: AuthRequest, res) => {
  const shipper = (req as any).shipperProfile;
  await ShipperService.requestAdminPrivileges(shipper.shipperId);
  res.json({ message: 'Admin privileges requested successfully' });
}));

// POST /api/shipper/loads/draft
router.post('/loads/draft', asyncHandler(requireProfile), validate(loadValidators.createLoad), asyncHandler(async (req: AuthRequest, res) => {
  const shipper = (req as any).shipperProfile;
  const load = await LoadService.createDraft(shipper.shipperId, req.body);

  // Freeze the accessorial policy and record the shipper's append-only agreement
  // to the detention/layover terms. The frozen policy is the same snapshot the
  // carrier later reads and acknowledges. The `accessorial` block is ignored by
  // createDraft (which maps only known Load fields), so it never touches the Load.
  const acc = (req.body as any).accessorial;
  if (acc) {
    if (acc.agreed !== true) {
      throw new AppError('ACCESSORIAL_AGREEMENT_REQUIRED: agree to the detention and layover terms to post', 400);
    }
    const agreed = await AccessorialPolicyService.freezeAndAgreeAtPosting({
      load: { loadId: load.loadId, hazmat: load.hazmat, equipmentType: load.equipmentType },
      shipperId: shipper.shipperId,
      actorId: req.user!.userId,
      override: acc.override,
    });
    return res.status(201).json({ load, accessorial: { disclosure: agreed.disclosure, agreementId: agreed.agreement.agreementId } });
  }

  res.status(201).json({ load });
}));

// POST /api/shipper/loads/:loadId/sign - record the shipper's BOL_SUBMIT attestation.
//
// Phase-1 gate: NO broadcast until this signature exists. Wired via
// hasSignature() in the submit handler below; this endpoint is the only
// way to satisfy the precondition.
router.post('/loads/:loadId/sign', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const { load, shipper } = await requireOwnLoad(req.user!.userId, loadId);

  const { signatureType, signatureData, consentGiven, photoIds } = req.body ?? {};
  if (consentGiven !== true) {
    throw new AppError(JSON.stringify({ error: 'CONSENT_REQUIRED', code: 'CONSENT_REQUIRED' }), 400);
  }
  if (!signatureType || !signatureData) {
    throw new AppError(JSON.stringify({ error: 'signatureType + signatureData required', code: 'SIG_DATA_REQUIRED' }), 400);
  }

  const { assertSignerIsLoadParty } = await import('../services/attestation/assertSignerIsLoadParty');
  const { recordSignature } = await import('../services/attestation/signatureService');
  const { listReadyPhotos } = await import('../services/attestation/podPhotoService');

  // Resolver-based authZ: NO denormalized signer field. Fails 403 on wrong party.
  const resolution = await assertSignerIsLoadParty(load, 'BOL_SUBMIT', req.user!.userId);

  // Origin photos for BOL_SUBMIT are OPTIONAL - load the READY-only set.
  const photos = photoIds?.length
    ? (await listReadyPhotos(loadId, 'ORIGIN')).filter((p) => photoIds.includes(p.photoId))
    : [];

  const sig = await recordSignature({
    load,
    action: 'BOL_SUBMIT',
    signerUserId:  req.user!.userId,
    signerRole:    resolution.signerRole,
    signatureType, signatureData,
    consentGiven:  true,
    ipAddress:     req.ip,
    userAgent:     req.get('user-agent') ?? undefined,
    shipperOrgId:  resolution.signerOrgId ?? null,
    shipperUserId: shipper.userId,
    photos,
  });

  res.status(201).json({ signatureId: sig.signatureId, documentHash: sig.documentHash, signedAt: sig.signedAt });
}));

// POST /api/shipper/loads/:loadId/submit
//
// Gate: shipper must have signed BOL_SUBMIT for this load. The signature
// chain (Signatures table, GSI loadId-signedAt-index) is checked here; no
// signature => 412 rejection with a structured code.
router.post('/loads/:loadId/submit', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  await requireOwnLoad(req.user!.userId, loadId);   // ← ownership check

  // Gate: chain must contain a BOL_SUBMIT signature.
  const { getChain } = await import('../services/attestation/signatureService');
  const chain = await getChain(loadId);
  const submitSig = chain.find((s) => s.action === 'BOL_SUBMIT');
  if (!submitSig) {
    throw new AppError(
      JSON.stringify({ error: 'SIGNATURE_REQUIRED: BOL_SUBMIT signature is required to broadcast', code: 'BOL_SUBMIT_SIGNATURE_REQUIRED' }),
      412,
    );
  }

  await LoadService.submitLoad(loadId);
  res.json({ message: 'Load submitted and broadcast initiated', attestationSignatureId: submitSig.signatureId });
}));

// GET /api/shipper/loads
router.get('/loads', asyncHandler(requireProfile), asyncHandler(async (req: AuthRequest, res) => {
  const shipper = (req as any).shipperProfile;
  let loads = await LoadService.getLoadsByShipper(shipper.shipperId);

  // Filter: ?status=BOOKED&search=dallas&date=2026-06-01
  const { status, search, date } = req.query as Record<string, string>;
  if (status) loads = loads.filter((l: any) => l.status === status.toUpperCase());
  if (date) loads = loads.filter((l: any) => l.pickupDate?.startsWith(date) || l.createdAt?.startsWith(date));
  if (search) {
    const q = search.toLowerCase();
    loads = loads.filter((l: any) =>
      [l.pickupCity, l.deliveryCity, l.assignedDriverId, l.referenceNumber, l.commodityDescription]
        .some((f: any) => f?.toLowerCase().includes(q))
    );
  }
  // Sort newest first
  loads = loads.sort((a: any, b: any) => (b.createdAt ?? '') > (a.createdAt ?? '') ? 1 : -1);

  res.json({ loads });
}));

// GET /api/shipper/loads/:loadId
router.get('/loads/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  // Ownership check: throws 404 if load missing, 403 if not owned by caller.
  // Returns load so we skip a second getLoadById call below.
  const { load } = await requireOwnLoad(req.user!.userId, loadId);

  // Compute miles on read (Google Distance Matrix) if missing
    if (load && (!load.totalMiles || load.totalMiles <= 0)) {
      const patch = await RoutingService.enrichLoadRoute(load);
      if (patch) Object.assign(load, patch);
    }

    let tracking: any = null;

      // Only for BOOKED loads with an assigned driver
      if (load?.assignedDriverId) {
        try {
          const driver = await DriverService.getProfileById(load.assignedDriverId);

          const hasDriverCoords = driver?.currentLat && driver?.currentLng;
          const hasDeliveryCoords = load?.deliveryLat && load?.deliveryLng;

          let eta = null;
          if (hasDriverCoords && hasDeliveryCoords) {
            eta = await RoutingService.distanceMatrixMilesAndDuration(
              { lat: driver.currentLat, lng: driver.currentLng },
              { lat: load.deliveryLat, lng: load.deliveryLng }
            );
          }

          tracking = {
            driverLocation: hasDriverCoords ? {
              driverId: driver.driverId,
              lat: driver.currentLat,
              lng: driver.currentLng,
              city: driver.currentCity || null,
              state: driver.currentState || null,
              updatedAt: driver.lastLocationUpdate || null,
            } : null,
            etaToDelivery: eta ? {
              miles: Math.round((eta.miles || 0) * 10) / 10,
              durationSeconds: eta.durationSeconds,
              durationText: eta.durationText,
            } : null,
          };
        } catch (e) {
          // non-fatal; keep tracking null
        }
      }

      res.json({ load, tracking });
}));

// M9 (audit v6): a shipper may edit only descriptive/logistics fields on their own
// load. Ownership was checked, but the whole req.body was passed to updateLoad, so a
// shipper could set status (bypass the negotiation/delivery state machine), rateAmount
// or other money fields, assignedDriverId/carrierId, or inject arbitrary attributes.
// Allowlist the editable set and drop everything else. Money, assignment, IDs, status,
// and derived/audit fields are intentionally NOT editable via this endpoint.
const SHIPPER_EDITABLE_LOAD_FIELDS = new Set<string>([
  'referenceNumber', 'equipmentType', 'loadSize', 'totalWeightLbs',
  'length', 'width', 'height', 'dimLengthIn', 'dimWidthIn', 'dimHeightIn', 'loadVolumeCuIn',
  'acceptedEquipmentTypes', 'tempRequiredMin', 'tempRequiredMax',
  'pickupFacility', 'pickupCity', 'pickupState', 'pickupZip', 'pickupAddress',
  'pickupLat', 'pickupLng', 'pickupDate', 'pickupTime', 'pickupType', 'pickupInstructions',
  'deliveryFacility', 'deliveryCity', 'deliveryState', 'deliveryZip', 'deliveryAddress',
  'deliveryLat', 'deliveryLng', 'deliveryDate', 'deliveryTime', 'deliveryType', 'deliveryInstructions',
  'commodityDescription', 'commodity', 'palletCount', 'stackable', 'fragile', 'highValue',
  'hazmat', 'hazmatClass', 'temperatureMin', 'temperatureMax',
  'minMcMaturityDays', 'minCargoInsurance', 'minLiabilityInsurance',
  'requiredEndorsements', 'experienceRequired', 'broadcastRadiusMiles', 'offerTtlMinutes',
  'characteristics', 'service_type', 'mode', 'equipment_required', 'equipment_model',
  'trailer_utilization', 'team_driver_required', 'twic_required', 'accessorials',
]);

// PUT /api/shipper/loads/:loadId
router.put('/loads/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  await requireOwnLoad(req.user!.userId, loadId);   // ← ownership check

  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (SHIPPER_EDITABLE_LOAD_FIELDS.has(k)) updates[k] = v;
  }

  await LoadService.updateLoad(loadId, updates);
  res.json({ message: 'Load updated successfully' });
}));

// DELETE /api/shipper/loads/:loadId
router.delete('/loads/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  await requireOwnLoad(req.user!.userId, loadId);   // ← ownership check
  // SEC-5 (audit v5): a load under a legal hold (dispute, law-enforcement
  // request) must not be deletable. LegalHoldService.assertDeletable existed but
  // had ZERO callers; this is its first live enforcement point. Throws 423.
  await LegalHoldService.assertDeletable('LOAD', loadId);

  await LoadService.cancelLoad(loadId);
  res.json({ message: 'Load cancelled successfully' });
}));

// GET /api/shipper/loads/:loadId/tracking
router.get('/loads/:loadId/tracking', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const tracking = await TrackingService.getLoadTrackingForShipper(loadId, req.user!.userId);
  res.json(tracking);
}));

export default router;
