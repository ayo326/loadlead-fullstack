/**
 * Read-only gathering of a load's pipeline records for the compliance layer.
 *
 * Used by the discrepancy scan and the case-file assembler. It only reads the
 * existing append-only stores; it never mutates anything. The invoice id is the
 * load id in this system.
 */

import { LoadService } from './loadService';
import { DriverService } from './driverService';
import { resolveCarrierOfRecord } from './carrierOfRecord';
import { AccessorialChargeService } from './accessorialChargeService';
import { FundingAdvanceService } from './fundingAdvanceService';
import { ReconciliationService } from './reconciliationService';
import { FactoringAssignmentService } from './factoringAssignmentService';
import { NoticeOfAssignmentService } from './noticeOfAssignmentService';
import { AccessorialPolicyService } from './accessorialPolicyService';
import { AdjudicationService } from './adjudicationService';
import { AdminAuditService } from './adminAuditService';
import type { DiscrepancyRecords } from './discrepancyDetector';

/** Best-effort carrier-of-record id for a load, by id. */
export async function resolveCarrierIdForLoad(load: any): Promise<string> {
  if (!load?.assignedDriverId) return 'unassigned';
  const driver = await DriverService.getProfileById(load.assignedDriverId);
  const cor = driver ? await resolveCarrierOfRecord(driver) : null;
  return cor?.entityId ?? load.assignedDriverId;
}

export interface GatheredRecords extends DiscrepancyRecords {
  noticeAssignmentIds: string[];
}

/** Gather the pipeline records for a load into the discrepancy-detector bundle. */
export async function gatherForLoad(loadId: string): Promise<GatheredRecords> {
  const load = await LoadService.getLoadById(loadId);
  const carrierId = load ? await resolveCarrierIdForLoad(load) : 'unassigned';

  const charges = await AccessorialChargeService.listForLoad(loadId);
  const chargeHistory = (await Promise.all(charges.map((c) => AccessorialChargeService.history(c.chargeId)))).flat();
  const advances = await FundingAdvanceService.listForInvoice(loadId);
  const outcomes = await ReconciliationService.outcomesForInvoice(loadId);
  const assignments = await FactoringAssignmentService.listForCarrier(carrierId);
  const notices = await NoticeOfAssignmentService.listForCarrier(carrierId);
  const acceptances = await AccessorialPolicyService.listAcceptances(loadId);

  return {
    invoiceId: loadId,
    carrierId,
    charges,
    chargeHistory,
    advances,
    outcomes,
    assignments,
    noticeAssignmentIds: notices.map((n) => n.assignmentId),
    ...(acceptances[0]?.policyHash ? { acceptedPolicyHash: acceptances[0].policyHash } : {}),
  };
}

/** Flatten a load's full record set into case-file items (kind, id, content). */
export async function gatherCaseFileRecords(loadId: string): Promise<{ kind: string; id: string; content: unknown }[]> {
  const g = await gatherForLoad(loadId);
  const acceptances = await AccessorialPolicyService.listAcceptances(loadId);
  const shipperAgreements = await AccessorialPolicyService.listShipperAgreements(loadId);
  const adjudications = await AdjudicationService.listForInvoice(loadId);
  const auditEntries = await AdminAuditService.list({ targetRef: loadId });

  const items: { kind: string; id: string; content: unknown }[] = [];
  for (const a of acceptances) items.push({ kind: 'ESIGN_ACCEPTANCE', id: a.acceptanceId, content: a });
  for (const a of shipperAgreements) items.push({ kind: 'SHIPPER_AGREEMENT', id: a.agreementId, content: a });
  for (const c of g.charges) items.push({ kind: 'CHARGE', id: c.chargeId, content: c });
  for (const h of g.chargeHistory) items.push({ kind: 'CHARGE_HISTORY', id: h.historyId, content: h });
  for (const a of g.advances) items.push({ kind: 'ADVANCE', id: a.advanceId, content: a });
  for (const o of g.outcomes) items.push({ kind: 'RECONCILIATION', id: o.outcomeId, content: o });
  for (const a of g.assignments) items.push({ kind: 'ASSIGNMENT', id: a.assignmentId, content: a });
  for (const a of adjudications) items.push({ kind: 'ADJUDICATION', id: a.adjudicationId, content: a });
  for (const e of auditEntries) items.push({ kind: 'ADMIN_AUDIT', id: e.auditId, content: e });
  return items;
}
