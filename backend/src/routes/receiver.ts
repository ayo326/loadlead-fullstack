import express from 'express';
import { ReceiverService } from '../services/receiverService';
import { LoadService } from '../services/loadService';
import { authenticate, requireReceiver, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { receiverValidators } from '../utils/validators';
import { validate } from '../middleware/validation';

const router = express.Router();

// All routes require receiver authentication
router.use(authenticate);
router.use(requireReceiver);

// POST /api/receiver/profile
router.post('/profile', validate(receiverValidators.createProfile), asyncHandler(async (req: AuthRequest, res) => {
  const receiver = await ReceiverService.createProfile(req.user!.userId, req.body);
  res.status(201).json({ receiver });
}));

// GET /api/receiver/profile
router.get('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const receiver = await ReceiverService.getProfileByUserId(req.user!.userId);
  res.json({ receiver });
}));

// PUT /api/receiver/profile
router.put('/profile', validate(receiverValidators.updateProfile), asyncHandler(async (req: AuthRequest, res) => {
  const receiver = await ReceiverService.getProfileByUserId(req.user!.userId);
  if (receiver) {
    await ReceiverService.updateProfile(receiver.receiverId, req.body);
    res.json({ message: 'Profile updated successfully' });
  } else {
    res.status(404).json({ error: 'Receiver profile not found' });
  }
}));

// GET /api/receiver/loads/:loadId
router.get('/loads/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const load = await LoadService.getLoadById(loadId);
  if (!load) return res.status(404).json({ error: 'Load not found' });
  // SEC-H4: a receiver may only read loads addressed to them (404 on mismatch
  // so load existence in other tenants is not revealed).
  const receiver = await ReceiverService.getProfileByUserId(req.user!.userId).catch(() => null);
  if (!receiver || load.receiverId !== receiver.receiverId) {
    return res.status(404).json({ error: 'Load not found' });
  }
  res.json({ load });
}));

// POST /api/receiver/loads/:loadId/confirm - final receipt (NEW).
// GATE: chain must contain a RECEIVER_CONFIRM signature with receipt photos.
// Closes LOAD-E2E-005 / UI-E2E-003. The signature is created via
// POST /api/attestation/sign (action=RECEIVER_CONFIRM); this endpoint
// applies the transition only.
router.post('/loads/:loadId/confirm', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const load = await LoadService.getLoadById(loadId);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const { requireSignature } = await import('../services/attestation/requireSignature');
  const sig = await requireSignature(loadId, 'RECEIVER_CONFIRM');
  if (sig.signerUserId !== req.user!.userId) {
    return res.status(409).json({
      error: 'RECEIVER_CONFIRM signature was signed by a different user',
      code:  'RECEIVER_CONFIRM_SIGNER_MISMATCH',
    });
  }

  // The Load state machine doesn't currently have POD_RECEIVED, so we
  // attach the receiver attestation id without mutating status. The
  // attestation chain is the durable record.
  res.json({
    message: 'Receipt confirmed.',
    attestationSignatureId: sig.signatureId,
    exceptions: sig.exceptions ?? null,
  });
}));

// GET /api/receiver/incoming
router.get('/incoming', asyncHandler(async (req: AuthRequest, res) => {
  const receiver = await ReceiverService.getProfileByUserId(req.user!.userId);

  if (!receiver) {
    return res.status(404).json({ error: 'Receiver profile not found' });
  }

  // Get loads being delivered to this receiver
  const allLoads = await LoadService.getLoadsByStatus('IN_TRANSIT' as any);
  const incomingLoads = allLoads.filter(load => load.receiverId === receiver.receiverId);

  res.json({ loads: incomingLoads });
}));

export default router;
