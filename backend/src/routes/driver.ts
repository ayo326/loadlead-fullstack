import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const podS3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
import { DriverService } from '../services/driverService';
import { OfferService } from '../services/offerService';
import { LoadService } from '../services/loadService';
import { CapacityService, calcUsableVolume } from '../services/capacityService';
import { authenticate, requireDriver, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { driverValidators } from '../utils/validators';
import { validate } from '../middleware/validation';
import { EmailService } from '../services/emailService';
import { PushService } from '../services/pushService';

const POD_BUCKET = process.env.POD_S3_BUCKET || 'loadlead-pod-uploads';

const router = express.Router();

router.use(authenticate);
router.use(requireDriver);

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
  asyncHandler(async (req: AuthRequest, res) => {
    const { loadId } = req.params;
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

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

// POST /api/driver/loads/:loadId/pod — record POD (photo key + signature) on load
router.post(
  '/loads/:loadId/pod',
  asyncHandler(async (req: AuthRequest, res) => {
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
    // Mark delivered separately to satisfy type checks
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

// PATCH /api/driver/capacity/buffer — driver views/confirms their buffer (read-only for drivers; only admins change it)
router.get(
  '/capacity/buffer',
  asyncHandler(async (req: AuthRequest, res) => {
    const driver = await DriverService.getProfileByUserId(req.user!.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    res.json({
      safetyBufferPct: driver.safetyBufferPct ?? 10,
      overBufferFlag: driver.overBufferFlag ?? false,
      maxCapacityLbs: driver.maxCapacityLbs,
      maxOperationalLbs: driver.maxCapacityLbs * (1 - ((driver.safetyBufferPct ?? 10) / 100)),
    });
  })
);

export default router;
