/**
 * Dispute and discrepancy adjudication.
 *
 * A DISPUTE_ADMIN may uphold, reverse, adjust, or escalate. Adjudication NEVER
 * mutates or deletes an original pipeline record: it writes an append-only
 * adjudication outcome, and where money must change it writes a compensating
 * reconciliation entry (a new offsetting row). A charge dispute is resolved
 * through the existing charge lifecycle (approve/adjust), not by direct edit.
 *
 * Every adjudication is audited first (fail closed): the admin audit entry is
 * written before the adjudication, so nothing happens if the audit cannot record.
 * All money is integer cents.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { assertIntegerCents } from '../utils/money';
import { AdminAuditService } from './adminAuditService';
import { ReconciliationService } from './reconciliationService';
import { ComplianceRole } from '../types/complianceRole';

export type AdjudicationAction = 'UPHOLD' | 'REVERSE' | 'ADJUST' | 'ESCALATE';
export type AdjudicationTargetType = 'CHARGE_DISPUTE' | 'RECOURSE_BUYBACK' | 'DISCREPANCY';

export interface Adjudication {
  adjudicationId: string; // 'adj_...'
  targetType: AdjudicationTargetType;
  targetId: string; // the disputed charge id, buyback outcome id, or discrepancy code+ref
  invoiceId?: string;
  carrierId?: string;
  action: AdjudicationAction;
  reason: string;
  actorId: string;
  /** Set when the adjudication produced a compensating reconciliation entry. */
  compensatingOutcomeId?: string;
  at: number;
}

export interface AdjudicateInput {
  actorId: string;
  targetType: AdjudicationTargetType;
  targetId: string;
  action: AdjudicationAction;
  reason: string;
  invoiceId?: string;
  carrierId?: string;
  /** When money must change, the compensating amount (cents) and a note. */
  compensation?: { amountCents: number; note?: string };
}

export class AdjudicationService {
  /**
   * Record an adjudication. Audited first (fail closed). Writes an append-only
   * adjudication row and, when a compensation amount is given, a compensating
   * reconciliation entry. Originals are never touched.
   */
  static async adjudicate(input: AdjudicateInput): Promise<Adjudication> {
    if (!input.actorId) throw new Error('adjudicate: actorId is required');
    if (!input.reason) throw new Error('adjudicate: reason is required');

    // Audit first: if this throws, nothing below runs.
    await AdminAuditService.record({
      actorId: input.actorId,
      actorRole: ComplianceRole.DISPUTE_ADMIN,
      action: `ADJUDICATE_${input.action}`,
      targetRefs: [input.targetId, ...(input.invoiceId ? [input.invoiceId] : [])],
      reason: input.reason,
    });

    let compensatingOutcomeId: string | undefined;
    if (input.compensation && (input.action === 'REVERSE' || input.action === 'ADJUST')) {
      assertIntegerCents(input.compensation.amountCents, 'compensation amount');
      if (!input.invoiceId || !input.carrierId) {
        throw new Error('adjudicate: invoiceId and carrierId are required for a compensating entry');
      }
      const outcome = await ReconciliationService.recordOutcome({
        invoiceId: input.invoiceId,
        carrierId: input.carrierId,
        type: 'ADJUDICATION_COMPENSATION',
        amountCents: input.compensation.amountCents,
        chargeId: input.targetType === 'CHARGE_DISPUTE' ? input.targetId : undefined,
        note: `adjudication ${input.action}: ${input.compensation.note ?? input.reason}`,
        idempotencyKey: `adjcomp|${input.targetId}|${input.action}`,
      });
      compensatingOutcomeId = outcome.outcomeId;
    }

    const adjudication: Adjudication = {
      adjudicationId: Helpers.generateId('adj'),
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      ...(input.carrierId ? { carrierId: input.carrierId } : {}),
      action: input.action,
      reason: input.reason,
      actorId: input.actorId,
      ...(compensatingOutcomeId ? { compensatingOutcomeId } : {}),
      at: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.adjudicationsTable, adjudication);
    return adjudication;
  }

  /** All adjudications for a target, newest first. Append-only history. */
  static async listForTarget(targetId: string): Promise<Adjudication[]> {
    return (await this.scanAll()).filter((a) => a.targetId === targetId).sort((a, b) => b.at - a.at);
  }

  /** All adjudications referencing an invoice, newest first. */
  static async listForInvoice(invoiceId: string): Promise<Adjudication[]> {
    return (await this.scanAll()).filter((a) => a.invoiceId === invoiceId).sort((a, b) => b.at - a.at);
  }

  private static async scanAll(): Promise<Adjudication[]> {
    try {
      return await Database.scan<Adjudication>(config.dynamodb.adjudicationsTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
  }
}
