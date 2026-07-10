/**
 * Funding advances (append-only).
 *
 * An advance is money fronted against a factorable invoice line. The hard
 * invariant: no advance is ever issued against an accessorial that is not
 * APPROVED. Advances are idempotent per (invoice, line): re-issuing the same line
 * returns the existing advance rather than duplicating it. Rows are never updated
 * or deleted.
 *
 * References the invoice, carrier, charge, and assignment by id. All money is
 * integer cents.
 */

import { createHash } from 'node:crypto';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { assertIntegerCents } from '../utils/money';
import type { PayeeType } from './payeeRoutingService';
import type { RecourseType, AssignmentScope } from './factoringAssignmentService';
import type { ChargeStatus } from './accessorialChargeService';

export type AdvanceLineKind = 'LINEHAUL' | 'ACCESSORIAL';

export interface FundingAdvance {
  advanceId: string; // 'advance_...'
  invoiceId: string;
  carrierId: string;
  lineKind: AdvanceLineKind;
  chargeId?: string; // present for accessorial lines
  amountCents: number;
  payeeType: PayeeType;
  destination: string;
  providerName: string;
  providerRef?: string;
  recourseType: RecourseType;
  scope: AssignmentScope;
  assignmentId?: string;
  idempotencyKey: string;
  issuedAt: number;
}

export interface IssueAdvanceInput {
  invoiceId: string;
  carrierId: string;
  lineKind: AdvanceLineKind;
  chargeId?: string;
  /** The line's charge status; required for accessorial lines to enforce APPROVED. */
  chargeStatus?: ChargeStatus;
  amountCents: number;
  payeeType: PayeeType;
  destination: string;
  providerName: string;
  providerRef?: string;
  recourseType: RecourseType;
  scope: AssignmentScope;
  assignmentId?: string;
}

function advanceKey(invoiceId: string, lineKind: AdvanceLineKind, chargeId?: string): string {
  return createHash('sha256').update(`${invoiceId}|${lineKind}|${chargeId ?? 'LINEHAUL'}`, 'utf8').digest('hex').slice(0, 32);
}

/** A conditional-put failure - a concurrent write won the idempotent insert. */
function isConditionFailure(err: any): boolean {
  return err?.name === 'ConditionalCheckFailedException' || err?.name === 'TransactionCanceledException';
}

/** A query against a GSI that isn't created yet (fall back to a scan until live). */
function isMissingIndex(err: any): boolean {
  return err?.name === 'ValidationException' && /index/i.test(String(err?.message ?? ''));
}

export class FundingAdvanceService {
  /**
   * Issue an advance against a factorable line. Throws if an accessorial line is
   * not APPROVED (the hard invariant). Idempotent per (invoice, line).
   */
  static async issueAdvance(input: IssueAdvanceInput): Promise<FundingAdvance> {
    if (input.lineKind === 'ACCESSORIAL') {
      if (!input.chargeId) throw new Error('advance: accessorial line requires a chargeId');
      if (input.chargeStatus !== 'APPROVED') {
        throw new Error(
          `ADVANCE_REQUIRES_APPROVED: cannot advance accessorial ${input.chargeId} in status ${input.chargeStatus}`
        );
      }
    }
    assertIntegerCents(input.amountCents, 'advance amount');
    if (input.amountCents <= 0) throw new Error('advance: amount must be > 0');

    const key = advanceKey(input.invoiceId, input.lineKind, input.chargeId);
    const advance: FundingAdvance = {
      // Deterministic id from the idempotency key, so a concurrent duplicate
      // loses the conditional put below rather than both inserting (a
      // scan-then-put would double-advance the line).
      advanceId: `advance_${key}`,
      invoiceId: input.invoiceId,
      carrierId: input.carrierId,
      lineKind: input.lineKind,
      ...(input.chargeId ? { chargeId: input.chargeId } : {}),
      amountCents: input.amountCents,
      payeeType: input.payeeType,
      destination: input.destination,
      providerName: input.providerName,
      ...(input.providerRef ? { providerRef: input.providerRef } : {}),
      recourseType: input.recourseType,
      scope: input.scope,
      ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
      idempotencyKey: key,
      issuedAt: Helpers.getCurrentTimestamp(),
    };
    try {
      await Database.putItem(config.dynamodb.fundingAdvancesTable, advance, {
        conditionExpression: 'attribute_not_exists(advanceId)',
      });
      return advance;
    } catch (err) {
      if (isConditionFailure(err)) {
        const existing = await Database.getItem<FundingAdvance>(
          config.dynamodb.fundingAdvancesTable,
          { advanceId: advance.advanceId }
        );
        if (existing) return existing; // idempotent: never double-advance a line
      }
      throw err;
    }
  }

  static async listForInvoice(invoiceId: string): Promise<FundingAdvance[]> {
    // V2-M1: query the invoiceId GSI; fall back to a filtered scan until it's live.
    let rows: FundingAdvance[] | undefined;
    if (typeof Database.query === 'function') {
      try {
        rows = await Database.query<FundingAdvance>(
          config.dynamodb.fundingAdvancesTable, 'invoiceId-index', '#i = :i', { '#i': 'invoiceId' }, { ':i': invoiceId }
        );
      } catch (err: any) {
        if (err?.name === 'ResourceNotFoundException') return [];
        if (!isMissingIndex(err)) throw err;
      }
    }
    if (!rows) rows = (await this.scanAll()).filter((a) => a.invoiceId === invoiceId);
    return rows.sort((a, b) => a.issuedAt - b.issuedAt);
  }

  static async getForLine(invoiceId: string, lineKind: AdvanceLineKind, chargeId?: string): Promise<FundingAdvance | null> {
    // The advanceId is deterministic (advance_<key>), so this is a direct point
    // read - no table scan needed.
    const key = advanceKey(invoiceId, lineKind, chargeId);
    return Database.getItem<FundingAdvance>(config.dynamodb.fundingAdvancesTable, { advanceId: `advance_${key}` });
  }

  /** Advances issued against a specific accessorial charge (audit v4 M6). */
  static async listForCharge(chargeId: string): Promise<FundingAdvance[]> {
    return (await this.scanAll()).filter((a) => a.chargeId === chargeId);
  }

  private static async scanAll(): Promise<FundingAdvance[]> {
    try {
      return await Database.scan<FundingAdvance>(config.dynamodb.fundingAdvancesTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(`FundingAdvances table ${config.dynamodb.fundingAdvancesTable} not found; returning empty.`);
        return [];
      }
      throw err;
    }
  }
}
