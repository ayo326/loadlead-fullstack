/**
 * Payout intercepts (garnishment, levy, lien).
 *
 * An intercept references a law-enforcement request and applies against a carrier
 * or a specific invoice/payout, with an instrument reference, an amount or a
 * percentage, a priority, and a routing instruction (hold, or redirect to the
 * named authority or lienholder). Intercepts are append-only and NEVER mutate the
 * underlying invoice or advance records: they are applied as routing outcomes at
 * settlement, recorded append-only, and only when the referencing request has a
 * recorded counsel sign-off. Every application is audited. All money is cents.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { applyBps, assertIntegerCents } from '../utils/money';
import { AdminAuditService } from './adminAuditService';
import { ReconciliationService } from './reconciliationService';
import { LawEnforcementService } from './lawEnforcementService';
import { ComplianceRole } from '../types/complianceRole';

export type InterceptInstruction = 'HOLD' | 'REDIRECT';
export type InterceptStatus = 'ACTIVE' | 'RELEASED';

export interface PayoutIntercept {
  interceptId: string; // 'intercept_...'
  requestId: string; // the law-enforcement request authorizing this
  targetType: 'CARRIER' | 'INVOICE';
  targetId: string;
  carrierId: string;
  instrumentRef: string; // the garnishment/levy/lien instrument reference
  amountCents?: number; // fixed amount, or
  percentageBps?: number; // a percentage of the payout (1 bps = 0.01%)
  priority: number; // lower applies first
  instruction: InterceptInstruction;
  redirectTo?: string; // authority or lienholder, for REDIRECT
  status: InterceptStatus;
  supersedesInterceptId?: string;
  actorId: string;
  at: number;
}

export interface CreateInterceptInput {
  requestId: string;
  targetType: 'CARRIER' | 'INVOICE';
  targetId: string;
  carrierId: string;
  instrumentRef: string;
  amountCents?: number;
  percentageBps?: number;
  priority?: number;
  instruction: InterceptInstruction;
  redirectTo?: string;
  actorId: string;
}

export interface InterceptApplication {
  interceptId: string;
  interceptedCents: number;
  instruction: InterceptInstruction;
  redirectTo?: string;
  outcomeId: string;
}

export interface ApplyResult {
  grossCarrierCents: number;
  interceptedCents: number;
  carrierNetCents: number;
  applications: InterceptApplication[];
}

export class PayoutInterceptService {
  static async create(input: CreateInterceptInput): Promise<PayoutIntercept> {
    if (!input.requestId) throw new Error('intercept: requestId is required');
    if (!input.instrumentRef) throw new Error('intercept: instrumentRef is required');
    if (input.amountCents == null && input.percentageBps == null) {
      throw new Error('intercept: amountCents or percentageBps is required');
    }
    if (input.amountCents != null) assertIntegerCents(input.amountCents, 'intercept amount');
    if (input.instruction === 'REDIRECT' && !input.redirectTo) {
      throw new Error('intercept: redirectTo is required for a REDIRECT instruction');
    }

    await AdminAuditService.record({
      actorId: input.actorId,
      actorRole: ComplianceRole.LAW_ENFORCEMENT_LIAISON,
      action: 'CREATE_PAYOUT_INTERCEPT',
      targetRefs: [`${input.targetType}:${input.targetId}`, input.carrierId],
      reason: `${input.instruction} per ${input.instrumentRef}`,
      authorityRef: input.requestId,
    });

    const intercept: PayoutIntercept = {
      interceptId: Helpers.generateId('intercept'),
      requestId: input.requestId,
      targetType: input.targetType,
      targetId: input.targetId,
      carrierId: input.carrierId,
      instrumentRef: input.instrumentRef,
      ...(input.amountCents != null ? { amountCents: input.amountCents } : {}),
      ...(input.percentageBps != null ? { percentageBps: input.percentageBps } : {}),
      priority: input.priority ?? 100,
      instruction: input.instruction,
      ...(input.redirectTo ? { redirectTo: input.redirectTo } : {}),
      status: 'ACTIVE',
      actorId: input.actorId,
      at: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.payoutInterceptsTable, intercept);
    return intercept;
  }

  /** Active intercepts for an invoice or its carrier (supersession-aware), by priority. */
  static async activeFor(invoiceId: string, carrierId: string): Promise<PayoutIntercept[]> {
    const all = await this.scanAll();
    const superseded = new Set(all.map((i) => i.supersedesInterceptId).filter(Boolean) as string[]);
    return all
      .filter((i) => !superseded.has(i.interceptId) && i.status === 'ACTIVE')
      .filter((i) => (i.targetType === 'INVOICE' ? i.targetId === invoiceId : i.carrierId === carrierId))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Apply active, counsel-signed-off intercepts to a carrier's gross payout at
   * settlement. Reduces or holds the carrier net by the intercepted amount and
   * routes the intercepted portion per each instruction, recording an append-only
   * INTERCEPT_APPLIED outcome per application. The remainder follows normal
   * routing. Underlying invoice/advance records are never mutated. Idempotent per
   * (intercept, invoice).
   */
  static async applyAtSettlement(input: {
    invoiceId: string;
    carrierId: string;
    grossCarrierCents: number;
    actorId: string;
  }): Promise<ApplyResult> {
    assertIntegerCents(input.grossCarrierCents, 'grossCarrierCents');
    let remaining = input.grossCarrierCents;
    let interceptedTotal = 0;
    const applications: InterceptApplication[] = [];

    for (const i of await this.activeFor(input.invoiceId, input.carrierId)) {
      // Counsel-gated: an intercept applies only with a recorded counsel sign-off.
      if (!(await LawEnforcementService.hasCounselSignOff(i.requestId))) continue;

      const requested = i.amountCents != null ? i.amountCents : applyBps(input.grossCarrierCents, i.percentageBps!);
      const intercepted = Math.min(remaining, requested);
      if (intercepted <= 0) continue;

      const outcome = await ReconciliationService.recordOutcome({
        invoiceId: input.invoiceId,
        carrierId: input.carrierId,
        type: 'INTERCEPT_APPLIED',
        amountCents: intercepted,
        note: `${i.instruction} ${i.redirectTo ? `to ${i.redirectTo} ` : ''}per ${i.instrumentRef} (request ${i.requestId})`,
        idempotencyKey: `intercept|${i.interceptId}|${input.invoiceId}`,
      });
      applications.push({
        interceptId: i.interceptId,
        interceptedCents: intercepted,
        instruction: i.instruction,
        ...(i.redirectTo ? { redirectTo: i.redirectTo } : {}),
        outcomeId: outcome.outcomeId,
      });
      remaining -= intercepted;
      interceptedTotal += intercepted;

      await AdminAuditService.record({
        actorId: input.actorId,
        actorRole: ComplianceRole.LAW_ENFORCEMENT_LIAISON,
        action: 'APPLY_PAYOUT_INTERCEPT',
        targetRefs: [i.interceptId, input.invoiceId, outcome.outcomeId],
        reason: `intercepted ${intercepted} cents`,
        authorityRef: i.requestId,
      });
    }

    return {
      grossCarrierCents: input.grossCarrierCents,
      interceptedCents: interceptedTotal,
      carrierNetCents: remaining,
      applications,
    };
  }

  // COA-3 phase 2 (deliberate): this stays a full-table scan, NOT a GSI query.
  // activeFor() resolves by EITHER invoiceId (INVOICE target) OR carrierId (CARRIER
  // target) AND needs a global supersession set - a single-attribute GSI cannot serve
  // that dual key, and a carrierId-index would silently miss an INVOICE-target
  // intercept whose carrierId differs from the settling carrier. On a garnishment/
  // levy path a missed intercept under-applies a legal order, so correctness wins.
  // Intercepts are rare (law-enforcement) and this table stays tiny; revisit only
  // with a dedicated invoiceId-index + carrierId-index pair if volume ever grows.
  private static async scanAll(): Promise<PayoutIntercept[]> {
    try {
      return await Database.scan<PayoutIntercept>(config.dynamodb.payoutInterceptsTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
  }
}
