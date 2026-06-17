import express from 'express';
import { ShipperService } from '../services/shipperService';
import { RoutingService } from '../services/routingService';
import { LoadService } from '../services/loadService';
import { DriverService } from '../services/driverService';
import { authenticate, requireShipper, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { shipperValidators, loadValidators } from '../utils/validators';
import { validate } from '../middleware/validation';
import { TrackingService } from '../services/trackingService';

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

// POST /api/shipper/profile  — profile creation, no gate needed
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
  res.status(201).json({ load });
}));

// POST /api/shipper/loads/:loadId/submit
router.post('/loads/:loadId/submit', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  await requireOwnLoad(req.user!.userId, loadId);   // ← ownership check

  await LoadService.submitLoad(loadId);
  res.json({ message: 'Load submitted and broadcast initiated' });
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

// PUT /api/shipper/loads/:loadId
router.put('/loads/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  await requireOwnLoad(req.user!.userId, loadId);   // ← ownership check

  await LoadService.updateLoad(loadId, req.body);
  res.json({ message: 'Load updated successfully' });
}));

// DELETE /api/shipper/loads/:loadId
router.delete('/loads/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  await requireOwnLoad(req.user!.userId, loadId);   // ← ownership check

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
