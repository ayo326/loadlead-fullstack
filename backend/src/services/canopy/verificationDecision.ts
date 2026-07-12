/**
 * Canopy insurance verification decision (SCRUM-60, Phase 7).
 *
 * Three evidence sources, one pipeline:
 *   1. insurer-sourced data (the Canopy pull, mapped to structured fields),
 *   2. the FMCSA liability filing check (always run, never replaced),
 *   3. the COI cross-reference (an unresolved CRITICAL holds the record).
 *
 * PASS when: insurer commercial-auto liability is active at or above the platform
 * minimum (the ComplianceEvaluator's decision), AND the FMCSA filing check
 * passes, AND there is no unresolved CRITICAL_DISCREPANCY. On PASS the
 * INSURER_POLICY document goes VERIFIED and the step advances; otherwise it holds
 * PENDING with the reason. The FMCSA check outcome is always recorded as an
 * append-only AUTO_CHECK_PASSED/FAILED event, exactly like the manual COI path,
 * so the packet and queue treat connected and fallback haulers uniformly.
 *
 * All outcomes flow through the five-state machine; nothing here touches the Load
 * model or mutates a prior event.
 */

import { Logger } from '../../utils/logger';
import { OwnerOperatorService } from '../ownerOperatorService';
import { getInsuranceFilings } from '../integrations/fmcsaInsurance';
import { ComplianceDocument, ComplianceDocumentService } from '../complianceDocumentService';
import { notifyVerificationOutcome } from '../compliance/complianceNotifications';
import { CanopyInsuranceData } from './canopyMapper';
import { CanopyPull } from './canopyTypes';
import { evaluateForDecision, MIN_AUTO_LIABILITY_CENTS } from './complianceEvaluator';
import { hasUnresolvedCriticalCrossReference } from './crossReferenceStatus';
import { InsurerPolicyMeta } from './canopyIngestionServiceTypes';

/** Platform minimum auto liability in dollars, for FMCSA BIPD comparison. */
const MIN_LIABILITY_DOLLARS = MIN_AUTO_LIABILITY_CENTS / 100;

export interface CanopyDecisionInput {
  documentId: string;
  carrierId: string;
  data: CanopyInsuranceData;
  /** The pull, when available, so the Policy Check evaluator can read it. */
  pull?: CanopyPull;
}

export interface CanopyDecision {
  verified: boolean;
  reason?: string;
}

/**
 * Run the FMCSA liability filing check for a carrier and record the append-only
 * AUTO_CHECK_PASSED/FAILED event on the document. Returns whether it passed.
 * Mirrors coiService.runInsuranceAutoCheck: an insurer-name corroboration plus a
 * minimum-liability floor (from either the FMCSA BIPD-on-file or the insurer
 * data). The FMCSA check ALWAYS runs; Canopy adds truth, it does not replace it.
 */
async function runFmcsaCheck(
  documentId: string,
  carrierId: string,
  data: CanopyInsuranceData,
): Promise<boolean> {
  const op = await OwnerOperatorService.getById(carrierId);
  const dot = op?.dotNumber;
  const filings = await getInsuranceFilings(dot);

  const claimedInsurer = (data.insurerName || '').toUpperCase();
  const insurerMatch =
    filings.hasActiveInsurance &&
    (claimedInsurer === '' ||
      filings.insurerNames.some((n) => n.includes(claimedInsurer) || claimedInsurer.includes(n)));
  const liabilityOk =
    (filings.bipdOnFileDollars ?? 0) >= MIN_LIABILITY_DOLLARS ||
    (data.autoLiabilityCents ?? 0) >= MIN_AUTO_LIABILITY_CENTS;

  const passed = filings.hasActiveInsurance && insurerMatch && liabilityOk;
  const detail =
    `insurerMatch=${insurerMatch} liabilityOk=${liabilityOk} hasActiveInsurance=${filings.hasActiveInsurance} ` +
    `fmcsaInsurers=[${filings.insurerNames.join(', ')}] bipdOnFile=${filings.bipdOnFileDollars ?? 'n/a'} dot=${dot ?? 'n/a'}`;

  await ComplianceDocumentService.recordVerificationEvent(
    documentId,
    passed ? 'AUTO_CHECK_PASSED' : 'AUTO_CHECK_FAILED',
    'fmcsa',
    detail,
  );
  return passed;
}

/**
 * Decide verification for an INSURER_POLICY document. Sets VERIFIED on PASS,
 * otherwise holds PENDING with a reason. Notifies the hauler on a VERIFIED flip.
 */
export async function decideCanopyInsurerPolicy(input: CanopyDecisionInput): Promise<CanopyDecision> {
  const { documentId, carrierId, data, pull } = input;

  const evaluation = await evaluateForDecision(data, pull, documentId);
  const evalPass = evaluation.deciding.pass;
  const fmcsaPass = await runFmcsaCheck(documentId, carrierId, data);
  const unresolvedCritical = await hasUnresolvedCriticalCrossReference(carrierId);

  const verified = evalPass && fmcsaPass && !unresolvedCritical;

  const reasons: string[] = [];
  if (!evalPass) reasons.push(...evaluation.deciding.reasons);
  if (!fmcsaPass) reasons.push('FMCSA liability filing check did not pass');
  if (unresolvedCritical) reasons.push('a critical COI discrepancy is under review');
  const reason = reasons.length ? reasons.join('; ') : undefined;

  const current = await ComplianceDocumentService.getById(documentId);
  if (verified) {
    if (current?.verificationStatus !== 'VERIFIED') {
      await ComplianceDocumentService.setVerificationStatus(
        documentId,
        'VERIFIED',
        'VERIFIED',
        'canopy',
        `insurer liability + FMCSA confirmed; evaluator=${evaluation.mode}`,
      );
      await notifyVerificationOutcome(documentId).catch(() => undefined);
    }
  } else {
    // Hold PENDING with the reason. If the document was VERIFIED (e.g. a monitoring
    // change or a newly-found CRITICAL), this correctly holds it back.
    if (current?.verificationStatus !== 'PENDING') {
      await ComplianceDocumentService.setVerificationStatus(
        documentId,
        'PENDING',
        'AUTO_CHECK_FAILED',
        'canopy',
        reason ?? 'verification incomplete',
      );
    } else {
      // Already PENDING: still append the (append-only) reason for the trail.
      await ComplianceDocumentService.recordVerificationEvent(documentId, 'AUTO_CHECK_FAILED', 'canopy', reason ?? 'verification incomplete');
    }
  }

  Logger.info(`[canopy] decision doc=${documentId} verified=${verified} eval=${evalPass} fmcsa=${fmcsaPass} crit=${unresolvedCritical}`);
  return { verified, reason };
}

/**
 * Re-run the decision for a carrier's current INSURER_POLICY document, reading
 * the insurer data back from the document meta. Used by the cross-reference
 * engine (a fresh CRITICAL must hold a previously-verified record) and by
 * monitoring (Phase 9). No-op when the carrier has no insurer-policy document.
 */
export async function reevaluateCarrierInsurerPolicy(carrierId: string): Promise<CanopyDecision | null> {
  const doc: ComplianceDocument | null = await ComplianceDocumentService.getCurrent('HAULER', carrierId, 'INSURER_POLICY');
  if (!doc) return null;
  const meta = (doc.meta ?? {}) as unknown as InsurerPolicyMeta;
  const data = meta.insurance;
  if (!data) return null;
  return decideCanopyInsurerPolicy({ documentId: doc.documentId, carrierId, data });
}
