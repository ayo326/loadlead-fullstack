/**
 * Certificate of Insurance (COI) intake and verification.
 *
 * The hauler uploads the COI file plus the structured fields they confirm. The
 * file is stored privately in S3; the fields live on the document row's meta.
 * An FMCSA insurance-filing cross-check corroborates the insurer and minimum
 * liability and is recorded as an append-only AUTO_CHECK_PASSED/FAILED event
 * (a signal, not a verification). A verification provider (manual by default)
 * makes the VERIFIED/REJECTED decision. On its expiry date a COI flips to
 * EXPIRED; a renewal is a new version that re-verifies. All money is integer
 * cents.
 */

import { createHash } from 'node:crypto';
import { Helpers } from '../../utils/helpers';
import { AppError } from '../../middleware/errorHandler';
import {
  ComplianceDocument,
  ComplianceDocumentService,
  ComplianceOwnerType,
} from '../complianceDocumentService';
import { getInsuranceFilings } from '../integrations/fmcsaInsurance';
import { resolveInsuranceProvider } from './insuranceVerification';
import { putObject, signedGetUrl } from './complianceStorage';

export interface CoiFields {
  insurerName: string;
  producerName?: string;
  producerContact?: string;
  policyNumber: string;
  /** Coverage limits in integer cents. */
  autoLiabilityCents?: number;
  cargoCents?: number;
  generalLiabilityCents?: number;
  effectiveDate: number; // epoch ms
  expiryDate: number; // epoch ms
  certificateHolder?: string;
  mcNumber?: string;
  dotNumber?: string;
}

export interface SubmitCoiInput {
  ownerType: ComplianceOwnerType;
  ownerId: string;
  fileBytes: Uint8Array;
  originalFilename: string;
  contentType: string;
  fields: CoiFields;
}

/** Minimum BIPD/auto-liability the platform expects on file (dollars). */
const MIN_LIABILITY_DOLLARS = 750_000; // FMCSA general-freight minimum

function assertCents(v: number | undefined, label: string) {
  if (v === undefined) return;
  if (!Number.isInteger(v) || v < 0) throw new AppError(`${label} must be a non-negative integer (cents)`, 400);
}

export async function submitCoi(input: SubmitCoiInput, actorAccountId: string): Promise<ComplianceDocument> {
  const f = input.fields;
  if (!f.insurerName || !f.policyNumber) throw new AppError('insurerName and policyNumber are required', 400);
  if (!f.effectiveDate || !f.expiryDate) throw new AppError('effectiveDate and expiryDate are required', 400);
  assertCents(f.autoLiabilityCents, 'autoLiabilityCents');
  assertCents(f.cargoCents, 'cargoCents');
  assertCents(f.generalLiabilityCents, 'generalLiabilityCents');

  const contentHash = createHash('sha256').update(input.fileBytes).digest('hex');
  const s3Key = `compliance/${input.ownerType.toLowerCase()}/${input.ownerId}/coi/${Helpers.generateId('coi')}.pdf`;
  await putObject(s3Key, input.fileBytes, input.contentType || 'application/pdf');

  const doc = await ComplianceDocumentService.createDocument({
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    documentType: 'COI',
    s3Key,
    originalFilename: input.originalFilename,
    contentHash,
    uploadedBy: actorAccountId,
    expiresAt: f.expiryDate,
    initialStatus: 'PENDING',
    meta: { ...f },
  });

  // Register with the verification provider (manual by default).
  const provider = resolveInsuranceProvider();
  await provider.submit({
    documentId: doc.documentId,
    mcNumber: f.mcNumber,
    dotNumber: f.dotNumber,
    insurerName: f.insurerName,
    policyNumber: f.policyNumber,
  });

  // Fire the FMCSA cross-check (best-effort corroboration).
  await runInsuranceAutoCheck(doc.documentId).catch(() => undefined);

  return doc;
}

/**
 * Cross-check the COI against the FMCSA insurance filings for the carrier's DOT.
 * Records AUTO_CHECK_PASSED when the insurer matches and minimum liability is
 * present, otherwise AUTO_CHECK_FAILED with the comparison detail.
 */
export async function runInsuranceAutoCheck(documentId: string): Promise<'PASSED' | 'FAILED'> {
  const doc = await ComplianceDocumentService.getById(documentId);
  if (!doc || doc.documentType !== 'COI') throw new AppError('COI not found', 404);
  const fields = (doc.meta ?? {}) as unknown as CoiFields;

  const filings = await getInsuranceFilings(fields.dotNumber);
  const claimedInsurer = (fields.insurerName || '').toUpperCase();
  const insurerMatch =
    filings.hasActiveInsurance &&
    filings.insurerNames.some((n) => n.includes(claimedInsurer) || claimedInsurer.includes(n));
  const liabilityOk =
    (filings.bipdOnFileDollars ?? 0) >= MIN_LIABILITY_DOLLARS ||
    (fields.autoLiabilityCents ?? 0) >= MIN_LIABILITY_DOLLARS * 100;

  const passed = insurerMatch && liabilityOk;
  const detail =
    `insurerMatch=${insurerMatch} liabilityOk=${liabilityOk} ` +
    `fmcsaInsurers=[${filings.insurerNames.join(', ')}] bipdOnFile=${filings.bipdOnFileDollars ?? 'n/a'}`;

  await ComplianceDocumentService.recordVerificationEvent(
    documentId,
    passed ? 'AUTO_CHECK_PASSED' : 'AUTO_CHECK_FAILED',
    'fmcsa',
    detail,
  );
  return passed ? 'PASSED' : 'FAILED';
}

/** Admin marks a COI VERIFIED or REJECTED (a manual override can still verify a failed auto-check). */
export async function decideCoi(
  documentId: string,
  adminAccountId: string,
  decision: 'VERIFIED' | 'REJECTED',
  reason?: string,
): Promise<void> {
  const doc = await ComplianceDocumentService.getById(documentId);
  if (!doc || doc.documentType !== 'COI') throw new AppError('COI not found', 404);
  await ComplianceDocumentService.setVerificationStatus(documentId, decision, decision, adminAccountId, reason);
}

/**
 * Flip every current COI whose expiry has passed to EXPIRED. Intended for a
 * scheduled job. Returns the ids expired.
 */
export async function expireDueCois(now: number = Helpers.getCurrentTimestamp()): Promise<string[]> {
  const expired: string[] = [];
  const candidates = await ComplianceDocumentService.listAllCurrentOfType('COI');
  for (const doc of candidates) {
    if (doc.verificationStatus === 'EXPIRED') continue;
    if (doc.expiresAt && doc.expiresAt <= now) {
      await ComplianceDocumentService.setVerificationStatus(
        doc.documentId,
        'EXPIRED',
        'EXPIRED',
        'system',
        'COI expiry date reached',
      );
      expired.push(doc.documentId);
    }
  }
  return expired;
}

/** A short-lived signed URL to the stored COI (relationship enforcement is the caller's job). */
export async function coiDocumentUrl(documentId: string): Promise<string> {
  const doc = await ComplianceDocumentService.getById(documentId);
  if (!doc || doc.documentType !== 'COI') throw new AppError('COI not found', 404);
  return signedGetUrl(doc.s3Key);
}
