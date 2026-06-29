/**
 * Admin routes for beta trust/operational events (no-show, trust incident).
 *
 * Mounted at /api/admin/beta/trust-events. Exact-ADMIN gated with the same
 * authenticate + requireAdmin guards as the rest of /api/admin/*, so non-admins
 * get the inherited 401/403 and no new auth code is introduced.
 *
 * These records live in their own store (see betaTrustEventService) and reference
 * a load and carrier by id only. They never touch the Load model.
 */

import express from 'express';
import { body, query } from 'express-validator';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { Logger } from '../utils/logger';
import { BetaTrustEventService, BETA_TRUST_EVENT_TYPES } from '../services/betaTrustEventService';

const router = express.Router();

// Exact-ADMIN gate on every trust-event route.
router.use(authenticate);
router.use(requireAdmin);

/** POST /api/admin/beta/trust-events  { eventType, loadId, carrierId, note? } */
router.post(
  '/',
  validate([
    body('eventType').isString().isIn(BETA_TRUST_EVENT_TYPES),
    body('loadId').isString().isLength({ min: 1, max: 200 }),
    body('carrierId').isString().isLength({ min: 1, max: 200 }),
    body('note').optional().isString().isLength({ max: 2000 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const event = await BetaTrustEventService.record({
      eventType: req.body.eventType,
      loadId: req.body.loadId,
      carrierId: req.body.carrierId,
      recordedByAdminId: req.user!.userId,
      note: req.body.note,
    });
    Logger.info(`[beta-admin] ${req.user!.userId} recorded ${event.eventType} on load ${event.loadId}`);
    res.status(201).json({ event });
  })
);

/** GET /api/admin/beta/trust-events/summary?from=&to=  (epoch ms, both optional) */
router.get(
  '/summary',
  validate([
    query('from').optional().isInt({ min: 0 }),
    query('to').optional().isInt({ min: 0 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const fromMs = req.query.from != null ? parseInt(String(req.query.from), 10) : undefined;
    const toMs = req.query.to != null ? parseInt(String(req.query.to), 10) : undefined;
    const counts = await BetaTrustEventService.getCounts({ fromMs, toMs });
    res.json(counts);
  })
);

/** GET /api/admin/beta/trust-events?loadId=&limit=  recent events, newest first */
router.get(
  '/',
  validate([
    query('loadId').optional().isString().isLength({ min: 1, max: 200 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const loadId = req.query.loadId ? String(req.query.loadId) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const events = await BetaTrustEventService.list({ loadId, limit });
    res.json({ events, count: events.length });
  })
);

export default router;
