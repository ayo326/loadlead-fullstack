// Factoring routes — /api/factoring
// All routes require authentication. Carrier identity is resolved from the
// authenticated user's OO or org profile.

import express from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { OwnerOperatorService } from '../services/ownerOperatorService';
import {
  getFactoringProfile,
  registerByoFactor,
  verifyByoFactor,
  confirmByoRemittance,
  byoReady,
  selectIntegratedPartner,
  releaseCurrentFactor,
} from '../services/factoringProfile';
import { optInToFactoring, resolveInvoicePayee } from '../services/factoring';
import { assertPodComplete } from '../services/pod';

const router = express.Router();
router.use(authenticate);

// Resolve the carrierId for the authenticated user (OO only for now;
// extend to org CARRIER roles when org factoring is needed).
async function resolveCarrierId(req: AuthRequest): Promise<string> {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Owner operator profile not found', 404);
  return profile.operatorId;
}

// ── Profile (account-level mode) ─────────────────────────────────────────────

// GET /api/factoring/profile
router.get('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const profile   = await getFactoringProfile(carrierId);
  res.json({ profile: profile ?? { carrierId, mode: 'NONE' } });
}));

// POST /api/factoring/byo — register a BYO factor
router.post('/byo', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const { factorName, noaKey, remittanceRef } = req.body;
  if (!factorName || !noaKey || !remittanceRef) {
    throw new AppError('factorName, noaKey, and remittanceRef are required', 400);
  }
  const profile = await registerByoFactor(carrierId, { factorName, noaKey, remittanceRef });
  res.status(201).json({ profile });
}));

// POST /api/factoring/byo/verify — trigger KYB on the BYO factor (Didit)
router.post('/byo/verify', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  await verifyByoFactor(carrierId);
  res.json({ ok: true });
}));

// POST /api/factoring/byo/confirm-remittance — ops confirms remittance out-of-band
router.post('/byo/confirm-remittance', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  await confirmByoRemittance(carrierId);
  res.json({ ok: true });
}));

// GET /api/factoring/byo/ready — is BYO assignment fully operational?
router.get('/byo/ready', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const ready     = await byoReady(carrierId);
  res.json({ ready });
}));

// POST /api/factoring/partner — select an integrated partner
router.post('/partner', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const { partnerId } = req.body;
  if (!partnerId) throw new AppError('partnerId is required', 400);
  const profile = await selectIntegratedPartner(carrierId, partnerId);
  res.status(201).json({ profile });
}));

// POST /api/factoring/release — release current assignment (required before switching)
router.post('/release', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const { letterOfReleaseKey } = req.body;
  if (!letterOfReleaseKey) throw new AppError('letterOfReleaseKey is required', 400);
  const profile = await releaseCurrentFactor(carrierId, letterOfReleaseKey);
  res.json({ profile });
}));

// ── Per-load integrated opt-in ────────────────────────────────────────────────

// POST /api/factoring/loads/:loadId/opt-in — opt a delivered load into integrated factoring
router.post('/loads/:loadId/opt-in', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const optIn     = await optInToFactoring(req.params.loadId, carrierId);
  res.status(201).json({ optIn });
}));

// GET /api/factoring/loads/:loadId/payee — who receives the invoice payment?
router.get('/loads/:loadId/payee', asyncHandler(async (req: AuthRequest, res) => {
  const result = await resolveInvoicePayee(req.params.loadId);
  res.json(result);
}));

// GET /api/factoring/loads/:loadId/pod — check POD completeness for a load
router.get('/loads/:loadId/pod', asyncHandler(async (req: AuthRequest, res) => {
  const result = await assertPodComplete(req.params.loadId);
  res.json(result);
}));

export default router;
