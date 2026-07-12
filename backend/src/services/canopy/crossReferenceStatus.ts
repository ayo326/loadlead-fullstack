/**
 * Cross-reference resolution status (SCRUM-60).
 *
 * A tiny, dependency-light helper shared by the verification decision (Phase 7)
 * and the cross-reference engine (Phase 6) so neither imports the other. A
 * carrier has an UNRESOLVED CRITICAL cross-reference when its latest result is
 * CRITICAL_DISCREPANCY and no CROSS_REFERENCE_RESOLVED event has been appended on
 * the current INSURER_POLICY document at or after that result. An unresolved
 * CRITICAL holds the record at PENDING (it does not auto-verify).
 */

import { ComplianceDocumentService } from '../complianceDocumentService';
import { CoiCrossReferenceStore } from './coiCrossReferenceStore';

export async function hasUnresolvedCriticalCrossReference(carrierId: string): Promise<boolean> {
  const latest = await CoiCrossReferenceStore.latestForCarrier(carrierId);
  if (!latest || latest.alignment !== 'CRITICAL_DISCREPANCY') return false;

  const doc = await ComplianceDocumentService.getCurrent('HAULER', carrierId, 'INSURER_POLICY');
  if (!doc) return true; // a CRITICAL with no insurer-policy doc is treated as holding

  const events = await ComplianceDocumentService.listEvents(doc.documentId);
  const resolvedAfter = events.some(
    (e) => e.event === 'CROSS_REFERENCE_RESOLVED' && e.createdAt >= latest.createdAt,
  );
  return !resolvedAfter;
}
