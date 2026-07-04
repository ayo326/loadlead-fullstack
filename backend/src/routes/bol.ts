import express from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { BOLService } from '../services/bolService';
import { LoadService } from '../services/loadService';
import { DriverService } from '../services/driverService';
import { ShipperService } from '../services/shipperService';
import { ReceiverService } from '../services/receiverService';
import { BOLSignature } from '../types';

const router = express.Router();
router.use(authenticate);

// ── BOL access guard ──────────────────────────────────────────────────────────
// Verifies the requesting user is a legitimate party on the BOL's load:
//   ADMIN      → always allowed
//   SHIPPER    → must own the load (load.shipperId === their shipper profile)
//   DRIVER     → must be assigned to the load (load.assignedDriverId === their driverId)
//   RECEIVER   → must be the load's receiver (load.receiverId === their receiverId)
// Throws AppError 403 for everyone else.  asyncHandler catches AppErrors automatically.
async function requireBOLAccess(req: AuthRequest, bol: any): Promise<void> {
  if (req.user!.role === 'ADMIN') return;

  const load = await LoadService.getLoadById(bol.loadId);
  if (!load) throw new AppError('Associated load not found', 404);

  const userId = req.user!.userId;
  const role   = req.user!.role as string;

  if (role === 'SHIPPER') {
    const shipper = await ShipperService.getProfileByUserId(userId);
    if (shipper && load.shipperId === shipper.shipperId) return;
  } else if (role === 'DRIVER') {
    const driver = await DriverService.getProfileByUserId(userId);
    if (driver && load.assignedDriverId === driver.driverId) return;
  } else if (role === 'RECEIVER') {
    const receiver = await ReceiverService.getProfileByUserId(userId).catch(() => null);
    if (receiver && load.receiverId === receiver.receiverId) return;
  }

  throw new AppError('Forbidden', 403);
}

// ─── GET /api/bol/:bolId ──────────────────────────────────────────────────────
// Only parties on the associated load (shipper, assigned driver, receiver, admin).
router.get('/:bolId', asyncHandler(async (req: AuthRequest, res) => {
  const bol = await BOLService.getBOLById(req.params.bolId);
  if (!bol) return res.status(404).json({ error: 'BOL not found' });
  await requireBOLAccess(req, bol);   // ← ownership check; throws 403 if not a party
  res.json({ bol });
}));

// ─── GET /api/bol/load/:loadId ────────────────────────────────────────────────
// Get BOL by load ID - same party-based access check as GET /:bolId.
router.get('/load/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const bol = await BOLService.getBOLByLoadId(req.params.loadId);
  if (!bol) return res.status(404).json({ error: 'BOL not found for this load' });
  await requireBOLAccess(req, bol);   // ← ownership check
  res.json({ bol });
}));

// ─── POST /api/bol ────────────────────────────────────────────────────────────
// Shipper creates a BOL for a load (auto-populates from profiles)
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId, extraFields } = req.body;
  if (!loadId) return res.status(400).json({ error: 'loadId is required' });

  const load = await LoadService.getLoadById(loadId);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const shipper = await ShipperService.getProfileByUserId(req.user!.userId);
  if (!shipper) return res.status(404).json({ error: 'Shipper profile not found' });

  // Try to get driver and receiver profiles if load is assigned
  let driver = null;
  let receiver = null;
  if ((load as any).driverId) {
    driver = await DriverService.getProfileById((load as any).driverId).catch(() => null);
  }
  if ((load as any).receiverId) {
    receiver = await ReceiverService.getProfileById((load as any).receiverId).catch(() => null);
  }

  const bol = await BOLService.createBOL({
    loadId,
    createdBy: req.user!.userId,
    shipper,
    load,
    driver: driver || undefined,
    receiver: receiver || undefined,
    extraFields,
  });

  res.status(201).json({ bol });
}));

// ─── PUT /api/bol/:bolId ──────────────────────────────────────────────────────
// Shipper updates BOL fields (before carrier signs)
router.put('/:bolId', asyncHandler(async (req: AuthRequest, res) => {
  const bol = await BOLService.updateBOL(req.params.bolId, req.body, req.user!.userId);
  res.json({ bol });
}));

// ─── POST /api/bol/:bolId/sign ────────────────────────────────────────────────
// Sign the BOL - role determines which signature slot is filled
router.post('/:bolId/sign', asyncHandler(async (req: AuthRequest, res) => {
  const { signatureData, signedBy, location } = req.body;
  if (!signatureData || !signedBy) {
    return res.status(400).json({ error: 'signatureData and signedBy are required' });
  }

  const role = req.user!.role as string;
  // Shippers CREATE the BOL; only the carrier (DRIVER) and consignee (RECEIVER) sign it.
  let sigRole: 'DRIVER' | 'RECEIVER';
  if (role === 'DRIVER') sigRole = 'DRIVER';
  else if (role === 'RECEIVER') sigRole = 'RECEIVER';
  else return res.status(403).json({ error: 'Only Driver or Receiver can sign a BOL' });

  const signature: BOLSignature = {
    signedBy,
    signatureData,
    signedAt: new Date().toISOString(),
    location,
    ipAddress: req.ip,
  };

  const bol = await BOLService.sign(req.params.bolId, sigRole, signature, req.user!.userId);
  res.json({ bol });
}));

// ─── POST /api/bol/:bolId/dispute ─────────────────────────────────────────────
// Flag a BOL as disputed (receiver or shipper)
router.post('/:bolId/dispute', asyncHandler(async (req: AuthRequest, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const bol = await BOLService.disputeBOL(
    req.params.bolId,
    reason,
    req.user!.userId,
    req.user!.role
  );
  res.json({ bol });
}));

// ─── PUT /api/bol/:bolId/wms ──────────────────────────────────────────────────
// Update WMS integration fields (receiver or admin)
router.put('/:bolId/wms', asyncHandler(async (req: AuthRequest, res) => {
  const bol = await BOLService.updateWMS(req.params.bolId, req.body, req.user!.userId);
  res.json({ bol });
}));

// ─── GET /api/bol/admin/all ───────────────────────────────────────────────────
// Admin: list BOLs by status
router.get('/admin/all', asyncHandler(async (req: AuthRequest, res) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  const { status } = req.query;
  const bols = status
    ? await BOLService.getBOLsByStatus(status as any)
    : [];
  res.json({ bols });
}));

export default router;
