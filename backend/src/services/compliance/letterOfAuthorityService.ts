/**
 * Letter of Authority intake and verification.
 *
 * The hauler uploads their FMCSA operating-authority letter and confirms the MC
 * and USDOT numbers on it. An auto cross-check compares those against the
 * authority status already retrievable through QCMobile (authority active,
 * matching MC/DOT) and records the result as an append-only event. An admin
 * verifies for the beta.
 */

import { createHash } from 'node:crypto';
import { Helpers } from '../../utils/helpers';
import { AppError } from '../../middleware/errorHandler';
import {
  ComplianceDocument,
  ComplianceDocumentService,
  ComplianceOwnerType,
} from '../complianceDocumentService';
import { checkCarrierAuthority } from '../integrations/fmcsa';
import { putObject, signedGetUrl } from './complianceStorage';

export interface SubmitLoaInput {
  ownerType: ComplianceOwnerType;
  ownerId: string;
  fileBytes: Uint8Array;
  originalFilename: string;
  contentType: string;
  mcNumber: string;
  dotNumber: string;
}

export async function submitLetterOfAuthority(
  input: SubmitLoaInput,
  actorAccountId: string,
): Promise<ComplianceDocument> {
  if (!input.mcNumber || !input.dotNumber) throw new AppError('mcNumber and dotNumber are required', 400);

  const contentHash = createHash('sha256').update(input.fileBytes).digest('hex');
  const s3Key = `compliance/${input.ownerType.toLowerCase()}/${input.ownerId}/loa/${Helpers.generateId('loa')}.pdf`;
  await putObject(s3Key, input.fileBytes, input.contentType || 'application/pdf');

  const doc = await ComplianceDocumentService.createDocument({
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    documentType: 'LETTER_OF_AUTHORITY',
    s3Key,
    originalFilename: input.originalFilename,
    contentHash,
    uploadedBy: actorAccountId,
    initialStatus: 'PENDING',
    meta: { mcNumber: input.mcNumber, dotNumber: input.dotNumber },
  });

  await runAuthorityAutoCheck(doc.documentId).catch(() => undefined);
  return doc;
}

/** Cross-check the letter's MC/DOT against live QCMobile authority; record the result. */
export async function runAuthorityAutoCheck(documentId: string): Promise<'PASSED' | 'FAILED'> {
  const doc = await ComplianceDocumentService.getById(documentId);
  if (!doc || doc.documentType !== 'LETTER_OF_AUTHORITY') throw new AppError('Letter of Authority not found', 404);
  const meta = (doc.meta ?? {}) as { mcNumber?: string; dotNumber?: string };

  const active = await checkCarrierAuthority(meta.mcNumber, meta.dotNumber);
  const detail = `authorityActive=${active} mc=${meta.mcNumber ?? 'n/a'} dot=${meta.dotNumber ?? 'n/a'}`;
  await ComplianceDocumentService.recordVerificationEvent(
    documentId,
    active ? 'AUTO_CHECK_PASSED' : 'AUTO_CHECK_FAILED',
    'qcmobile',
    detail,
  );
  return active ? 'PASSED' : 'FAILED';
}

export async function decideLetterOfAuthority(
  documentId: string,
  adminAccountId: string,
  decision: 'VERIFIED' | 'REJECTED',
  reason?: string,
): Promise<void> {
  const doc = await ComplianceDocumentService.getById(documentId);
  if (!doc || doc.documentType !== 'LETTER_OF_AUTHORITY') throw new AppError('Letter of Authority not found', 404);
  await ComplianceDocumentService.setVerificationStatus(documentId, decision, decision, adminAccountId, reason);
}

export async function letterOfAuthorityUrl(documentId: string): Promise<string> {
  const doc = await ComplianceDocumentService.getById(documentId);
  if (!doc || doc.documentType !== 'LETTER_OF_AUTHORITY') throw new AppError('Letter of Authority not found', 404);
  return signedGetUrl(doc.s3Key);
}
