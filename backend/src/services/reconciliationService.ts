/**
 * Reconciliation and recourse (append-only outcomes).
 *
 * Ties the pieces together when money actually moves:
 *  - When an accessorial reaches APPROVED after funding, it is eligible for a
 *    supplemental advance under an active FULL_INVOICE assignment (paid to the
 *    factor/partner); otherwise its payout routes to the mover. An accessorial is
 *    never paid directly to the mover when an active FULL_INVOICE assignment
 *    covers it.
 *  - When the shipper pays, funds route to the current payee and any reserve is
 *    released minus fee.
 *  - Because no advance ever occurs against a non-APPROVED accessorial, a later
 *    dispute or downward adjustment causes no clawback.
 *  - Under RECOURSE a debtor non-payment on an advanced amount flags a mover
 *    buyback scoped to that amount and raises a trust event; under NON_RECOURSE
 *    the loss stays with the factor/partner.
 *
 * Every routing and recourse outcome is recorded append-only. All money is cents.
 */

import { createHash } from 'node:crypto';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { assertIntegerCents } from '../utils/money';
import { FundingAdvanceService, FundingAdvance } from './fundingAdvanceService';
import { BetaTrustEventService } from './betaTrustEventService';
import type { PayeeResolution, PayeeType } from './payeeRoutingService';
import type { FactoringAssignment } from './factoringAssignmentService';
import type { AccessorialCharge } from './accessorialChargeService';
import { getFundingProvider } from './funding/fundingProvider';

export type ReconciliationOutcomeType =
  | 'PAYMENT_ROUTED'
  | 'RESERVE_RELEASED'
  | 'SUPPLEMENTAL_ADVANCE'
  | 'ACCESSORIAL_TO_MOVER'
  | 'RECOURSE_BUYBACK'
  | 'NON_RECOURSE_LOSS'
  // Admin oversight: a compensating entry from an adjudication or a payout
  // intercept. Never edits an original; it is a new offsetting row.
  | 'ADJUDICATION_COMPENSATION'
  | 'INTERCEPT_APPLIED'
  // Audit v4 M6: an advance was issued against an APPROVED accessorial that
  // later regressed (DISPUTED/ADJUSTED). Money is already out the door; this
  // row makes the tension explicit for settlement to resolve (recourse
  // buyback, offset, or re-approval) instead of discovering it by accident.
  | 'ADVANCE_AT_RISK';

export interface ReconciliationOutcome {
  outcomeId: string; // 'recon_...'
  invoiceId: string;
  carrierId: string;
  type: ReconciliationOutcomeType;
  payeeType?: PayeeType;
  amountCents: number;
  feeCents?: number;
  assignmentId?: string;
  chargeId?: string;
  advanceId?: string;
  note?: string;
  idempotencyKey?: string;
  recordedAt: number;
}

function key(...parts: (string | undefined)[]): string {
  return createHash('sha256').update(parts.map((p) => p ?? '-').join('|'), 'utf8').digest('hex').slice(0, 32);
}

/** A conditional-put failure - a concurrent write won the idempotent insert. */
function isConditionFailure(err: any): boolean {
  return err?.name === 'ConditionalCheckFailedException' || err?.name === 'TransactionCanceledException';
}

/** A query against a GSI that isn't created yet (fall back to a scan until live). */
function isMissingIndex(err: any): boolean {
  return err?.name === 'ValidationException' && /index/i.test(String(err?.message ?? ''));
}

export class ReconciliationService {
  static async outcomesForInvoice(invoiceId: string): Promise<ReconciliationOutcome[]> {
    return (await this.byInvoice(invoiceId)).sort((a, b) => a.recordedAt - b.recordedAt);
  }

  /**
   * Outcomes for an invoice. M3/V2-M1: query the invoiceId GSI instead of
   * scanning the (append-only, ever-growing) ledger; fall back to a filtered
   * scan when the index isn't live yet or the data layer can't query.
   */
  private static async byInvoice(invoiceId: string): Promise<ReconciliationOutcome[]> {
    if (typeof Database.query === 'function') {
      try {
        return await Database.query<ReconciliationOutcome>(
          config.dynamodb.reconciliationOutcomesTable, 'invoiceId-index', '#i = :i', { '#i': 'invoiceId' }, { ':i': invoiceId }
        );
      } catch (err: any) {
        if (err?.name === 'ResourceNotFoundException') return [];
        if (!isMissingIndex(err)) throw err;
      }
    }
    return (await this.scanAll()).filter((o) => o.invoiceId === invoiceId);
  }

  /**
   * Handle an accessorial that reached APPROVED after the invoice was funded.
   * Under an active FULL_INVOICE assignment with a factor/partner payee, issue a
   * supplemental advance to that payee and add it to their receivable; otherwise
   * route the accessorial payout to the mover. Idempotent.
   */
  static async supplementalAdvanceOnApproval(args: {
    invoiceId: string;
    carrierId: string;
    charge: AccessorialCharge;
    payee: PayeeResolution;
    activeAssignment?: FactoringAssignment | null;
    providerName?: string;
  }): Promise<ReconciliationOutcome> {
    const { invoiceId, carrierId, charge, payee, activeAssignment } = args;
    if (charge.status !== 'APPROVED') {
      throw new Error(`supplemental advance requires an APPROVED charge, got ${charge.status}`);
    }

    const coveredByAssignment =
      !!activeAssignment &&
      activeAssignment.status === 'ACTIVE' &&
      activeAssignment.scope === 'FULL_INVOICE' &&
      (payee.type === 'FACTOR' || payee.type === 'PARTNER');

    if (coveredByAssignment) {
      // Confirm the seam is willing (manual provider supports the assignment flow).
      const providerName = args.providerName ?? getFundingProvider().name;
      const advance = await FundingAdvanceService.issueAdvance({
        invoiceId,
        carrierId,
        lineKind: 'ACCESSORIAL',
        chargeId: charge.chargeId,
        chargeStatus: charge.status,
        amountCents: charge.amountCents,
        payeeType: payee.type,
        destination: payee.destination,
        providerName,
        recourseType: activeAssignment!.recourseType,
        scope: activeAssignment!.scope,
        assignmentId: activeAssignment!.assignmentId,
      });
      return this.recordOutcome({
        invoiceId,
        carrierId,
        type: 'SUPPLEMENTAL_ADVANCE',
        payeeType: payee.type,
        amountCents: charge.amountCents,
        assignmentId: activeAssignment!.assignmentId,
        chargeId: charge.chargeId,
        advanceId: advance.advanceId,
        note: 'late-approved accessorial added to payee receivable',
        idempotencyKey: key('supp', invoiceId, charge.chargeId),
      });
    }

    // No covering assignment (none, or LINEHAUL_ONLY): the accessorial pays the mover.
    return this.recordOutcome({
      invoiceId,
      carrierId,
      type: 'ACCESSORIAL_TO_MOVER',
      payeeType: 'CARRIER',
      amountCents: charge.amountCents,
      chargeId: charge.chargeId,
      note: 'accessorial routed to mover (no covering FULL_INVOICE assignment)',
      idempotencyKey: key('accmover', invoiceId, charge.chargeId),
    });
  }

  /**
   * Route a debtor's payment to the current payee and release any reserve minus
   * fee. Idempotent per invoice payment.
   */
  static async reconcileDebtorPayment(args: {
    invoiceId: string;
    carrierId: string;
    payee: PayeeResolution;
    collectedCents: number;
    feeCents?: number;
    reserveCents?: number;
    actorId?: string;
  }): Promise<ReconciliationOutcome[]> {
    assertIntegerCents(args.collectedCents, 'collectedCents');
    const feeCents = args.feeCents ?? 0;
    const reserveCents = args.reserveCents ?? 0;
    assertIntegerCents(feeCents, 'feeCents');
    assertIntegerCents(reserveCents, 'reserveCents');

    const outcomes: ReconciliationOutcome[] = [];
    let payeeAmount = args.collectedCents - feeCents;

    // Payout intercepts (garnishment, levy, lien) apply only when the mover is
    // the payee (money owed to the carrier). A dynamic import avoids a static
    // import cycle. The intercepted portion is reduced/redirected here and
    // recorded append-only by the intercept service; the remainder routes below.
    if (args.payee.type === 'CARRIER' && payeeAmount > 0) {
      const { PayoutInterceptService } = await import('./payoutInterceptService');
      const applied = await PayoutInterceptService.applyAtSettlement({
        invoiceId: args.invoiceId,
        carrierId: args.carrierId,
        grossCarrierCents: payeeAmount,
        actorId: args.actorId ?? 'system',
      });
      payeeAmount = applied.carrierNetCents;
    }

    outcomes.push(
      await this.recordOutcome({
        invoiceId: args.invoiceId,
        carrierId: args.carrierId,
        type: 'PAYMENT_ROUTED',
        payeeType: args.payee.type,
        amountCents: payeeAmount,
        feeCents,
        ...(args.payee.assignmentId ? { assignmentId: args.payee.assignmentId } : {}),
        note: `routed to ${args.payee.type}`,
        idempotencyKey: key('pay', args.invoiceId),
      })
    );
    if (reserveCents > 0) {
      const released = Math.max(0, reserveCents - feeCents);
      outcomes.push(
        await this.recordOutcome({
          invoiceId: args.invoiceId,
          carrierId: args.carrierId,
          type: 'RESERVE_RELEASED',
          payeeType: args.payee.type,
          amountCents: released,
          feeCents,
          note: 'reserve released minus fee',
          idempotencyKey: key('reserve', args.invoiceId),
        })
      );
    }
    return outcomes;
  }

  /**
   * Handle a debtor non-payment on an advanced amount. RECOURSE flags a mover
   * buyback scoped to the advance and raises a trust event; NON_RECOURSE records
   * the loss against the factor/partner with no buyback and no trust event.
   */
  static async handleNonPayment(args: {
    advance: FundingAdvance;
    actorId: string;
  }): Promise<ReconciliationOutcome> {
    const { advance, actorId } = args;
    if (advance.recourseType === 'RECOURSE') {
      const outcome = await this.recordOutcome({
        invoiceId: advance.invoiceId,
        carrierId: advance.carrierId,
        type: 'RECOURSE_BUYBACK',
        payeeType: advance.payeeType,
        amountCents: advance.amountCents, // scoped to the advanced amount
        ...(advance.assignmentId ? { assignmentId: advance.assignmentId } : {}),
        ...(advance.chargeId ? { chargeId: advance.chargeId } : {}),
        advanceId: advance.advanceId,
        note: 'recourse buyback scoped to the advanced amount',
        idempotencyKey: key('recourse', advance.advanceId),
      });
      try {
        await BetaTrustEventService.record({
          eventType: 'TRUST_INCIDENT',
          loadId: advance.invoiceId,
          carrierId: advance.carrierId,
          recordedByAdminId: actorId,
          note: `recourse buyback on advance ${advance.advanceId}`,
        });
      } catch (err) {
        Logger.error('failed to record trust event for recourse buyback', err);
      }
      return outcome;
    }

    return this.recordOutcome({
      invoiceId: advance.invoiceId,
      carrierId: advance.carrierId,
      type: 'NON_RECOURSE_LOSS',
      payeeType: advance.payeeType,
      amountCents: advance.amountCents,
      advanceId: advance.advanceId,
      note: 'non-recourse: loss stays with the factor/partner',
      idempotencyKey: key('nonrecourse', advance.advanceId),
    });
  }

  /**
   * Append a reconciliation outcome. Idempotent AND concurrency-safe when an
   * idempotencyKey is given: the outcomeId is derived deterministically from the
   * key and written with `attribute_not_exists`, so two overlapping calls can
   * never both insert (a scan-then-put would). The loser reads back the winner.
   */
  /**
   * Flag every advance issued against a charge that regressed out of APPROVED
   * (audit v4 M6). Called from the charge dispute/adjust transitions. Appends
   * an idempotent ADVANCE_AT_RISK outcome per (advance, regressed status) -
   * repeat transitions do not duplicate; a later different regression records
   * its own row. Best-effort at the call site: the shipper's dispute/adjust
   * must not fail because the risk flag could not be written.
   */
  static async flagAdvancesAtRiskForCharge(
    chargeId: string,
    chargeStatusNow: string,
  ): Promise<ReconciliationOutcome[]> {
    const advances = await FundingAdvanceService.listForCharge(chargeId);
    const rows: ReconciliationOutcome[] = [];
    for (const adv of advances) {
      const row = await this.recordOutcome({
        invoiceId: adv.invoiceId,
        carrierId: adv.carrierId,
        type: 'ADVANCE_AT_RISK',
        amountCents: adv.amountCents,
        chargeId,
        advanceId: adv.advanceId,
        note: `charge ${chargeId} moved to ${chargeStatusNow} after advance ${adv.advanceId} was issued`,
        idempotencyKey: key('advance-at-risk', adv.advanceId, chargeStatusNow),
      });
      Logger.warn(
        `[reconciliation] ADVANCE_AT_RISK: advance ${adv.advanceId} (${adv.amountCents}c) references charge ${chargeId}, now ${chargeStatusNow}`,
      );
      rows.push(row);
    }
    return rows;
  }

  static async recordOutcome(
    input: Omit<ReconciliationOutcome, 'outcomeId' | 'recordedAt'>
  ): Promise<ReconciliationOutcome> {
    const outcome: ReconciliationOutcome = {
      outcomeId: input.idempotencyKey ? `recon_${input.idempotencyKey}` : Helpers.generateId('recon'),
      recordedAt: Helpers.getCurrentTimestamp(),
      ...input,
    };
    if (!input.idempotencyKey) {
      await Database.putItem(config.dynamodb.reconciliationOutcomesTable, outcome);
      return outcome;
    }
    try {
      await Database.putItem(config.dynamodb.reconciliationOutcomesTable, outcome, {
        conditionExpression: 'attribute_not_exists(outcomeId)',
      });
      return outcome;
    } catch (err) {
      if (isConditionFailure(err)) {
        const existing = await Database.getItem<ReconciliationOutcome>(
          config.dynamodb.reconciliationOutcomesTable,
          { outcomeId: outcome.outcomeId }
        );
        if (existing) return existing; // a concurrent write won; return its row
      }
      throw err;
    }
  }

  private static async scanAll(): Promise<ReconciliationOutcome[]> {
    try {
      return await Database.scan<ReconciliationOutcome>(config.dynamodb.reconciliationOutcomesTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(`ReconciliationOutcomes table ${config.dynamodb.reconciliationOutcomesTable} not found; returning empty.`);
        return [];
      }
      throw err;
    }
  }
}
