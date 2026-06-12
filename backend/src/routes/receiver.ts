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
  res.json({ load });
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
