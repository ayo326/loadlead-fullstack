/**
 * Canopy Connect routes - /api/compliance/canopy
 *
 * Hauler-facing: start a connect session (returns the browser-safe config plus a
 * signed nonce + carrier id to attach as pull metadata), and a callback the SDK
 * or Components flow posts on completion to trigger ingestion (a poll trigger
 * alongside the webhook). Also a status endpoint for the connect UI.
 *
 * Admin-facing: resolve a CRITICAL COI cross-reference, and read the shadow-mode
 * evaluator divergence report.
 *
 * Secrets never reach the browser: the connect session returns only the public
 * alias, the ui mode, and the env. The client id/secret/webhook secret stay on
 * the server.
 */
import express from 'express';
import { authenticate, requireOwnerOperator, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { OwnerOperatorService } from '../services/ownerOperatorService';
import canopyConfig, { canopyPublicConfig } from '../config/canopyConfig';
import { issueNonce } from '../services/canopy/canopyNonce';
import { ingestPull } from '../services/canopy/canopyIngestionService';
import { insuranceBadge } from '../services/canopy/insuranceBadge';
import { CanopyConnectionStore } from '../services/canopy/canopyConnectionStore';
import { enableMonitoringForConnection } from '../services/canopy/canopyMonitoringService';
import { resolveCrossReferenceCritical } from '../services/canopy/crossReferenceEngine';
import { divergenceReport } from '../services/canopy/complianceEvaluator';
import { CoiCrossReferenceStore } from '../services/canopy/coiCrossReferenceStore';

const router = express.Router();

router.use(authenticate);

async function haulerFor(req: AuthRequest): Promise<{ operatorId: string; userId: string }> {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Owner-operator profile not found', 404);
  return { operatorId: profile.operatorId, userId: profile.userId };
}

/**
 * Start a connect session. Returns the browser-safe config plus the carrier id,
 * a signed idempotency nonce, and the source, all of which the frontend attaches
 * as pull metadata. Manual path always exists regardless of connectEnabled.
 */
router.get(
  '/connect-session',
  requireOwnerOperator,
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const pub = canopyPublicConfig();
    const source = canopyConfig.uiMode; // widget | components (identical artifacts)
    res.json({
      ...pub,
      carrierId: operatorId,
      nonce: pub.connectEnabled ? issueNonce(operatorId) : null,
      source,
    });
  }),
);

/**
 * The SDK/Components completion callback. The frontend posts the pull id; we
 * ingest (idempotent) and return the outcome. The ingested pull's carrier must
 * match the authenticated hauler.
 */
router.post(
  '/callback',
  requireOwnerOperator,
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const pullId = String(req.body?.pullId || '').trim();
    if (!pullId) throw new AppError('pullId is required', 400);
    const source = canopyConfig.uiMode;

    const result = await ingestPull({ pullId, source });
    if (result.carrierId && result.carrierId !== operatorId) {
      throw new AppError('pull does not belong to this carrier', 403);
    }

    // On a successful connection, enable monitoring (best-effort).
    if (result.outcome !== 'NEEDS_FALLBACK' && result.connectionId) {
      await enableMonitoringForConnection(result.connectionId).catch(() => undefined);
    }
    res.json(result);
  }),
);

/** The connect state for the onboarding UI: badge + connection + latest cross-ref. */
router.get(
  '/status',
  requireOwnerOperator,
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const [badge, connection, latestCrossReference] = await Promise.all([
      insuranceBadge(operatorId),
      CanopyConnectionStore.currentForCarrier(operatorId),
      CoiCrossReferenceStore.latestForCarrier(operatorId),
    ]);
    res.json({ badge, connection, latestCrossReference });
  }),
);

// ── Admin ─────────────────────────────────────────────────────────────────────

/** Resolve a CRITICAL cross-reference: accept the insurer data, or reject. */
router.post(
  '/admin/cross-reference/resolve',
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const carrierId = String(req.body?.carrierId || '').trim();
    const action = req.body?.action as 'ACCEPT_INSURER' | 'REJECT';
    if (!carrierId) throw new AppError('carrierId is required', 400);
    if (action !== 'ACCEPT_INSURER' && action !== 'REJECT') {
      throw new AppError('action must be ACCEPT_INSURER or REJECT', 400);
    }
    await resolveCrossReferenceCritical(carrierId, req.user!.userId, action, req.body?.reason);
    res.json({ ok: true });
  }),
);

/** The shadow-mode evaluator divergence report. */
router.get(
  '/admin/divergence-report',
  requireAdmin,
  asyncHandler(async (_req: AuthRequest, res) => {
    res.json({ divergences: await divergenceReport() });
  }),
);

export default router;
