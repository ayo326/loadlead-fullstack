/**
 * INSURER_POLICY document builder (SCRUM-60).
 *
 * Shared by the initial ingestion and by monitoring re-pulls so neither imports
 * the other. Creates a new INSURER_POLICY compliance document (source CANOPY):
 * the insurer-sourced policy snapshot is stored as a private JSON object so the
 * document has a real s3Key/contentHash, exactly like an uploaded COI; the
 * mapped structured fields live in meta. Its expiry is the governing auto
 * policy's expiry. A re-pull creates a NEW version that supersedes the prior one
 * (the document service handles supersession); prior rows are never deleted.
 */

import { createHash } from 'node:crypto';
import { ComplianceDocument, ComplianceDocumentService } from '../complianceDocumentService';
import { putObject } from '../compliance/complianceStorage';
import { CanopyInsuranceData } from './canopyMapper';
import { InsurerPolicyMeta } from './canopyIngestionServiceTypes';

export function insurerPolicyMeta(pullId: string, data: CanopyInsuranceData): InsurerPolicyMeta {
  return {
    source: 'CANOPY',
    pullId,
    insurerName: data.insurerName,
    autoPolicyNumber: data.autoPolicyNumber,
    cargoPolicyNumber: data.cargoPolicyNumber,
    autoLiabilityCents: data.autoLiabilityCents,
    cargoCents: data.cargoCents,
    generalLiabilityCents: data.generalLiabilityCents,
    effectiveDate: data.effectiveDate,
    expiryDate: data.expiryDate,
    insurance: data,
  };
}

export async function createInsurerPolicyDocument(
  carrierId: string,
  pullId: string,
  data: CanopyInsuranceData,
): Promise<ComplianceDocument> {
  const meta = insurerPolicyMeta(pullId, data);
  const snapshot = Buffer.from(JSON.stringify(meta), 'utf8');
  const contentHash = createHash('sha256').update(snapshot).digest('hex');
  const s3Key = `compliance/hauler/${carrierId}/insurer-policy/${pullId}.json`;
  await putObject(s3Key, snapshot, 'application/json');

  return ComplianceDocumentService.createDocument({
    ownerType: 'HAULER',
    ownerId: carrierId,
    documentType: 'INSURER_POLICY',
    s3Key,
    originalFilename: `canopy-pull-${pullId}.json`,
    contentHash,
    uploadedBy: 'canopy',
    expiresAt: data.expiryDate,
    initialStatus: 'PENDING',
    meta: meta as unknown as Record<string, unknown>,
    submitDetail: `source=CANOPY pull=${pullId} insurer=${data.insurerName ?? 'unknown'}`,
  });
}
