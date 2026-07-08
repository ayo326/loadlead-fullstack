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
import { authenticate, requireOwnerOperator, requireShipper, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { OwnerOperatorService } from '../services/ownerOperatorService';
import { ComplianceDocumentService } from '../services/complianceDocumentService';
import {
  submitW9,
  previewW9,
  openFullW9,
  markW9Verified,
  toPublicW9,
  SubmitW9Input,
} from '../services/compliance/w9Service';
import { submitCoi, decideCoi, coiDocumentUrl } from '../services/compliance/coiService';
import {
  submitLetterOfAuthority,
  decideLetterOfAuthority,
  letterOfAuthorityUrl,
} from '../services/compliance/letterOfAuthorityService';
import { complianceBadges, assemblePacket } from '../services/compliance/compliancePacketService';
import { resolveShipperHaulerRelationship } from '../services/compliance/relationshipResolver';
import { NotificationService } from '../services/notificationService';

const router = express.Router();
// Per-route guards (this router serves hauler, shipper, and admin surfaces),
// so authentication is applied at the router and role is enforced per route.
router.use(authenticate);

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
  requireOwnerOperator,
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
  requireOwnerOperator,
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
  requireOwnerOperator,
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
  requireOwnerOperator,
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const doc = await ComplianceDocumentService.getById(req.params.documentId);
    if (!doc || doc.ownerId !== operatorId) throw new AppError('W9 not found', 404);
    const { url, document } = await openFullW9(req.params.documentId, req.user!.userId, 'SELF');
    res.json({ url, document });
  }),
);

// ── COI (Certificate of Insurance), hauler-facing ─────────────────────────────

/** Upload a COI (file as base64) plus the structured fields. */
router.post(
  '/coi',
  requireOwnerOperator,
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const bytes = Buffer.from(String(req.body.fileBase64 ?? ''), 'base64');
    if (bytes.length === 0) throw new AppError('fileBase64 is required', 400);
    const doc = await submitCoi(
      {
        ownerType: 'HAULER',
        ownerId: operatorId,
        fileBytes: bytes,
        originalFilename: req.body.originalFilename ?? 'coi.pdf',
        contentType: req.body.contentType ?? 'application/pdf',
        fields: req.body.fields,
      },
      req.user!.userId,
    );
    res.status(201).json({ documentId: doc.documentId, status: doc.verificationStatus, expiresAt: doc.expiresAt });
  }),
);

// ── Letter of Authority, hauler-facing ────────────────────────────────────────

router.post(
  '/loa',
  requireOwnerOperator,
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    const bytes = Buffer.from(String(req.body.fileBase64 ?? ''), 'base64');
    if (bytes.length === 0) throw new AppError('fileBase64 is required', 400);
    const doc = await submitLetterOfAuthority(
      {
        ownerType: 'HAULER',
        ownerId: operatorId,
        fileBytes: bytes,
        originalFilename: req.body.originalFilename ?? 'loa.pdf',
        contentType: req.body.contentType ?? 'application/pdf',
        mcNumber: req.body.mcNumber,
        dotNumber: req.body.dotNumber,
      },
      req.user!.userId,
    );
    res.status(201).json({ documentId: doc.documentId, status: doc.verificationStatus });
  }),
);

/** The hauler's own compliance badges (all three documents). */
router.get(
  '/status',
  requireOwnerOperator,
  asyncHandler(async (req: AuthRequest, res) => {
    const { operatorId } = await haulerFor(req);
    res.json({ badges: await complianceBadges(operatorId) });
  }),
);

// ── Shipper-facing: public badges, gated packet + documents ───────────────────

/** Public badges for a hauler: presence, verification state, expiry. */
router.get(
  '/haulers/:operatorId/badges',
  requireShipper,
  asyncHandler(async (req: AuthRequest, res) => {
    res.json({ badges: await complianceBadges(req.params.operatorId) });
  }),
);

/** The full packet, only when the relationship resolver allows it. */
router.get(
  '/haulers/:operatorId/packet',
  requireShipper,
  asyncHandler(async (req: AuthRequest, res) => {
    const rel = await resolveShipperHaulerRelationship(req.user!.userId, req.params.operatorId);
    if (!rel.allowed) {
      return res.status(403).json({
        error: 'RELATIONSHIP_REQUIRED',
        message:
          'The full compliance packet opens once you have an active negotiation, an assigned load, or a recently completed load with this carrier.',
      });
    }
    const packet = await assemblePacket(req.params.operatorId);
    res.json({ packet, basis: rel.basis });
  }),
);

/**
 * Shipper opens a hauler's full document (W9/COI/LOA), gated by the resolver.
 * The W9 open writes the access log with the relationship basis.
 */
router.get(
  '/haulers/:operatorId/:docType/document',
  requireShipper,
  asyncHandler(async (req: AuthRequest, res) => {
    const rel = await resolveShipperHaulerRelationship(req.user!.userId, req.params.operatorId);
    if (!rel.allowed) {
      return res.status(403).json({ error: 'RELATIONSHIP_REQUIRED' });
    }
    const type = String(req.params.docType).toUpperCase();
    if (type === 'W9') {
      const doc = await ComplianceDocumentService.getCurrent('HAULER', req.params.operatorId, 'W9');
      if (!doc) throw new AppError('W9 not found', 404);
      const { url, document } = await openFullW9(doc.documentId, req.user!.userId, rel.basis ?? 'RELATIONSHIP');
      return res.json({ url, document });
    }
    if (type === 'COI') {
      const doc = await ComplianceDocumentService.getCurrent('HAULER', req.params.operatorId, 'COI');
      if (!doc) throw new AppError('COI not found', 404);
      return res.json({ url: await coiDocumentUrl(doc.documentId) });
    }
    if (type === 'LOA') {
      const doc = await ComplianceDocumentService.getCurrent('HAULER', req.params.operatorId, 'LETTER_OF_AUTHORITY');
      if (!doc) throw new AppError('Letter of Authority not found', 404);
      return res.json({ url: await letterOfAuthorityUrl(doc.documentId) });
    }
    throw new AppError('Unknown document type', 400);
  }),
);

// ── Admin verification (beta manual review) ───────────────────────────────────

router.post(
  '/admin/:documentId/decide',
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const doc = await ComplianceDocumentService.getById(req.params.documentId);
    if (!doc) throw new AppError('Document not found', 404);
    const decision = req.body.decision as 'VERIFIED' | 'REJECTED';
    if (decision !== 'VERIFIED' && decision !== 'REJECTED') throw new AppError('decision must be VERIFIED or REJECTED', 400);

    if (doc.documentType === 'W9') {
      if (decision === 'REJECTED') {
        await ComplianceDocumentService.setVerificationStatus(doc.documentId, 'REJECTED', 'REJECTED', req.user!.userId, req.body.reason);
      } else {
        await markW9Verified(doc.documentId, req.user!.userId);
      }
    } else if (doc.documentType === 'COI') {
      await decideCoi(doc.documentId, req.user!.userId, decision, req.body.reason);
    } else {
      await decideLetterOfAuthority(doc.documentId, req.user!.userId, decision, req.body.reason);
    }
    res.json({ ok: true });
  }),
);

export default router;
