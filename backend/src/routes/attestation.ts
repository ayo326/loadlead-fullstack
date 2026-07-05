// Attestation routes - neutral, action-driven, role-agnostic.
//
// One sign endpoint handles all five actions. Fine-grained authZ is
// delegated to assertSignerIsLoadParty so each action's "who can sign"
// rule is in exactly one place. requireDriver / requireShipper / etc.
// are NOT used here - they're coarse role checks that would either
// duplicate the resolver's logic or exclude legitimate signers (e.g. a
// carrier_admin signing CARRIER_ACCEPT can't be inside /api/driver/*).
//
// Photo flow under the same router:
//   POST /api/attestation/photos/upload-url  - stage-aware presign (PENDING row)
//   POST /api/attestation/photos/:photoId/finalize - server hashes + READY
//
// All routes require `authenticate`. The internal admin console (ADMIN /
// MANAGER / SUPERVISOR / TEAM_LEAD platform roles) is excluded by the
// resolver - there is no codepath that maps them to a load party.

import express from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { LoadService } from '../services/loadService';
import { resolveCarrierOfRecord } from '../services/carrierOfRecord';
import { DriverService } from '../services/driverService';
import { ShipperService } from '../services/shipperService';
import { assertSignerIsLoadParty, assertChainReadAccess } from '../services/attestation/assertSignerIsLoadParty';
import { recordSignature, getChain } from '../services/attestation/signatureService';
import {
  requestUploadUrl,
  finalizeUpload,
  listReadyPhotos,
} from '../services/attestation/podPhotoService';
import type {
  AttestationAction,
  ProofPhotoStage,
  SignatureType,
  ExceptionsRecord,
} from '../types/signatures';

const router = express.Router();
router.use(authenticate);

/* ─────────────────────────────────────────────────────────────
 * POST /api/attestation/photos/upload-url
 *   body: { loadId, stage: ORIGIN|PICKUP|DELIVERY|RECEIPT, contentType?, lat?, lng?, capturedAt? }
 * Returns: { photoId, s3Key, uploadUrl, expiresIn }
 * Side effect: creates a PENDING row in LoadLead_PodPhotos.
 * ───────────────────────────────────────────────────────────── */
router.post('/photos/upload-url', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId, stage, contentType, lat, lng, capturedAt } = req.body ?? {};
  if (!loadId || !stage) throw new AppError('loadId + stage required', 400);
  const STAGES: ProofPhotoStage[] = ['ORIGIN', 'PICKUP', 'DELIVERY', 'RECEIPT'];
  if (!STAGES.includes(stage)) throw new AppError(`stage must be one of ${STAGES.join('|')}`, 400);

  const r = await requestUploadUrl({
    loadId,
    stage,
    uploadedByUserId: req.user!.userId,
    contentType,
    lat, lng, capturedAt,
  });
  res.status(201).json(r);
}));

/* ─────────────────────────────────────────────────────────────
 * POST /api/attestation/photos/:photoId/finalize
 * Server reads bytes from S3, sha256s, sets contentHash, READY.
 * Only the original uploader may finalize.
 * ───────────────────────────────────────────────────────────── */
router.post('/photos/:photoId/finalize', asyncHandler(async (req: AuthRequest, res) => {
  const { photoId } = req.params;
  const photo = await finalizeUpload(photoId, req.user!.userId);
  res.json({ photoId: photo.photoId, contentHash: photo.contentHash, status: photo.status });
}));

/* ─────────────────────────────────────────────────────────────
 * POST /api/attestation/sign
 *   body: { loadId, action, signatureType, signatureData, consentGiven,
 *           photoIds?, exceptions?, actualAt?, geo?, assignedDriverId? }
 * Records a Signature for the action after assertSignerIsLoadParty
 * approves. PENDING photos cause CANONICALIZE_PHOTO_NOT_FINALIZED.
 * ───────────────────────────────────────────────────────────── */
router.post('/sign', asyncHandler(async (req: AuthRequest, res) => {
  const body = req.body ?? {};
  const action = body.action as AttestationAction;
  const loadId = body.loadId as string;
  if (!loadId || !action) throw new AppError('loadId + action required', 400);
  if (body.consentGiven !== true) {
    throw new AppError(JSON.stringify({ error: 'CONSENT_REQUIRED', code: 'CONSENT_REQUIRED' }), 400);
  }
  if (!body.signatureType || !body.signatureData) {
    throw new AppError('signatureType + signatureData required', 400);
  }

  const load = await LoadService.getLoadById(loadId);
  if (!load) throw new AppError(`Load ${loadId} not found`, 404);

  // Resolver-based authZ. Wrong party => 403 WRONG_SIGNER.
  const resolution = await assertSignerIsLoadParty(
    load,
    action,
    req.user!.userId,
    { assignedDriverId: body.assignedDriverId },
  );

  // Load READY photos for the stage the action implies.
  const stageForAction: Record<AttestationAction, ProofPhotoStage | null> = {
    BOL_SUBMIT:       'ORIGIN',
    CARRIER_ACCEPT:   null,
    DRIVER_PICKUP:    'PICKUP',
    DRIVER_DELIVER:   'DELIVERY',
    RECEIVER_CONFIRM: 'RECEIPT',
  };
  const stage = stageForAction[action];
  let photos: Awaited<ReturnType<typeof listReadyPhotos>> = [];
  if (stage && body.photoIds?.length) {
    const all = await listReadyPhotos(loadId, stage);
    photos = all.filter((p) => body.photoIds.includes(p.photoId));
    if (photos.length !== body.photoIds.length) {
      throw new AppError(
        JSON.stringify({
          error: 'PHOTOS_NOT_READY: one or more photoIds are not finalized for this stage',
          code:  'PHOTOS_NOT_READY',
        }),
        409,
      );
    }
  }

  // Photo requirement gate per action:
  //   DRIVER_PICKUP / DRIVER_DELIVER / RECEIVER_CONFIRM require >=1 photo
  //   BOL_SUBMIT origin photo is OPTIONAL
  //   CARRIER_ACCEPT has no photo requirement
  const PHOTOS_REQUIRED: Partial<Record<AttestationAction, true>> = {
    DRIVER_PICKUP:    true,
    DRIVER_DELIVER:   true,
    RECEIVER_CONFIRM: true,
  };
  if (PHOTOS_REQUIRED[action] && photos.length === 0) {
    throw new AppError(
      JSON.stringify({
        error: `${action} requires at least one ${stage} photo`,
        code:  `${action}_PHOTOS_REQUIRED`,
      }),
      412,
    );
  }

  // For projection: gather extra context per action.
  let shipperOrgId: string | undefined;
  let shipperUserId: string | undefined;
  if (action === 'BOL_SUBMIT') {
    const shipper = load.shipperId ? await ShipperService.getProfileById(load.shipperId) : null;
    shipperOrgId  = shipper?.orgId ?? undefined;
    shipperUserId = shipper?.userId;
  }

  let carrierOfRecord: { entityType: string; entityId: string } | null = null;
  let assignedDriverId: string | null = null;
  // For a negotiated accept the caller binds the agreed rate (cents), converted
  // to the load's units (dollars). Omitted → the projection uses the posted rate.
  let rateAmount: number | null = null;
  let rateType: string | null = null;
  if (action === 'CARRIER_ACCEPT') {
    const did = body.assignedDriverId as string;
    if (!did) throw new AppError('assignedDriverId required for CARRIER_ACCEPT', 400);
    const driver = await DriverService.getProfileById(did);
    if (!driver) throw new AppError(`Driver ${did} not found`, 404);
    const cor = await resolveCarrierOfRecord(driver);
    if (!cor) throw new AppError('Driver unaffiliated; cannot bind acceptance', 403);
    carrierOfRecord = { entityType: cor.entityType, entityId: cor.entityId };
    assignedDriverId = did;
    if (typeof body.ratePerMileCents === 'number') {
      rateAmount = body.ratePerMileCents / 100;
      rateType = 'PER_MILE';
    } else if (typeof body.totalCents === 'number') {
      rateAmount = body.totalCents / 100;
      rateType = 'FLAT_RATE';
    }
  }

  const exceptions: ExceptionsRecord | undefined = body.exceptions ? {
    code:        body.exceptions.code,
    description: String(body.exceptions.description ?? ''),
  } : undefined;

  const sig = await recordSignature({
    load,
    action,
    signerUserId:  req.user!.userId,
    signerRole:    resolution.signerRole,
    signatureType: body.signatureType as SignatureType,
    signatureData: body.signatureData,
    consentGiven:  true,
    ipAddress:     req.ip,
    userAgent:     req.get('user-agent') ?? undefined,
    shipperOrgId,
    shipperUserId,
    carrierOfRecord,
    assignedDriverId,
    rateAmount,
    rateType,
    photos,
    exceptions,
    actualAt:      body.actualAt,
    geo:           body.geo,
  });

  res.status(201).json({
    signatureId:            sig.signatureId,
    documentHash:           sig.documentHash,
    signedAt:               sig.signedAt,
    canonicalSchemaVersion: sig.canonicalSchemaVersion,
    attestationVersion:     sig.attestationVersion,
  });
}));

/* ─────────────────────────────────────────────────────────────
 * GET /api/attestation/chain/:loadId
 *
 * Read-access scoped per spec: "visible to the load's parties and
 * read-only to platform admin." Enforced by assertChainReadAccess
 * which unions the per-action signer sets and admits ADMIN-role
 * users separately. A user who is NOT a party AND not platform staff
 * gets 403 WRONG_READER.
 *
 * Returns a summary (no raw signatureData blobs) - fetch a single sig
 * if you need full evidence (Phase-2 endpoint, not built yet).
 * ───────────────────────────────────────────────────────────── */
router.get('/chain/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const load = await LoadService.getLoadById(req.params.loadId);
  if (!load) throw new AppError(`Load ${req.params.loadId} not found`, 404);
  await assertChainReadAccess(load, req.user!.userId, req.user!.role);
  const chain = await getChain(req.params.loadId);
  // Strip large signatureData blobs from list reads - they're per-row
  // legal evidence, not list-view data. Fetch the single sig if needed.
  const summary = chain.map((s) => ({
    signatureId:            s.signatureId,
    action:                 s.action,
    signerUserId:           s.signerUserId,
    signerRole:             s.signerRole,
    signedAt:               s.signedAt,
    documentHash:           s.documentHash,
    proofPhotoIds:          s.proofPhotoIds,
    attestationVersion:     s.attestationVersion,
    canonicalSchemaVersion: s.canonicalSchemaVersion,
    exceptions:             s.exceptions,
  }));
  res.json({ loadId: req.params.loadId, chain: summary });
}));

export default router;
