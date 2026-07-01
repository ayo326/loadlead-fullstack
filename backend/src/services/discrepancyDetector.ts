/**
 * Discrepancy detector (read-only over the append-only pipeline).
 *
 * A pure function that takes a bundle of an invoice's pipeline records and flags
 * anomalies with a severity and the supporting record references. It never
 * mutates anything; the service wrapper (discrepancyService) gathers the records
 * and calls this. All money is integer cents.
 *
 * Checks (per invoice / carrier):
 *  - reserve released but the routed total does not reconcile to what was collected
 *  - a settled invoice whose reserve was never released
 *  - a funding advance whose referenced accessorial was not APPROVED (the core
 *    invariant, which should never fail; CRITICAL if it does)
 *  - detention and layover billing the same stop at once (no-double-bill)
 *  - duplicate charges for the same stop+policy key, or duplicate advances per line
 *  - more than one ACTIVE assignment for the same invoice scope
 *  - a payout routed to a payee that does not match the active assignment
 *  - a charge whose policy snapshot differs from the policy accepted at claim
 *  - orphan records (advance/notice with no assignment; charge status with no history)
 */

import type { AccessorialCharge, ChargeStatusHistory } from './accessorialChargeService';
import type { FundingAdvance } from './fundingAdvanceService';
import type { ReconciliationOutcome } from './reconciliationService';
import type { FactoringAssignment } from './factoringAssignmentService';

export type Severity = 'INFO' | 'WARN' | 'CRITICAL';

export interface DiscrepancyFinding {
  code: string;
  severity: Severity;
  message: string;
  refs: string[]; // ids of the records involved
}

export interface DiscrepancyRecords {
  invoiceId: string;
  carrierId: string;
  charges: AccessorialCharge[];
  chargeHistory: ChargeStatusHistory[];
  advances: FundingAdvance[];
  outcomes: ReconciliationOutcome[];
  assignments: FactoringAssignment[]; // for the carrier
  noticeAssignmentIds?: string[]; // assignment ids referenced by Notices of Assignment
  acceptedPolicyHash?: string; // policy hash accepted by the carrier at claim
  collectedCents?: number; // debtor amount collected, when known
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

export function detectDiscrepancies(r: DiscrepancyRecords): DiscrepancyFinding[] {
  const f: DiscrepancyFinding[] = [];
  const chargeById = new Map(r.charges.map((c) => [c.chargeId, c]));

  // 1. Core invariant: no advance against a non-APPROVED accessorial.
  for (const a of r.advances) {
    if (a.lineKind !== 'ACCESSORIAL' || !a.chargeId) continue;
    const c = chargeById.get(a.chargeId);
    if (c && c.status !== 'APPROVED' && c.status !== 'SETTLED') {
      f.push({
        code: 'ADVANCE_AGAINST_UNAPPROVED',
        severity: 'CRITICAL',
        message: `advance ${a.advanceId} is against accessorial ${a.chargeId} in status ${c.status}`,
        refs: [a.advanceId, a.chargeId],
      });
    }
  }

  // 2. Detention and layover billing the same stop at once.
  const byStop = new Map<string, AccessorialCharge[]>();
  for (const c of r.charges) (byStop.get(c.stopId) ?? byStop.set(c.stopId, []).get(c.stopId)!).push(c);
  for (const [stopId, cs] of byStop) {
    const detention = cs.filter((c) => c.type === 'DETENTION' && c.amountCents > 0);
    const layover = cs.filter((c) => c.type === 'LAYOVER' && c.amountCents > 0);
    if (detention.length && layover.length) {
      f.push({
        code: 'DETENTION_LAYOVER_OVERLAP',
        severity: 'CRITICAL',
        message: `stop ${stopId} bills both detention and layover`,
        refs: [...detention, ...layover].map((c) => c.chargeId),
      });
    }
  }

  // 3. Duplicate charges for the same stop + policy snapshot key.
  const seenKey = new Map<string, string>();
  for (const c of r.charges) {
    const key = `${c.stopId}|${c.policyHash}`;
    const prior = seenKey.get(key);
    if (prior) {
      f.push({ code: 'DUPLICATE_CHARGE', severity: 'WARN', message: `duplicate charges for ${key}`, refs: [prior, c.chargeId] });
    } else seenKey.set(key, c.chargeId);
  }

  // 3b. Duplicate advances for the same line.
  const seenAdvKey = new Map<string, string>();
  for (const a of r.advances) {
    const prior = seenAdvKey.get(a.idempotencyKey);
    if (prior) {
      f.push({ code: 'DUPLICATE_ADVANCE', severity: 'CRITICAL', message: `duplicate advances for the same line`, refs: [prior, a.advanceId] });
    } else seenAdvKey.set(a.idempotencyKey, a.advanceId);
  }

  // 4. More than one ACTIVE assignment for this invoice scope.
  const superseded = new Set(r.assignments.map((a) => a.supersedesAssignmentId).filter(Boolean) as string[]);
  const liveActive = r.assignments.filter(
    (a) => a.status === 'ACTIVE' && !superseded.has(a.assignmentId) && (a.invoiceId === r.invoiceId || a.accountLevel)
  );
  const invoiceLevelActive = liveActive.filter((a) => a.invoiceId === r.invoiceId);
  if (invoiceLevelActive.length > 1) {
    f.push({
      code: 'MULTIPLE_ACTIVE_ASSIGNMENTS',
      severity: 'CRITICAL',
      message: `invoice ${r.invoiceId} resolves more than one active assignment`,
      refs: invoiceLevelActive.map((a) => a.assignmentId),
    });
  }

  // 5. Payout routed to a payee that does not match the active assignment.
  const activeAssignment = invoiceLevelActive[0] ?? liveActive.find((a) => a.accountLevel);
  for (const o of r.outcomes) {
    if (o.type !== 'PAYMENT_ROUTED') continue;
    if (activeAssignment && o.payeeType === 'CARRIER') {
      f.push({ code: 'PAYEE_MISMATCH', severity: 'CRITICAL', message: `payment routed to CARRIER despite an active assignment`, refs: [o.outcomeId, activeAssignment.assignmentId] });
    }
    if (!activeAssignment && (o.payeeType === 'FACTOR' || o.payeeType === 'PARTNER')) {
      f.push({ code: 'PAYEE_MISMATCH', severity: 'CRITICAL', message: `payment routed to ${o.payeeType} with no active assignment`, refs: [o.outcomeId] });
    }
  }

  // 6. Reserve released but the routed total does not reconcile to collected.
  const paymentRouted = r.outcomes.filter((o) => o.type === 'PAYMENT_ROUTED');
  const reserveReleased = r.outcomes.filter((o) => o.type === 'RESERVE_RELEASED');
  if (r.collectedCents != null && paymentRouted.length) {
    const routed = sum(paymentRouted.map((o) => o.amountCents + (o.feeCents ?? 0)));
    const released = sum(reserveReleased.map((o) => o.amountCents));
    if (routed + released !== r.collectedCents) {
      f.push({
        code: 'RESERVE_NOT_RECONCILED',
        severity: 'WARN',
        message: `routed ${routed} + reserve ${released} != collected ${r.collectedCents}`,
        refs: [...paymentRouted, ...reserveReleased].map((o) => o.outcomeId),
      });
    }
  }

  // 7. A settled invoice whose reserve was never released (with advances outstanding).
  const settled = paymentRouted.length > 0 || r.charges.some((c) => c.status === 'SETTLED');
  if (settled && r.advances.length > 0 && reserveReleased.length === 0) {
    f.push({
      code: 'RESERVE_NEVER_RELEASED',
      severity: 'WARN',
      message: `invoice ${r.invoiceId} settled with advances but no reserve release`,
      refs: r.advances.map((a) => a.advanceId),
    });
  }

  // 8. Policy snapshot drift: a charge's policy differs from what was accepted at claim.
  if (r.acceptedPolicyHash) {
    for (const c of r.charges) {
      if (c.policyHash && c.policyHash !== r.acceptedPolicyHash) {
        f.push({ code: 'POLICY_SNAPSHOT_DRIFT', severity: 'WARN', message: `charge ${c.chargeId} policy differs from the accepted policy`, refs: [c.chargeId] });
      }
    }
  }

  // 9. Orphans: advance/notice referencing a missing assignment; charge status with no history.
  const assignmentIds = new Set(r.assignments.map((a) => a.assignmentId));
  for (const a of r.advances) {
    if (a.assignmentId && !assignmentIds.has(a.assignmentId)) {
      f.push({ code: 'ORPHAN_ADVANCE', severity: 'WARN', message: `advance ${a.advanceId} references missing assignment ${a.assignmentId}`, refs: [a.advanceId] });
    }
  }
  for (const noaAssignId of r.noticeAssignmentIds ?? []) {
    if (!assignmentIds.has(noaAssignId)) {
      f.push({ code: 'ORPHAN_NOTICE', severity: 'WARN', message: `Notice of Assignment references missing assignment ${noaAssignId}`, refs: [noaAssignId] });
    }
  }
  const historyChargeIds = new Set(r.chargeHistory.map((h) => h.chargeId));
  for (const c of r.charges) {
    if (c.status !== 'ACCRUING' && !historyChargeIds.has(c.chargeId)) {
      f.push({ code: 'ORPHAN_CHARGE_STATUS', severity: 'WARN', message: `charge ${c.chargeId} has status ${c.status} but no history row`, refs: [c.chargeId] });
    }
  }

  return f;
}
