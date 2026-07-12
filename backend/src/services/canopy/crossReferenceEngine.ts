/**
 * COI cross-reference engine (SCRUM-60, Phase 6).
 *
 * For a Canopy-connected hauler the uploaded COI is RETAINED and becomes the
 * cross-reference artifact: it is compared field by field against the insurer-
 * sourced data. Alignment strengthens the record; misalignment is flagged with
 * severity, because a certificate that does not match what the insurer reports is
 * either stale or doctored.
 *
 * Severity table (configurable in one place, below):
 *   CRITICAL: policy-number mismatch, insurer mismatch beyond normalization, a
 *     limit OVERSTATED on the COI, a COI active while the insurer shows
 *     cancelled/expired, or a coverage on the COI the insurer does not report
 *     (phantom coverage). Forged-or-materially-stale signals.
 *   MINOR: a limit UNDERSTATED on the COI, dates off by a renewal cycle, and
 *     formatting/producer variances.
 *
 * Outcomes: ALIGNED earns the "COI cross-referenced" badge. MINOR nudges a
 * re-upload and does NOT block (insurer data is authoritative). CRITICAL flags
 * the record for admin review, raises an append-only trust event referencing the
 * result, notifies the hauler with the specific mismatched fields, and holds
 * verification at PENDING. Every result row is append-only; a re-run writes a new
 * row and never mutates a prior one.
 */

import { Logger } from '../../utils/logger';
import { ComplianceDocumentService } from '../complianceDocumentService';
import { CoiFields } from '../compliance/coiService';
import { NotificationService } from '../notificationService';
import { OwnerOperatorService } from '../ownerOperatorService';
import { BetaTrustEventService } from '../betaTrustEventService';
import {
  CoiCrossReferenceResult,
  CoiCrossReferenceStore,
  CrossReferenceAlignment,
  CrossReferenceFieldComparison,
  CrossReferenceSeverity,
} from './coiCrossReferenceStore';
import { InsurerPolicyMeta } from './canopyIngestionServiceTypes';
import { reevaluateCarrierInsurerPolicy } from './verificationDecision';

const DAY = 24 * 60 * 60 * 1000;

// ── Normalization ───────────────────────────────────────────────────────────

const INSURER_STOPWORDS = new Set([
  'INS', 'INSURANCE', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'MUTUAL', 'GROUP',
  'LLC', 'INC', 'THE', 'COMMERCIAL', 'COUNTY', 'ASSURANCE', 'CASUALTY', 'AND',
  'OF', 'A', 'US', 'USA', 'NATIONAL', 'GENERAL', 'SERVICES',
]);

/** Significant insurer-name tokens (brand words), stopwords stripped. */
export function insurerTokens(name: string | undefined | null): string[] {
  return (name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !INSURER_STOPWORDS.has(t));
}

/** Legal-name-tolerant insurer comparison: share at least one brand token. */
export function insurerNamesMatch(a: string | undefined, b: string | undefined): boolean {
  const ta = new Set(insurerTokens(a));
  const tb = insurerTokens(b);
  if (ta.size === 0 || tb.length === 0) return false;
  return tb.some((t) => ta.has(t));
}

/** Policy-number comparison after stripping spaces and dashes, case-insensitive. */
export function policyNumbersMatch(a: string | undefined, b: string | undefined): boolean {
  const norm = (s: string | undefined) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const na = norm(a);
  const nb = norm(b);
  return na !== '' && na === nb;
}

function calendarDay(ms: number | undefined): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

// ── Comparison ──────────────────────────────────────────────────────────────

function cmp(
  field: string,
  coiValue: string | number | null,
  insurerValue: string | number | null,
  match: boolean,
  severity: CrossReferenceSeverity,
  note?: string,
): CrossReferenceFieldComparison {
  return { field, coiValue, insurerValue, match, severity, note };
}

/**
 * Compare an uploaded COI's structured fields against the insurer-sourced data.
 * Pure and deterministic so it is unit-testable in isolation.
 */
export function compareCoiToInsurer(coi: CoiFields, ins: InsurerPolicyMeta, nowMs: number): {
  comparisons: CrossReferenceFieldComparison[];
  alignment: CrossReferenceAlignment;
} {
  const comparisons: CrossReferenceFieldComparison[] = [];

  // 1. Insurer name (legal-name tolerant).
  const insurerMatch = insurerNamesMatch(coi.insurerName, ins.insurerName);
  comparisons.push(
    cmp('insurerName', coi.insurerName ?? null, ins.insurerName ?? null, insurerMatch, insurerMatch ? 'NONE' : 'CRITICAL',
      insurerMatch ? undefined : 'insurer name does not match the insurer of record'),
  );

  // 2. Policy number (normalized exact; match either the auto or cargo policy).
  const policyMatch =
    policyNumbersMatch(coi.policyNumber, ins.autoPolicyNumber) ||
    policyNumbersMatch(coi.policyNumber, ins.cargoPolicyNumber);
  comparisons.push(
    cmp('policyNumber', coi.policyNumber ?? null, ins.autoPolicyNumber ?? null, policyMatch, policyMatch ? 'NONE' : 'CRITICAL',
      policyMatch ? undefined : 'policy number does not match any insurer policy'),
  );

  // 3. Auto liability limit (exact integer-cents; overstated on COI is CRITICAL).
  if (coi.autoLiabilityCents != null && ins.autoLiabilityCents != null) {
    if (coi.autoLiabilityCents === ins.autoLiabilityCents) {
      comparisons.push(cmp('autoLiabilityCents', coi.autoLiabilityCents, ins.autoLiabilityCents, true, 'NONE'));
    } else if (coi.autoLiabilityCents > ins.autoLiabilityCents) {
      comparisons.push(cmp('autoLiabilityCents', coi.autoLiabilityCents, ins.autoLiabilityCents, false, 'CRITICAL', 'auto liability limit overstated on the COI'));
    } else {
      comparisons.push(cmp('autoLiabilityCents', coi.autoLiabilityCents, ins.autoLiabilityCents, false, 'MINOR', 'auto liability limit understated on the COI'));
    }
  }

  // 4. Cargo limit + phantom-coverage check.
  const insurerHasCargo = ins.insurance?.hasCargo ?? ins.cargoCents != null;
  if ((coi.cargoCents ?? 0) > 0 && !insurerHasCargo) {
    comparisons.push(cmp('cargoCents', coi.cargoCents ?? null, null, false, 'CRITICAL', 'cargo coverage on the COI is not reported by the insurer'));
  } else if (coi.cargoCents != null && ins.cargoCents != null) {
    if (coi.cargoCents === ins.cargoCents) {
      comparisons.push(cmp('cargoCents', coi.cargoCents, ins.cargoCents, true, 'NONE'));
    } else if (coi.cargoCents > ins.cargoCents) {
      comparisons.push(cmp('cargoCents', coi.cargoCents, ins.cargoCents, false, 'CRITICAL', 'cargo limit overstated on the COI'));
    } else {
      comparisons.push(cmp('cargoCents', coi.cargoCents, ins.cargoCents, false, 'MINOR', 'cargo limit understated on the COI'));
    }
  }

  // 5. Active-on-COI while insurer shows cancelled/expired: CRITICAL.
  const insurerInactive =
    ins.insurance?.autoStatus === 'CANCELLED' ||
    ins.insurance?.autoStatus === 'EXPIRED' ||
    ins.insurance?.autoStatus === 'RESCINDED';
  const coiShowsActive = (coi.expiryDate ?? 0) > nowMs;
  if (insurerInactive && coiShowsActive) {
    comparisons.push(cmp('policyStatus', 'active per COI', ins.insurance?.autoStatus ?? null, false, 'CRITICAL', 'COI shows active coverage but the insurer shows the policy cancelled or expired'));
  }

  // 6. Effective / expiry dates (calendar-date match; else MINOR).
  for (const f of ['effectiveDate', 'expiryDate'] as const) {
    const coiMs = coi[f];
    const insMs = f === 'effectiveDate' ? ins.effectiveDate : ins.expiryDate;
    const coiDay = calendarDay(coiMs);
    const insDay = calendarDay(insMs);
    if (coiDay && insDay) {
      if (coiDay === insDay) {
        comparisons.push(cmp(f, coiDay, insDay, true, 'NONE'));
      } else {
        const diffDays = Math.abs((coiMs! - insMs!) / DAY);
        const renewalCycle = diffDays >= 330 && diffDays <= 400;
        comparisons.push(cmp(f, coiDay, insDay, false, 'MINOR', renewalCycle ? 'date off by about a renewal cycle' : 'date does not match the insurer record'));
      }
    }
  }

  const hasCritical = comparisons.some((c) => c.severity === 'CRITICAL');
  const hasMinor = comparisons.some((c) => c.severity === 'MINOR');
  const alignment: CrossReferenceAlignment = hasCritical
    ? 'CRITICAL_DISCREPANCY'
    : hasMinor
      ? 'MINOR_DISCREPANCY'
      : 'ALIGNED';

  return { comparisons, alignment };
}

// ── Engine ──────────────────────────────────────────────────────────────────

async function haulerUserId(carrierId: string): Promise<string | null> {
  const op = await OwnerOperatorService.getById(carrierId);
  return op?.userId ?? null;
}

/**
 * Run the cross-reference for a carrier: compare the current COI against the
 * current insurer-sourced policy, record an append-only result, and take the
 * severity outcome. No-op when either artifact is missing (nothing to compare).
 */
export async function runCrossReferenceForCarrier(
  carrierId: string,
  nowMs: number = Date.now(),
): Promise<CoiCrossReferenceResult | null> {
  const coiDoc = await ComplianceDocumentService.getCurrent('HAULER', carrierId, 'COI');
  const insurerDoc = await ComplianceDocumentService.getCurrent('HAULER', carrierId, 'INSURER_POLICY');
  if (!coiDoc || !insurerDoc) return null;

  const coi = (coiDoc.meta ?? {}) as unknown as CoiFields;
  const ins = (insurerDoc.meta ?? {}) as unknown as InsurerPolicyMeta;

  const { comparisons, alignment } = compareCoiToInsurer(coi, ins, nowMs);

  const result = await CoiCrossReferenceStore.record({
    carrierId,
    insuranceDocumentId: coiDoc.documentId,
    pullId: ins.pullId,
    comparisons,
    alignment,
  });

  const mismatched = comparisons.filter((c) => !c.match);
  const fieldList = mismatched.map((c) => c.field).join(', ');

  if (alignment === 'CRITICAL_DISCREPANCY') {
    // Flag the record, raise a trust event, notify the hauler, hold verification.
    await ComplianceDocumentService.recordVerificationEvent(
      insurerDoc.documentId,
      'CROSS_REFERENCE_FLAGGED',
      'system',
      `CRITICAL cross-reference (${result.resultId}); fields: ${fieldList}`,
    );
    await BetaTrustEventService.record({
      eventType: 'COI_DISCREPANCY',
      carrierId,
      recordedByAdminId: 'system',
      crossReferenceResultId: result.resultId,
      note: `COI conflicts with insurer data: ${fieldList}`,
    }).catch((e) => Logger.warn(`[canopy] trust event failed: ${e?.message ?? e}`));

    const userId = await haulerUserId(carrierId);
    if (userId) {
      await NotificationService.record({
        userId,
        kind: 'COMPLIANCE',
        title: 'Certificate of insurance under review',
        body: `Your certificate does not match your insurer records on: ${fieldList}. Our team is reviewing it. Your verification continues from your insurer connection.`,
      }).catch(() => undefined);
    }

    // A fresh CRITICAL must hold a previously-verified record back to PENDING.
    await reevaluateCarrierInsurerPolicy(carrierId).catch(() => undefined);
  } else if (alignment === 'MINOR_DISCREPANCY') {
    // Nudge a re-upload; does not block (insurer data is authoritative).
    const userId = await haulerUserId(carrierId);
    if (userId) {
      await NotificationService.record({
        userId,
        kind: 'COMPLIANCE',
        title: 'Please upload a current certificate',
        body: `Your certificate differs slightly from your insurer records on: ${fieldList}. Uploading a current certificate keeps your file clean. This does not block your verification.`,
      }).catch(() => undefined);
    }
  }

  Logger.info(`[canopy] cross-reference ${result.resultId} for ${carrierId}: ${alignment}${fieldList ? ` (${fieldList})` : ''}`);
  return result;
}

/**
 * Admin resolution of a CRITICAL cross-reference. Two paths:
 *   ACCEPT_INSURER: accept the insurer data and request a corrected COI (the
 *     verification proceeds on insurer + FMCSA; the flag and trust event persist).
 *   REJECT: reject with a reason.
 * Records an append-only CROSS_REFERENCE_RESOLVED event and re-runs the decision.
 */
export async function resolveCrossReferenceCritical(
  carrierId: string,
  adminAccountId: string,
  action: 'ACCEPT_INSURER' | 'REJECT',
  reason?: string,
): Promise<void> {
  const insurerDoc = await ComplianceDocumentService.getCurrent('HAULER', carrierId, 'INSURER_POLICY');
  if (!insurerDoc) throw new Error(`no insurer-policy document for carrier ${carrierId}`);

  await ComplianceDocumentService.recordVerificationEvent(
    insurerDoc.documentId,
    'CROSS_REFERENCE_RESOLVED',
    adminAccountId,
    `action=${action}${reason ? ` reason=${reason}` : ''}`,
  );

  if (action === 'REJECT') {
    await ComplianceDocumentService.setVerificationStatus(
      insurerDoc.documentId,
      'REJECTED',
      'REJECTED',
      adminAccountId,
      reason ?? 'rejected on COI discrepancy review',
    );
  } else {
    // Accept insurer data: re-run the decision, which now sees the CRITICAL as
    // resolved and can verify on insurer + FMCSA.
    await reevaluateCarrierInsurerPolicy(carrierId).catch(() => undefined);
  }
}
