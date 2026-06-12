import express from 'express';
import { DriverService } from '../services/driverService';
import { ShipperService } from '../services/shipperService';
import { LoadService } from '../services/loadService';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { TrackingService } from '../services/trackingService';
import { RoutingService } from '../services/routingService';

const router = express.Router();

// All routes require admin authentication
router.use(authenticate);
router.use(requireAdmin);

// GET /api/admin/drivers
router.get('/drivers', asyncHandler(async (req: AuthRequest, res) => {
  const { status } = req.query;
  
  let drivers;
  if (status) {
    drivers = await DriverService.getDriversByStatus(status as any);
  } else {
    // Get all drivers (you'd need to implement this in DriverService)
    drivers = await DriverService.getDriversByStatus('PENDING_VERIFICATION' as any);
  }
  
  res.json({ drivers });
}));

// GET /api/admin/drivers/:driverId
router.get('/drivers/:driverId', asyncHandler(async (req: AuthRequest, res) => {
  const { driverId } = req.params;
  const driver = await DriverService.getProfileById(driverId);
  
  res.json({ driver });
}));

// POST /api/admin/drivers/:driverId/verify
router.post('/drivers/:driverId/verify', asyncHandler(async (req: AuthRequest, res) => {
  const { driverId } = req.params;
  
  await DriverService.verifyDriver(driverId);
  res.json({ message: 'Driver verified successfully' });
}));

// POST /api/admin/drivers/:driverId/suspend
router.post('/drivers/:driverId/suspend', asyncHandler(async (req: AuthRequest, res) => {
  const { driverId } = req.params;
  
  await DriverService.suspendDriver(driverId);
  res.json({ message: 'Driver suspended successfully' });
}));

// GET /api/admin/shippers/admin-requests
router.get('/shippers/admin-requests', asyncHandler(async (req: AuthRequest, res) => {
  const requests = await ShipperService.getPendingAdminRequests();
  res.json({ requests });
}));

// POST /api/admin/shippers/:shipperId/approve-admin
router.post('/shippers/:shipperId/approve-admin', asyncHandler(async (req: AuthRequest, res) => {
  const { shipperId } = req.params;
  
  await ShipperService.approveAdminPrivileges(shipperId);
  res.json({ message: 'Shipper admin privileges approved' });
}));

// POST /api/admin/shippers/:shipperId/revoke-admin
router.post('/shippers/:shipperId/revoke-admin', asyncHandler(async (req: AuthRequest, res) => {
  const { shipperId } = req.params;
  
  await ShipperService.revokeAdminPrivileges(shipperId);
  res.json({ message: 'Shipper admin privileges revoked' });
}));

// GET /api/admin/loads
router.get('/loads', asyncHandler(async (req: AuthRequest, res) => {
  const { status } = req.query;
  
  let loads;
  if (status) {
    loads = await LoadService.getLoadsByStatus(status as any);
  } else {
    // Get all open loads
    loads = await LoadService.getLoadsByStatus('OPEN' as any);
  }
  
  res.json({ loads });
}));

// GET /api/admin/loads/:loadId
router.get('/loads/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const load = await LoadService.getLoadById(loadId);
  
  let tracking: any = null;

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
        } catch (e) {}
      }

      res.json({ load, tracking });
}));

// PUT /api/admin/loads/:loadId/status
router.put('/loads/:loadId/status', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const { status } = req.body;
  
  await LoadService.updateLoadStatus(loadId, status);
  res.json({ message: 'Load status updated successfully' });
}));

// GET /api/admin/loads/:loadId/tracking
router.get('/loads/:loadId/tracking', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const tracking = await TrackingService.getLoadTrackingForAdmin(loadId);
  res.json(tracking);
}));

export default router;
