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
import rateLimit from 'express-rate-limit';
import { authenticate, requireOwnerOperator, requireShipper, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { UserRole } from '../types';
import { LoadService } from '../services/loadService';
import { DriverService } from '../services/driverService';
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
import { renderW9 } from '../services/compliance/w9FillService';
import { submitCoi, decideCoi, coiDocumentUrl } from '../services/compliance/coiService';
import {
  submitLetterOfAuthority,
  decideLetterOfAuthority,
  letterOfAuthorityUrl,
} from '../services/compliance/letterOfAuthorityService';
import { complianceBadges, assemblePacket } from '../services/compliance/compliancePacketService';
import { resolveShipperHaulerRelationship } from '../services/compliance/relationshipResolver';
import {
  upsertPolicy,
  getCurrentPolicy,
  getAttachment,
  signAttachedPolicy,
  policyDocumentUrl,
} from '../services/compliance/shipperPolicyService';
import { NotificationService } from '../services/notificationService';
import { notifyVerificationOutcome } from '../services/compliance/complianceNotifications';

const router = express.Router();

// Deploy self-check (no auth, no DB, no KMS, no PII): render the official W-9
// template with canned synthetic input, exercising exactly the template
// load + AcroForm fill + flatten path. If the template is missing from the
// deploy artifact (the SCRUM-59 packaging bug), this 500s and the post-deploy
// smoke fails BEFORE a real hauler ever hits it - a route-mount 401 check does
// not exercise this. Returns only a hash + byte length, never the PDF. MUST be
// registered before router.use(authenticate) so it stays public.
//
// Rate-limited (audit v4 H4): the render is CPU-bound (pdf-lib fill+flatten)
// and the route is public, so an unthrottled loop could pin the single-
// instance backend. 10/min/IP is far above the deploy smoke's 1-2 calls while
// making a render-loop DoS uneconomical. Trust-proxy is set in index.ts, so
// the per-IP key is the real client IP behind CloudFront.
const renderCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many render-check requests. Try again shortly.', statusCode: 429 },
});
router.get(
  '/w9/render-check',
  renderCheckLimiter,
  asyncHandler(async (_req, res) => {
    const rendered = await renderW9({
      line1Name: 'RENDER SMOKE',
      classification: 'INDIVIDUAL_SOLE_PROPRIETOR',
      address: '1 Test St',
      cityStateZip: 'Testville, TX 75001',
      tinType: 'SSN',
      tin: '000000000',
      signatureName: 'RENDER SMOKE',
      signedDateISO: '2000-01-01',
    });
    res.json({ ok: true, contentHash: rendered.contentHash, byteLength: rendered.bytes.length });
  }),
);

// Per-route guards (this router serves hauler, shipper, and admin surfaces),
// so authentication is applied at the router and role is enforced per route.
router.use(authenticate);

/** Resolve the acting owner-operator entity (the hauler) for the current user. */
async function haulerFor(req: AuthRequest): Promise<{ operatorId: string; userId: string }> {
  const profile = await OwnerOperatorService.getByUserId(req.user!.userId);
  if (!profile) throw new AppError('Owner Operator profile not found', 404);
  return { operatorId: profile.operatorId, userId: profile.userId };
}

// ── M5 (audit v6): server-side upload validation ──────────────────────────────
// The COI/LOA byte content arrives base64 with a CLIENT-supplied content-type. Pin it
// to an allowlist (server-authoritative) and verify the leading magic bytes match, so
// an arbitrary content-type/payload can't be stored and later served.
const ALLOWED_UPLOAD_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function pinContentType(clientValue: unknown, fallback = 'application/pdf'): string {
  const ct = typeof clientValue === 'string' ? clientValue.toLowerCase().split(';')[0].trim() : '';
  if (ct && !ALLOWED_UPLOAD_MIME.has(ct)) {
    throw new AppError('Unsupported file type; allowed types are PDF, JPEG, PNG', 415);
  }
  return ct || fallback;
}

function assertMagicMatches(bytes: Buffer, contentType: string): void {
  const hex4 = bytes.subarray(0, 4).toString('hex').toUpperCase();
  const ok =
    (contentType === 'application/pdf' && bytes.subarray(0, 5).toString('latin1') === '%PDF-') ||
    (contentType === 'image/jpeg' && hex4.startsWith('FFD8')) ||
    (contentType === 'image/png' && hex4 === '89504E47');
  if (!ok) throw new AppError('File content does not match its declared type', 400);
}

// ── M3 (audit v6): shipper-policy-on-load party checks ────────────────────────
// The attached policy + its signed URL are party data, and a signature is a legal
// attestation. Restrict reads to the load's parties and signing to the assigned hauler.
async function callerIsAssignedHauler(req: AuthRequest, loadId: string): Promise<boolean> {
  const load = await LoadService.getLoadById(loadId);
  if (!load?.assignedDriverId) return false;
  const driver = await DriverService.getProfileById(load.assignedDriverId);
  if (!driver) return false;
  if (driver.userId === req.user!.userId) return true; // the OO's own self-driver
  const oo = await OwnerOperatorService.getByUserId(req.user!.userId).catch(() => null);
  return !!oo && driver.ownedByOperatorId === oo.operatorId; // a driver in the caller's fleet
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
    const contentType = pinContentType(req.body.contentType);
    assertMagicMatches(bytes, contentType);
    const doc = await submitCoi(
      {
        ownerType: 'HAULER',
        ownerId: operatorId,
        fileBytes: bytes,
        originalFilename: req.body.originalFilename ?? 'coi.pdf',
        contentType,
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
    const contentType = pinContentType(req.body.contentType);
    assertMagicMatches(bytes, contentType);
    const doc = await submitLetterOfAuthority(
      {
        ownerType: 'HAULER',
        ownerId: operatorId,
        fileBytes: bytes,
        originalFilename: req.body.originalFilename ?? 'loa.pdf',
        contentType,
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
      // `code` is the stable machine-readable field the FE branches on
      // (audit v4 L6); `error` retained for back-compat with older clients.
      return res.status(403).json({
        code: 'RELATIONSHIP_REQUIRED',
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
      return res.status(403).json({ code: 'RELATIONSHIP_REQUIRED', error: 'RELATIONSHIP_REQUIRED' });
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

// ── Shipper policy (Phase 7): authoring, load attachment, hauler signature ─────

/** Shipper authors/edits their policy (upload FILE base64 or typed TEXT). Edit = new version. */
router.post(
  '/shipper/policy',
  requireShipper,
  asyncHandler(async (req: AuthRequest, res) => {
    const sourceType = req.body.sourceType === 'FILE' ? 'FILE' : 'TEXT';
    const fileBytes =
      sourceType === 'FILE' && req.body.fileBase64 ? Buffer.from(String(req.body.fileBase64), 'base64') : undefined;
    const version = await upsertPolicy({
      shipperId: req.user!.userId,
      sourceType,
      richText: req.body.richText,
      fileBytes,
      createdBy: req.user!.userId,
    });
    res.status(201).json({ policyVersionId: version.policyVersionId, version: version.version });
  }),
);

/** The shipper's current policy version. */
router.get(
  '/shipper/policy/current',
  requireShipper,
  asyncHandler(async (req: AuthRequest, res) => {
    const p = await getCurrentPolicy(req.user!.userId);
    res.json({ policy: p ? { policyVersionId: p.policyVersionId, version: p.version, sourceType: p.sourceType } : null });
  }),
);

/** The policy attached to a load (both parties), with a signed URL to view/print. */
router.get(
  '/policy/load/:loadId',
  asyncHandler(async (req: AuthRequest, res) => {
    const att = await getAttachment(req.params.loadId);
    if (!att) return res.json({ attachment: null });
    // M3: only the load's parties (its shipper or assigned hauler) may read the
    // attached policy + its signed document URL.
    const isParty =
      req.user!.role === UserRole.ADMIN ||
      req.user!.userId === att.shipperId ||
      (await callerIsAssignedHauler(req, req.params.loadId));
    if (!isParty) throw new AppError('Not authorized for this load policy', 403);
    const url = await policyDocumentUrl(att.policyVersionId);
    res.json({ attachment: att, url });
  }),
);

/** The hauler signs the attached policy (post-acceptance prompt by default). */
router.post(
  '/policy/load/:loadId/sign',
  requireOwnerOperator,
  asyncHandler(async (req: AuthRequest, res) => {
    // M3: a policy signature is a legal attestation - only the load's assigned hauler
    // may sign, not any owner-operator.
    if (req.user!.role !== UserRole.ADMIN && !(await callerIsAssignedHauler(req, req.params.loadId))) {
      throw new AppError("Only the load's assigned hauler may sign this policy", 403);
    }
    const signed = await signAttachedPolicy({
      loadId: req.params.loadId,
      signerUserId: req.user!.userId,
      signatureName: req.body.signatureName,
      consentGiven: req.body.consentGiven === true,
    });
    res.json({ attachment: signed });
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
    } else if (doc.documentType === 'LETTER_OF_AUTHORITY') {
      await decideLetterOfAuthority(doc.documentId, req.user!.userId, decision, req.body.reason);
    } else {
      // INSURER_POLICY (Canopy) is auto-decided by the verification pipeline and,
      // for a CRITICAL cross-reference, resolved through the cross-reference
      // admin path - not this generic doc-decide route.
      throw new AppError(`documents of type ${doc.documentType} are not decided here`, 400);
    }
    await notifyVerificationOutcome(doc.documentId);
    res.json({ ok: true });
  }),
);

export default router;
