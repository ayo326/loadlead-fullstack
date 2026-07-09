/**
 * W9 intake orchestration.
 *
 * Ties the pieces together for the in-app W-9:
 *   validate (classification/name/TIN rules) -> render the official template
 *   filled and signed -> encrypt the TIN (KMS envelope) -> store the private PDF
 *   in S3 -> create the append-only compliance document row with the encrypted
 *   TIN + masked last 4 -> record the certification attestation event.
 *
 * The certification signature is captured as an append-only attestation that
 * mirrors the platform's e-sign pattern (verbatim statement text + version +
 * content hash + typed signature + explicit consent). The existing
 * signatureService chain is load-scoped (it requires a Load and load-party
 * projections); a W-9 is an entity-level artifact, so we record the same shape
 * on the compliance document rather than distort the load signature chain.
 *
 * The TIN is never returned in the clear and never stored in plaintext. All
 * callers get the masked last 4; the full document opens only through the gated,
 * access-logged view (relationship enforcement lives in the resolver, Phase 6).
 */

import { AppError } from '../../middleware/errorHandler';
import { Helpers } from '../../utils/helpers';
import { encryptField, tinLast4 } from '../../utils/fieldCrypto';
import {
  ComplianceDocument,
  ComplianceDocumentService,
  ComplianceOwnerType,
} from '../complianceDocumentService';
import { W9_CERTIFICATION_HASH, W9_FORM_REVISION } from './w9Certification';
import { renderW9, RenderedW9, W9FormInput } from './w9FillService';
import { validateW9, W9ValidationError } from './w9Validation';
import { putObject, signedGetUrl } from './complianceStorage';

export interface SubmitW9Input extends W9FormInput {
  ownerType: ComplianceOwnerType;
  ownerId: string;
  /** The certification includes "I am a U.S. citizen or other U.S. person." */
  isUsPerson: boolean;
  singleMemberDisregarded?: boolean;
  line1IsDisregardedEntityName?: boolean;
  /** Explicit e-sign consent; must be true to sign the certification. */
  consentGiven: boolean;
}

export interface SubmitContext {
  actorAccountId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface W9SubmitResult {
  status: 'CREATED' | 'REQUIRES_W8' | 'INVALID';
  document?: PublicW9;
  errors?: W9ValidationError[];
  requiresW8?: boolean;
  /** The rendered document hash; equals the pre-sign preview hash for the same input. */
  contentHash?: string;
}

/** A W9 as safe to return to any caller: TIN masked, ciphertext never included. */
export interface PublicW9 {
  documentId: string;
  ownerType: ComplianceOwnerType;
  ownerId: string;
  verificationStatus: ComplianceDocument['verificationStatus'];
  formRevision?: string;
  tinType?: 'SSN' | 'EIN';
  tinLast4?: string;
  tinAppliedFor?: boolean;
  expiresAt?: number;
  isCurrentVersion: boolean;
  uploadedAt: number;
}

export function toPublicW9(doc: ComplianceDocument): PublicW9 {
  return {
    documentId: doc.documentId,
    ownerType: doc.ownerType,
    ownerId: doc.ownerId,
    verificationStatus: doc.verificationStatus,
    formRevision: doc.formRevision,
    tinType: doc.tinType,
    tinLast4: doc.tinLast4,
    tinAppliedFor: doc.tinAppliedFor,
    expiresAt: doc.expiresAt,
    isCurrentVersion: doc.isCurrentVersion,
    uploadedAt: doc.uploadedAt,
  };
}

/** Render the filled+signed W-9 for a pre-sign preview (no storage). */
export async function previewW9(input: W9FormInput): Promise<RenderedW9> {
  return renderW9(input);
}

/**
 * Validate, render, encrypt, store, and record an in-app W-9. Deterministic
 * render means the stored bytes equal the pre-sign preview bytes for the same
 * input, so contentHash can be compared across preview and storage.
 */
export async function submitW9(input: SubmitW9Input, ctx: SubmitContext): Promise<W9SubmitResult> {
  if (input.consentGiven !== true) {
    throw new AppError('CONSENT_REQUIRED: certification consent must be explicitly granted', 400);
  }

  const validation = validateW9({
    line1Name: input.line1Name,
    line2BusinessName: input.line2BusinessName,
    classification: input.classification,
    llcCode: input.llcCode,
    otherText: input.otherText,
    tinType: input.tinType,
    tin: input.tin,
    tinAppliedFor: input.tinAppliedFor,
    address: input.address,
    cityStateZip: input.cityStateZip,
    isUsPerson: input.isUsPerson,
    singleMemberDisregarded: input.singleMemberDisregarded,
    line1IsDisregardedEntityName: input.line1IsDisregardedEntityName,
  });

  // Non-US person: a W-9 does not apply. Do not store; signal the W-8 path.
  if (validation.requiresW8) {
    return { status: 'REQUIRES_W8', requiresW8: true, errors: validation.errors };
  }
  if (!validation.ok) {
    return { status: 'INVALID', errors: validation.errors };
  }

  // Render the genuine official form, filled + signed + flattened.
  const rendered = await renderW9(input);

  // Encrypt the TIN at rest (skip when Applied For - there is no TIN yet).
  let encryptedTin: string | undefined;
  let last4: string | undefined;
  if (!input.tinAppliedFor && input.tin) {
    encryptedTin = await encryptField(input.tin);
    last4 = tinLast4(input.tin);
  }

  // Store the private PDF.
  const s3Key = `compliance/${input.ownerType.toLowerCase()}/${input.ownerId}/w9/${Helpers.generateId('w9')}.pdf`;
  await putObject(s3Key, rendered.bytes, 'application/pdf');

  // Applied For holds at PENDING and can never auto-verify (enforced in markVerified).
  const submitDetail = input.tinAppliedFor
    ? 'TIN_APPLIED_FOR'
    : `Certified: cert=${W9_CERTIFICATION_HASH.slice(0, 12)} rev=${W9_FORM_REVISION}`;

  const doc = await ComplianceDocumentService.createDocument({
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    documentType: 'W9',
    s3Key,
    originalFilename: 'w9.pdf',
    contentHash: rendered.contentHash,
    uploadedBy: ctx.actorAccountId,
    formRevision: W9_FORM_REVISION,
    encryptedTin,
    tinLast4: last4,
    tinType: input.tinType,
    tinAppliedFor: input.tinAppliedFor,
    initialStatus: 'PENDING',
    submitDetail,
    meta: {
      certificationHash: W9_CERTIFICATION_HASH,
      certificationVersion: W9_FORM_REVISION,
      signatureName: input.signatureName,
      signatureType: 'typed',
      signedAt: Helpers.getCurrentTimestamp(),
      consentGiven: true,
      signerAccountId: ctx.actorAccountId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      classification: input.classification,
    },
  });

  return {
    status: 'CREATED',
    document: toPublicW9(doc),
    contentHash: rendered.contentHash,
  };
}

/**
 * Open the full W-9 document: writes the append-only access log with the
 * relationship basis, then returns a short-lived signed URL. The caller must
 * have already passed the relationship resolver (Phase 6).
 */
export async function openFullW9(
  documentId: string,
  viewerAccountId: string,
  relationshipBasis: string,
): Promise<{ url: string; document: PublicW9 }> {
  const doc = await ComplianceDocumentService.getById(documentId);
  if (!doc || doc.documentType !== 'W9') throw new AppError('W9 not found', 404);
  await ComplianceDocumentService.recordW9Access(documentId, viewerAccountId, relationshipBasis);
  const url = await signedGetUrl(doc.s3Key);
  return { url, document: toPublicW9(doc) };
}

/** Admin marks a W-9 VERIFIED. An Applied For TIN can never reach VERIFIED. */
export async function markW9Verified(documentId: string, adminAccountId: string): Promise<void> {
  const doc = await ComplianceDocumentService.getById(documentId);
  if (!doc || doc.documentType !== 'W9') throw new AppError('W9 not found', 404);
  if (doc.tinAppliedFor) {
    throw new AppError('Cannot verify a W-9 with an Applied For TIN; a real TIN must replace it first', 409);
  }
  await ComplianceDocumentService.setVerificationStatus(documentId, 'VERIFIED', 'VERIFIED', adminAccountId);
}

/**
 * Re-collection trigger: a name or TIN change requires a new W-9. Flags the
 * current version as needing a refresh (append-only event) so the badge and the
 * hauler prompt reflect it. The old version stays untouched for audit.
 */
export async function flagW9RefreshRequired(
  ownerType: ComplianceOwnerType,
  ownerId: string,
  reason: string,
): Promise<ComplianceDocument | null> {
  const current = await ComplianceDocumentService.getCurrent(ownerType, ownerId, 'W9');
  if (!current) return null;
  await ComplianceDocumentService.recordVerificationEvent(
    current.documentId,
    'REFRESH_REQUIRED',
    'system',
    reason,
  );
  return current;
}
