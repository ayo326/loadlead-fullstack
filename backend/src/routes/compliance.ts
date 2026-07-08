/**
 * Compliance document routes - /api/compliance
 *
 * Hauler-facing endpoints for the carrier compliance documents. Phase 3 covers
 * the W-9: an in-app preview of the filled official form, submit (validate +
 * store + sign), the current W-9 (masked), and the owner's own access-logged
 * full-document view. COI and Letter of Authority endpoints are added in later
 * phases on this same router; the shipper-facing gated packet view lives behind
 * the relationship resolver (Phase 6).
 */
import express from 'express';
import { authenticate, requireOwnerOperator, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { OwnerOperatorService } from '../services/ownerOperatorService';
import { ComplianceDocumentService } from '../services/complianceDocumentService';
import {
  submitW9,
  previewW9,
  openFullW9,
  toPublicW9,
  SubmitW9Input,
} from '../services/compliance/w9Service';
import { NotificationService } from '../services/notificationService';

const router = express.Router();
router.use(authenticate);
router.use(requireOwnerOperator);

/** Resolve the acting owner-operator entity (the hauler) for the current user. */
async function haulerFor(req: AuthRequest): Promise<{ operatorId: string; userId: string }> {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Owner Operator profile not found', 404);
  return { operatorId: profile.operatorId, userId: profile.userId };
}

/** Build a W9 form input bound to the acting hauler. */
function w9InputFrom(body: any, operatorId: string): SubmitW9Input {
  return {
    ownerType: 'HAULER',
    ownerId: operatorId,
    line1Name: body.line1Name,
    line2BusinessName: body.line2BusinessName,
    classification: body.classification,
    llcCode: body.llcCode,
    otherText: body.otherText,
    foreignPartners3b: body.foreignPartners3b,
    exemptPayeeCode: body.exemptPayeeCode,
    fatcaCode: body.fatcaCode,
    address: body.address,
    cityStateZip: body.cityStateZip,
    accountNumbers: body.accountNumbers,
    requesterNameAddress: body.requesterNameAddress,
    tinType: body.tinType,
    tin: body.tin,
    tinAppliedFor: body.tinAppliedFor,
    backupWithholdingNotified: body.backupWithholdingNotified,
    isUsPerson: body.isUsPerson,
    singleMemberDisregarded: body.singleMemberDisregarded,
    line1IsDisregardedEntityName: body.line1IsDisregardedEntityName,
    signatureName: body.signatureName,
    signedDateISO: body.signedDateISO,
    consentGiven: body.consentGiven,
  };
}

/**
 * Preview the filled official W-9 before signing. Returns the genuine template
 * filled + signed + flattened, so what the hauler previews is what gets stored
 * (identical bytes, identical hash). No storage, no TIN persistence.
 */
router.post(
  '/w9/preview',
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const input = w9InputFrom(req.body, operatorId);
    const rendered = await previewW9(input);
    res.json({
      contentHash: rendered.contentHash,
      pdfBase64: Buffer.from(rendered.bytes).toString('base64'),
    });
  }),
);

/** Submit the in-app W-9: validate, render, encrypt the TIN, store, sign. */
router.post(
  '/w9',
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const input = w9InputFrom(req.body, operatorId);
    const result = await submitW9(input, {
      actorAccountId: req.user!.userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    if (result.status === 'REQUIRES_W8') {
      // A W-9 does not apply to a non-US person; flag for admin follow-up.
      await NotificationService.record({
        userId: req.user!.userId,
        kind: 'VERIFICATION_UPDATE',
        title: 'W-9 not applicable',
        body: 'You indicated you are not a U.S. person. A Form W-8 applies instead; our team will follow up.',
      }).catch(() => undefined);
      return res.status(422).json({ requiresW8: true, errors: result.errors });
    }
    if (result.status === 'INVALID') {
      return res.status(400).json({ errors: result.errors });
    }
    res.status(201).json({ document: result.document, contentHash: result.contentHash });
  }),
);

/** The hauler's current W-9 (masked; TIN last 4 only). */
router.get(
  '/w9/current',
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const doc = await ComplianceDocumentService.getCurrent('HAULER', operatorId, 'W9');
    res.json({ w9: doc ? toPublicW9(doc) : null });
  }),
);

/**
 * The owner's own full-document view: writes the access log with a SELF basis
 * and returns a short-lived signed URL to the genuine stored PDF.
 */
router.get(
  '/w9/:documentId/document',
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const doc = await ComplianceDocumentService.getById(req.params.documentId);
    if (!doc || doc.ownerId !== operatorId) throw new AppError('W9 not found', 404);
    const { url, document } = await openFullW9(req.params.documentId, req.user!.userId, 'SELF');
    res.json({ url, document });
  }),
);

export default router;
