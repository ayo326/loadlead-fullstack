/**
 * Factoring-ready invoice package (per line item).
 *
 * Scoped view of one invoice for a funding decision: the linehaul line plus one
 * line per accessorial charge, each with an amount (integer cents), a factorable
 * boolean, and a short reason when not factorable. It also reports the verified
 * debtor and mover, the POD and rate-confirmation references, any active
 * assignment, and advanceableTotalCents (the sum of factorable lines).
 *
 * Factorability rules (the funding gate):
 *   - Linehaul is factorable when POD-attested, both sides verified, and within terms.
 *   - An accessorial is factorable only when its charge is APPROVED, evidence is
 *     present, and within terms. Never while ACCRUING, PENDING_REVIEW, DISPUTED,
 *     or ADJUSTED. A SETTLED accessorial is already paid, so it is not advanceable.
 *
 * This is the canonical assessor; the caller (Phase 9 route) resolves the facts
 * and passes them in. Pure and deterministic. All money is integer cents.
 */

import { assertIntegerCents } from '../utils/money';
import type { AccessorialCharge } from './accessorialChargeService';
import type { FactoringAssignment } from './factoringAssignmentService';

export type InvoiceLineKind = 'LINEHAUL' | 'ACCESSORIAL';

export interface InvoiceLine {
  kind: InvoiceLineKind;
  /** Present for accessorial lines. */
  chargeId?: string;
  /** DETENTION or LAYOVER for accessorial lines. */
  accessorialType?: AccessorialCharge['type'];
  amountCents: number;
  factorable: boolean;
  /** Short reason when not factorable; omitted when factorable. */
  reason?: string;
}

export interface PartyRef {
  id: string;
  name?: string;
  verified: boolean;
}

export interface InvoicePackageContext {
  invoiceId: string;
  loadId: string;
  carrierId: string;
  debtor: PartyRef; // the shipper
  mover: PartyRef; // the carrier of record (fleet carrier or owner-operator)
  /** Mover's net linehaul in cents (gross minus the effective take; 0 take in beta). */
  linehaulAmountCents: number;
  podAttested: boolean;
  withinTerms: boolean;
  podRef?: string;
  rateConfRef?: string;
  charges: AccessorialCharge[];
  activeAssignment?: FactoringAssignment | null;
}

export interface FactoringInvoicePackage {
  invoiceId: string;
  loadId: string;
  debtor: PartyRef;
  mover: PartyRef;
  lines: InvoiceLine[];
  podRef?: string;
  rateConfRef?: string;
  activeAssignment?: FactoringAssignment | null;
  advanceableTotalCents: number;
}

function linehaulReason(ctx: InvoicePackageContext): string | undefined {
  const missing: string[] = [];
  if (!ctx.podAttested) missing.push('POD not attested');
  if (!ctx.debtor.verified) missing.push('debtor not verified');
  if (!ctx.mover.verified) missing.push('mover not verified');
  if (!ctx.withinTerms) missing.push('outside terms');
  return missing.length ? missing.join('; ') : undefined;
}

function accessorialReason(charge: AccessorialCharge, withinTerms: boolean): string | undefined {
  if (charge.status !== 'APPROVED') {
    if (charge.status === 'SETTLED') return 'already settled';
    return `charge is ${charge.status}`;
  }
  const hasEvidence = Boolean(charge.arrivalEventId && charge.departureEventId);
  if (!hasEvidence) return 'no stop-event evidence';
  if (!withinTerms) return 'outside terms';
  return undefined;
}

export class InvoicePackageService {
  /** Build the per-line factoring-ready package for one invoice. */
  static build(ctx: InvoicePackageContext): FactoringInvoicePackage {
    assertIntegerCents(ctx.linehaulAmountCents, 'linehaulAmountCents');

    const lines: InvoiceLine[] = [];

    const lhReason = linehaulReason(ctx);
    lines.push({
      kind: 'LINEHAUL',
      amountCents: ctx.linehaulAmountCents,
      factorable: lhReason === undefined,
      ...(lhReason ? { reason: lhReason } : {}),
    });

    for (const charge of ctx.charges) {
      assertIntegerCents(charge.amountCents, `charge ${charge.chargeId} amount`);
      const reason = accessorialReason(charge, ctx.withinTerms);
      lines.push({
        kind: 'ACCESSORIAL',
        chargeId: charge.chargeId,
        accessorialType: charge.type,
        amountCents: charge.amountCents,
        factorable: reason === undefined,
        ...(reason ? { reason } : {}),
      });
    }

    const advanceableTotalCents = lines
      .filter((l) => l.factorable)
      .reduce((sum, l) => sum + l.amountCents, 0);
    assertIntegerCents(advanceableTotalCents, 'advanceableTotalCents');

    return {
      invoiceId: ctx.invoiceId,
      loadId: ctx.loadId,
      debtor: ctx.debtor,
      mover: ctx.mover,
      lines,
      ...(ctx.podRef ? { podRef: ctx.podRef } : {}),
      ...(ctx.rateConfRef ? { rateConfRef: ctx.rateConfRef } : {}),
      activeAssignment: ctx.activeAssignment ?? null,
      advanceableTotalCents,
    };
  }
}
