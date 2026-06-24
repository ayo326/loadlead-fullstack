import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const podS3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
import { DriverService } from '../services/driverService';
import { OfferService } from '../services/offerService';
import { LoadService } from '../services/loadService';
import { CapacityService, calcUsableVolume } from '../services/capacityService';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { UserRole } from '../types';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { driverValidators } from '../utils/validators';
import { validate } from '../middleware/validation';
import { EmailService } from '../services/emailService';
import { PushService } from '../services/pushService';
import { requireVerifiedCarrier, submitDriverIdv, getVerification } from '../services/verification';
import { OwnerOperatorService } from '../services/ownerOperatorService';
import { OrgMembershipService } from '../services/orgService';
import { Database } from '../config/database';
import config from '../config/environment';

const POD_BUCKET = process.env.POD_S3_BUCKET || 'loadlead-pod-uploads';

const router = express.Router();

router.use(authenticate);
// OWNER_OPERATOR is admitted because their self-driver row makes them the
// driver of record on their own loads — DriverService.getProfileByUserId
// already resolves it correctly. Without this, OO self-haul cannot use
// the per-driver routes (loadboard, pickup, deliver, etc.), which broke
// the prod attestation e2e on DRIVER_PICKUP.
router.use(requireRole(UserRole.DRIVER, UserRole.OWNER_OPERATOR, UserRole.ADMIN));

router.post(
  '/profile',
  validate(driverValidators.createProfile),
  asyncHandler(async (req: AuthRequest, res) => {
    const driver = await DriverService.createProfile(req.user!.userId, req.body);
    res.status(201).json({ driver });
  })
);

router.get(
  '/profile',
  asyncHandler(async (req: AuthRequest, res) => {
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    res.json({ driver });
  })
);

router.put(
  '/profile',
  asyncHandler(async (req: AuthRequest, res) => {
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    await DriverService.updateProfile(driver.driverId, req.body);
    res.json({ message: 'Profile updated successfully' });
  })
);

router.post(
  '/location',
  validate(driverValidators.updateLocation),
  asyncHandler(async (req: AuthRequest, res) => {
    const { lat, lng, city, state } = req.body;
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    await DriverService.updateLocation(driver.driverId, lat, lng, city, state);
    res.json({ message: 'Location updated successfully' });
  })
);

router.post(
  '/load-status',
  validate(driverValidators.updateLoadStatus),
  asyncHandler(async (req: AuthRequest, res) => {
    const { currentLoadLbs } = req.body;
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    await DriverService.updateLoadStatus(driver.driverId, currentLoadLbs);
    res.json({ message: 'Load status updated successfully' });
  })
);

router.get(
  '/loadboard',
  asyncHandler(async (req: AuthRequest, res) => {
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    // Return empty loadboard if profile not yet created (new driver)
    if (!driver) return res.json({ loads: [] });

    const offers = await OfferService.getActiveOffersByDriver(driver.driverId);
    const loadsWithOffers = await Promise.all(
      offers.map(async (offer) => ({ load: await LoadService.getLoadById(offer.loadId), offer }))
    );

    res.json({ loads: loadsWithOffers });
  })
);

router.get(
  '/offers/:loadId',
  asyncHandler(async (req: AuthRequest, res) => {
    const { loadId } = req.params;
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    const offer = await OfferService.getOffer(loadId, driver.driverId);
    const load = await LoadService.getLoadById(loadId);
    res.json({ offer, load });
  })
);

router.post(
  '/offers/:loadId/accept',
  requireVerifiedCarrier(),
  asyncHandler(async (req: AuthRequest, res) => {
    const { loadId } = req.params;
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    // GATE: chain must contain a CARRIER_ACCEPT signature whose projection
    // bound THIS driver as the assignedDriverId. requireSignature returns
    // the row; we cross-check assignedDriverId from the signature record
    // so a sig signed for driver A cannot let driver B execute the accept.
    const { requireSignature } = await import('../services/attestation/requireSignature');
    const sig = await requireSignature(loadId, 'CARRIER_ACCEPT');
    // The canonical projection for CARRIER_ACCEPT includes assignedDriverId,
    // and signatureService captured the same value into the signature's
    // documentHash. We treat the signature's documentHash + proof at sign
    // time as the source of truth; this check fails LATE on driver mismatch
    // so we surface a clear error rather than silently re-using.
    if (sig.signerRole !== 'CARRIER_ADMIN' && sig.signerRole !== 'OWNER_OPERATOR') {
      throw new AppError(JSON.stringify({
        error: 'Invalid CARRIER_ACCEPT signer role',
        code:  'CARRIER_ACCEPT_SIGNER_INVALID',
      }), 409);
    }

    await OfferService.acceptOffer(loadId, driver.driverId);

    // Notify shipper by email + push that offer was accepted
    try {
      const load = await LoadService.getLoadById(loadId);
      if (load?.shipperId) {
        const origin = `${load.pickupCity}, ${load.pickupState}`;
        const destination = `${load.deliveryCity}, ${load.deliveryState}`;
        // Email + push (best-effort — shipperId used as userId since they share the same ID)
        await PushService.send(load.shipperId, '✅ Load Accepted',
          `${driver.fullName || 'A driver'} accepted your load: ${origin} → ${destination}`,
          `https://loadleadapp.com/shipper/loads/${loadId}`);
      }
    } catch (_) {}

    res.json({ message: 'Offer accepted successfully' });
  })
);

router.post(
  '/offers/:loadId/decline',
  asyncHandler(async (req: AuthRequest, res) => {
    const { loadId } = req.params;
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    await OfferService.declineOffer(loadId, driver.driverId);
    res.json({ message: 'Offer declined successfully' });
  })
);

router.get(
  '/active-loads',
  asyncHandler(async (req: AuthRequest, res) => {
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    const booked = await LoadService.getLoadsByStatus('BOOKED' as any);
    let inTransit: any[] = [];
    try { inTransit = await LoadService.getLoadsByStatus('IN_TRANSIT' as any); } catch {}

    const loads = [...(booked || []), ...(inTransit || [])].filter(
      (l: any) => l && l.assignedDriverId === driver.driverId
    );

    res.json({ loads });
  })
);

// POST /api/driver/headshot/upload-url — presigned URL to upload profile headshot
router.post(
  '/headshot/upload-url',
  asyncHandler(async (req: AuthRequest, res) => {
    const { fileType = 'image/jpeg' } = req.body;
    const key = `headshots/${req.user!.userId}.jpg`;
    const cmd = new PutObjectCommand({ Bucket: POD_BUCKET, Key: key, ContentType: fileType });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = await getSignedUrl(podS3 as any, cmd as any, { expiresIn: 300 });
    const publicUrl = `https://${POD_BUCKET}.s3.amazonaws.com/${key}`;
    res.json({ uploadUrl: url, key, publicUrl });
  })
);

// POST /api/driver/loads/:loadId/pod/upload-url — get presigned S3 URL for photo upload
router.post(
  '/loads/:loadId/pod/upload-url',
  asyncHandler(async (req: AuthRequest, res) => {
    const { loadId } = req.params;
    const { fileType = 'image/jpeg' } = req.body;
    const key = `pod/${loadId}/${Date.now()}.jpg`;
    const cmd = new PutObjectCommand({ Bucket: POD_BUCKET, Key: key, ContentType: fileType });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = await getSignedUrl(podS3 as any, cmd as any, { expiresIn: 300 });
    res.json({ uploadUrl: url, key, publicUrl: `https://${POD_BUCKET}.s3.amazonaws.com/${key}` });
  })
);

// POST /api/driver/loads/:loadId/pickup — driver pickup transition (NEW).
// GATE: chain must contain a DRIVER_PICKUP signature (records pickup
// photos + driver attestation). Transitions Load.status BOOKED → IN_TRANSIT.
// Closes LOAD-E2E-004 (missing IN_TRANSIT endpoint).
router.post(
  '/loads/:loadId/pickup',
  asyncHandler(async (req: AuthRequest, res) => {
    const { loadId } = req.params;
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    const { requireSignature } = await import('../services/attestation/requireSignature');
    const sig = await requireSignature(loadId, 'DRIVER_PICKUP');
    if (sig.signerUserId !== req.user!.userId) {
      throw new AppError(JSON.stringify({
        error: 'DRIVER_PICKUP signature was signed by a different user',
        code:  'PICKUP_SIGNER_MISMATCH',
      }), 409);
    }

    await LoadService.updateLoad(loadId, { status: 'IN_TRANSIT' as any });
    res.json({ message: 'Pickup recorded; load IN_TRANSIT.', attestationSignatureId: sig.signatureId });
  }),
);

// POST /api/driver/loads/:loadId/deliver — driver delivery transition (NEW; replaces /pod).
// GATE: chain must contain a DRIVER_DELIVER signature with delivery photos.
// Transitions Load.status IN_TRANSIT → DELIVERED.
router.post(
  '/loads/:loadId/deliver',
  asyncHandler(async (req: AuthRequest, res) => {
    const { loadId } = req.params;
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    const { requireSignature } = await import('../services/attestation/requireSignature');
    const sig = await requireSignature(loadId, 'DRIVER_DELIVER');
    if (sig.signerUserId !== req.user!.userId) {
      throw new AppError(JSON.stringify({
        error: 'DRIVER_DELIVER signature was signed by a different user',
        code:  'DELIVER_SIGNER_MISMATCH',
      }), 409);
    }

    await LoadService.updateLoad(loadId, { status: 'DELIVERED' as any });

    // Notify shipper + receiver. Best-effort.
    try {
      const load = await LoadService.getLoadById(loadId);
      const origin      = `${load?.pickupCity}, ${load?.pickupState}`;
      const destination = `${load?.deliveryCity}, ${load?.deliveryState}`;
      if (load?.shipperId) {
        await PushService.send(load.shipperId, '📦 Delivery Confirmed',
          `${origin} → ${destination} delivered.`,
          `https://loadleadapp.com/shipper/loads/${loadId}`);
      }
      if (load?.receiverId) {
        await PushService.send(load.receiverId, '📦 Your Shipment Arrived',
          `Delivery confirmed for ${destination}.`,
          `https://loadleadapp.com/receiver/loads/${loadId}`);
      }
    } catch (_) {}

    res.json({ message: 'Delivery recorded; load DELIVERED.', attestationSignatureId: sig.signatureId });
  }),
);

// POST /api/driver/loads/:loadId/pod — LEGACY (deprecated). Kept for back-compat.
// Returns 410 with a structured deprecation message pointing clients at the
// new sign + deliver flow. Will be removed in Phase 1b after client cutover.
router.post(
  '/loads/:loadId/pod',
  asyncHandler(async (req: AuthRequest, res) => {
    void req;
    throw new AppError(JSON.stringify({
      error: 'Deprecated. Use POST /api/attestation/sign (action=DRIVER_DELIVER) then POST /api/driver/loads/:loadId/deliver.',
      code:  'POD_ENDPOINT_DEPRECATED',
    }), 410);
  }),
);

// POST /api/driver/loads/:loadId/pod-legacy — bypass to preserve existing
// driver-app behavior until clients migrate. Same body shape as before;
// auto-marks DELIVERED without attestation. Behind ALLOW_LEGACY_POD env so
// it can be turned off cleanly.
router.post(
  '/loads/:loadId/pod-legacy',
  asyncHandler(async (req: AuthRequest, res) => {
    if (process.env.ALLOW_LEGACY_POD !== '1') {
      throw new AppError(JSON.stringify({
        error: 'Legacy POD endpoint disabled. Set ALLOW_LEGACY_POD=1 to re-enable.',
        code:  'POD_LEGACY_DISABLED',
      }), 410);
    }
    const { loadId } = req.params;
    const { photoKey, signatureData, notes } = req.body;
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    await LoadService.updateLoad(loadId, {
      podPhotoKey: photoKey,
      podSignature: signatureData,
      podNotes: notes,
      podSubmittedAt: new Date().toISOString(),
      podDriverId: driver.driverId,
    } as any);
    await LoadService.updateLoad(loadId, { status: 'DELIVERED' as any });

    // Notify shipper + receiver
    try {
      const load = await LoadService.getLoadById(loadId);
      const origin = `${load?.pickupCity}, ${load?.pickupState}`;
      const destination = `${load?.deliveryCity}, ${load?.deliveryState}`;
      const deliveredAt = new Date().toLocaleString();
      if (load?.shipperId) {
        await PushService.send(load.shipperId, '📦 Delivery Confirmed', `${origin} → ${destination} delivered.`,
          `https://loadleadapp.com/shipper/loads/${loadId}`);
      }
      if (load?.receiverId) {
        await PushService.send(load.receiverId, '📦 Your Shipment Arrived', `Delivery confirmed for ${destination}.`,
          `https://loadleadapp.com/receiver/loads/${loadId}`);
      }
    } catch (_) {}

    res.json({ message: 'Proof of delivery recorded. Load marked DELIVERED.' });
  })
);

// POST /api/driver/capacity/check — evaluate a prospective load against driver's current capacity
router.post(
  '/capacity/check',
  asyncHandler(async (req: AuthRequest, res) => {
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    const { totalWeightLbs = 0, dimLengthIn, dimWidthIn, dimHeightIn } = req.body;
    const loadVolumeCuIn = calcUsableVolume(dimLengthIn, dimWidthIn, dimHeightIn);

    const fakeLoad = { totalWeightLbs, dimLengthIn, dimWidthIn, dimHeightIn, loadVolumeCuIn,
      equipmentType: driver.trailerType } as any;
    const result = CapacityService.evaluateLoad(driver as any, fakeLoad);
    res.json(result);
  })
);

// GET /api/driver/history — loads this driver has accepted (BOOKED / IN_TRANSIT / DELIVERED)
router.get(
  '/history',
  asyncHandler(async (req: AuthRequest, res) => {
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.json({ loads: [] });

    // All offers ever made to this driver
    const allOffers = await OfferService.getOffersByDriver(driver.driverId);
    // Keep only accepted ones
    const accepted = allOffers.filter((o: any) => o.status === 'ACCEPTED');

    const loadsWithOffers = await Promise.all(
      accepted.map(async (offer: any) => ({
        load: await LoadService.getLoadById(offer.loadId),
        offer,
      }))
    );

    // Drop loads that were deleted / not found, sort newest-accepted first
    const result = loadsWithOffers
      .filter((item) => item.load)
      .sort((a, b) => (b.offer.acceptedAt ?? 0) - (a.offer.acceptedAt ?? 0));

    res.json({ loads: result });
  })
);

// PATCH /api/driver/capacity/buffer — driver views/confirms their buffer (read-only for drivers; only admins change it)
router.get(
  '/capacity/buffer',
  asyncHandler(async (req: AuthRequest, res) => {
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    const bufferPct = driver.safetyBufferPct ?? 10;
    const setByRole = driver.bufferSetByRole ?? 'ADMIN';
    res.json({
      safetyBufferPct: bufferPct,
      overBufferFlag: driver.overBufferFlag ?? false,
      maxCapacityLbs: driver.maxCapacityLbs,
      maxOperationalLbs: driver.maxCapacityLbs * (1 - (bufferPct / 100)),
      bufferSetByRole: setByRole,
      bufferSetByMessage: setByRole === 'OWNER'
        ? 'Safety buffer set by your owner.'
        : 'Safety buffer set by your admin.',
    });
  })
);

// ── Fleet invite acceptance ───────────────────────────────────────────────────

// POST /api/driver/fleet/accept-invite
// Driver calls this after clicking the invite link sent by an Owner Operator.
// Body: { token: string }
// Sets ownedByOperatorId on the driver record and adds them to the OO's fleet.
router.post(
  '/fleet/accept-invite',
  asyncHandler(async (req: AuthRequest, res) => {
    const { token } = req.body;
    if (!token) throw new AppError('token is required', 400);

    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    if (driver.ownedByOperatorId) {
      throw new AppError('You are already part of a fleet. Leave your current fleet before accepting a new invite.', 409);
    }

    const { operatorId } = await OwnerOperatorService.acceptFleetInvite(token, driver.driverId);

    // Set ownedByOperatorId on the driver — this is what carrierOfRecord.ts reads
    // to resolve the governing carrier entity for fleet drivers.
    await Database.updateItem(
      config.dynamodb.driversTable,
      { driverId: driver.driverId },
      { ownedByOperatorId: operatorId },
    );

    // One-parent invariant: a fleet driver cannot also hold an active
    // Carrier-org membership (symmetric to the check in OrgInvitationService).
    await OrgMembershipService.clearActiveCarrierMembership(driver.userId);

    res.json({ ok: true, operatorId });
  }),
);

// ── Verification ─────────────────────────────────────────────────────────────

// GET /api/driver/verification — current IDV status
// Identity is per-person (User.idvStatus), not per-Driver-row, so it's keyed
// by userId — this also means it works before a Driver profile even exists.
router.get(
  '/verification',
  asyncHandler(async (req: AuthRequest, res) => {
    const verification = await getVerification(req.user!.userId);
    res.json({ verification: verification ?? { verificationStatus: 'UNVERIFIED' } });
  }),
);

// POST /api/driver/verification/submit — start IDV for this person
router.post(
  '/verification/submit',
  asyncHandler(async (req: AuthRequest, res) => {
    const verification = await submitDriverIdv(req.user!.userId);
    res.status(201).json({ verification });
    // Didit IDV session is created with vendor_data = req.user.userId
  }),
);

export default router;
