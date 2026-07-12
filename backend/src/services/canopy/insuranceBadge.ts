/**
 * Insurance badge tiers (SCRUM-60, Phase 5/6).
 *
 * The public insurance badge for a hauler, enriched with the Canopy evidence:
 *   - "liability confirmed via FMCSA plus insurer connection" (insurer verified)
 *   - "cargo confirmed via insurer connection"
 *   - "COI cross-referenced" (aligned)
 *   - "COI discrepancy under review" (a CRITICAL is holding the record)
 *   - fallback "cargo per COI" (non-connected hauler)
 *
 * Never includes the file or any PII. Sentence case throughout.
 */

import { ComplianceDocumentService } from '../complianceDocumentService';
import { CoiFields } from '../compliance/coiService';
import { CanopyConnectionStore } from './canopyConnectionStore';
import { CoiCrossReferenceStore } from './coiCrossReferenceStore';
import { InsurerPolicyMeta } from './canopyIngestionServiceTypes';
import { hasUnresolvedCriticalCrossReference } from './crossReferenceStatus';

export interface InsuranceBadge {
  connected: boolean;
  connectionStatus?: 'CONNECTED' | 'FAILED' | 'DISCONNECTED';
  insurerVerified: boolean;
  liabilityConfirmed: boolean;
  cargoConfirmedViaInsurer: boolean;
  coiPresent: boolean;
  crossReference: 'ALIGNED' | 'MINOR_DISCREPANCY' | 'CRITICAL_DISCREPANCY' | 'NONE';
  crossReferenceUnderReview: boolean;
  cargoPerCoi: boolean;
  /** Human-readable tier labels, sentence case. */
  labels: string[];
}

export async function insuranceBadge(carrierId: string): Promise<InsuranceBadge> {
  const [insurerDoc, coiDoc, conn, latestXref, underReview] = await Promise.all([
    ComplianceDocumentService.getCurrent('HAULER', carrierId, 'INSURER_POLICY'),
    ComplianceDocumentService.getCurrent('HAULER', carrierId, 'COI'),
    CanopyConnectionStore.currentForCarrier(carrierId),
    CoiCrossReferenceStore.latestForCarrier(carrierId),
    hasUnresolvedCriticalCrossReference(carrierId),
  ]);

  const insurerMeta = (insurerDoc?.meta ?? undefined) as InsurerPolicyMeta | undefined;
  const coiMeta = (coiDoc?.meta ?? undefined) as CoiFields | undefined;

  const connected = conn?.status === 'CONNECTED';
  const insurerVerified = insurerDoc?.verificationStatus === 'VERIFIED';
  const cargoConfirmedViaInsurer = Boolean(insurerMeta?.insurance?.hasCargo) && insurerVerified;
  const coiPresent = Boolean(coiDoc);
  const crossReference = latestXref?.alignment ?? 'NONE';
  const cargoPerCoi = !connected && (coiMeta?.cargoCents ?? 0) > 0;

  const labels: string[] = [];
  if (insurerVerified) labels.push('Liability confirmed via FMCSA plus insurer connection');
  if (cargoConfirmedViaInsurer) labels.push('Cargo confirmed via insurer connection');
  if (crossReference === 'ALIGNED') labels.push('COI cross-referenced');
  if (underReview || crossReference === 'CRITICAL_DISCREPANCY') labels.push('COI discrepancy under review');
  if (cargoPerCoi) labels.push('Cargo per COI');

  return {
    connected,
    connectionStatus: conn?.status,
    insurerVerified,
    liabilityConfirmed: insurerVerified,
    cargoConfirmedViaInsurer,
    coiPresent,
    crossReference,
    crossReferenceUnderReview: underReview,
    cargoPerCoi,
    labels,
  };
}
