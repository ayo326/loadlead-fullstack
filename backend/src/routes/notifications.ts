import express from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { PushService } from '../services/pushService';
import { NotificationService } from '../services/notificationService';

const router = express.Router();
router.use(authenticate);

// ── In-app notification inbox ───────────────────────────────────────────────

router.get('/inbox', asyncHandler(async (req: AuthRequest, res) => {
  const notifications = await NotificationService.listForUser(req.user!.userId);
  res.json({ notifications });
}));

router.get('/inbox/unread-count', asyncHandler(async (req: AuthRequest, res) => {
  const count = await NotificationService.unreadCount(req.user!.userId);
  res.json({ count });
}));

router.post('/inbox/:notificationId/read', asyncHandler(async (req: AuthRequest, res) => {
  await NotificationService.markRead(req.params.notificationId, req.user!.userId);
  res.json({ ok: true });
}));

router.post('/inbox/read-all', asyncHandler(async (req: AuthRequest, res) => {
  const marked = await NotificationService.markAllRead(req.user!.userId);
  res.json({ marked });
}));

// GET /api/notifications/vapid-key - frontend fetches this to register SW
router.get('/vapid-key', (_req, res) => {
  res.json({ publicKey: PushService.VAPID_PUBLIC_KEY });
});

// POST /api/notifications/subscribe
router.post('/subscribe', asyncHandler(async (req: AuthRequest, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  await PushService.saveSubscription(req.user!.userId, subscription);
  res.json({ message: 'Subscribed to push notifications' });
}));

// DELETE /api/notifications/subscribe
router.delete('/subscribe', asyncHandler(async (req: AuthRequest, res) => {
  await PushService.removeSubscription(req.user!.userId);
  res.json({ message: 'Unsubscribed' });
}));

export default router;
