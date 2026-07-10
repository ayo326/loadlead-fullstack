/**
 * Accessorial charge ledger and lifecycle.
 *
 * One charge per (stop, frozen policy snapshot), addressed by a deterministic
 * chargeId so recomputing a stop updates the charge in place rather than
 * inserting a duplicate. The charge row carries the current status and amount;
 * every status transition is also written to an append-only status-history store
 * (charge_status_history), so the audit trail is immutable even though the live
 * row is upserted.
 *
 * Money invariant: only APPROVED and SETTLED charges affect money (isBillable).
 * No-double-bill invariant: a stop yields either a DETENTION or a LAYOVER charge,
 * never both (enforced in accessorialCalc).
 *
 * References the load + stop by id only; the Load model is never touched.
 */

import { createHash } from 'node:crypto';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { assertIntegerCents } from '../utils/money';
import { AccessorialPolicyService, PolicySnapshot } from './accessorialPolicyService';
import { StopEventService } from './stopEventService';
import { BetaTrustEventService } from './betaTrustEventService';
import {
  AccessorialChargeType,
  AccessorialComputation,
  computeAccessorial,
  computeAccessorialFromDwell,
} from './accessorialCalc';
import type { AccessorialRateClass } from '../config/accessorialPolicy';

export type ChargeStatus =
  | 'ACCRUING'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'SETTLED'
  | 'DISPUTED'
  | 'ADJUSTED';

export interface AccessorialCharge {
  chargeId: string; // deterministic: 'charge_' + sha256(loadId|stopId|policyHash)
  loadId: string;
  stopId: string;
  type: AccessorialChargeType;
  status: ChargeStatus;
  dwellMinutes: number;
  /** Rounded billable detention minutes (0 for layover). */
  billableMinutes: number;
  layoverDays: number;
  rateClass: AccessorialRateClass;
  rateCents: number; // rate snapshot used
  amountCents: number;
  policyVersion: number;
  policyHash: string;
  policySnapshot: PolicySnapshot; // frozen policy at compute time
  arrivalEventId?: string;
  departureEventId?: string;
  /** true while the stop is still open (amount is provisional). */
  provisional: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChargeStatusHistory {
  historyId: string; // 'chghist_...'
  chargeId: string;
  loadId: string;
  fromStatus: ChargeStatus | 'NONE';
  toStatus: ChargeStatus;
  amountCentsBefore?: number;
  amountCentsAfter?: number;
  reason?: string;
  actorId: string;
  recordedAt: number;
}

export type LoadForCharge = { loadId: string; hazmat?: boolean; equipmentType: any };

/** Charges that move money. Only APPROVED and SETTLED affect settlement and advances. */
export function isBillable(charge: Pick<AccessorialCharge, 'status'>): boolean {
  return charge.status === 'APPROVED' || charge.status === 'SETTLED';
}

function deterministicChargeId(loadId: string, stopId: string, policyHash: string): string {
  const h = createHash('sha256').update(`${loadId}|${stopId}|${policyHash}`, 'utf8').digest('hex').slice(0, 32);
  return `charge_${h}`;
}

/** Status reached when a closed stop's amount is computed. */
function closedStatusFor(comp: AccessorialComputation, detentionAutoApproveMaxHours: number): ChargeStatus {
  if (comp.type === 'LAYOVER') return 'PENDING_REVIEW'; // layover always routes to review
  const detainedHours = comp.detainedMinutes / 60;
  return detainedHours <= detentionAutoApproveMaxHours ? 'APPROVED' : 'PENDING_REVIEW';
}

export class AccessorialChargeService {
  static async getCharge(chargeId: string): Promise<AccessorialCharge | null> {
    try {
      return await Database.getItem<AccessorialCharge>(config.dynamodb.accessorialChargesTable, { chargeId });
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return null;
      throw err;
    }
  }

  static async listForLoad(loadId: string): Promise<AccessorialCharge[]> {
    let rows: AccessorialCharge[];
    try {
      rows = await Database.scan<AccessorialCharge>(config.dynamodb.accessorialChargesTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
    return rows.filter((c) => c.loadId === loadId).sort((a, b) => a.createdAt - b.createdAt);
  }

  static async history(chargeId: string): Promise<ChargeStatusHistory[]> {
    let rows: ChargeStatusHistory[];
    try {
      rows = await Database.scan<ChargeStatusHistory>(config.dynamodb.chargeStatusHistoryTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
    return rows.filter((h) => h.chargeId === chargeId).sort((a, b) => a.recordedAt - b.recordedAt);
  }

  /**
   * Compute (or recompute) the accessorial for a stop. Idempotent: the same
   * arrival, departure, and policy snapshot produce the same chargeId and the
   * same amount, so a recompute is an in-place no-op and writes no new history.
   * Returns null when the stop has no arrival yet.
   */
  static async computeForStop(load: LoadForCharge, stopId: string, actorId: string): Promise<AccessorialCharge | null> {
    const snapshot = await AccessorialPolicyService.snapshotForLoad(load);
    const pair = await StopEventService.effectivePair(load.loadId, stopId);
    if (!pair.arrival) return null;

    const chargeId = deterministicChargeId(load.loadId, stopId, snapshot.policyHash);
    const existing = await this.getCharge(chargeId);

    const open = !pair.departure;
    // Never regress an already-closed charge back to ACCRUING.
    if (open && existing && existing.status !== 'ACCRUING') {
      return existing;
    }

    let comp: AccessorialComputation;
    let status: ChargeStatus;
    if (open) {
      const dwellSoFar = Math.max(0, Math.floor((Helpers.getCurrentTimestamp() - pair.arrival.eventAt) / 60000));
      comp = computeAccessorialFromDwell(dwellSoFar, snapshot.rateClass, snapshot.policy, snapshot.caps);
      status = 'ACCRUING';
    } else {
      comp = computeAccessorial(pair.arrival.eventAt, pair.departure!.eventAt, snapshot.rateClass, snapshot.policy, snapshot.caps);
      status = closedStatusFor(comp, snapshot.policy.detentionAutoApproveMaxHours);
    }
    assertIntegerCents(comp.amountCents, 'charge amount');

    // If a closed charge is already in a human-driven state (approved, settled,
    // disputed, adjusted), do not overwrite that decision on recompute; only the
    // amount/computation fields are authoritative up to PENDING_REVIEW.
    const preserveStatus =
      existing && !open && ['APPROVED', 'SETTLED', 'DISPUTED', 'ADJUSTED'].includes(existing.status);
    const finalStatus: ChargeStatus = preserveStatus ? existing!.status : status;

    const now = Helpers.getCurrentTimestamp();
    const charge: AccessorialCharge = {
      chargeId,
      loadId: load.loadId,
      stopId,
      type: comp.type,
      status: finalStatus,
      dwellMinutes: comp.dwellMinutes,
      billableMinutes: comp.detainedMinutes,
      layoverDays: comp.layoverDays,
      rateClass: comp.rateClass,
      rateCents: comp.rateCents,
      amountCents: preserveStatus ? existing!.amountCents : comp.amountCents,
      policyVersion: snapshot.version,
      policyHash: snapshot.policyHash,
      policySnapshot: snapshot,
      ...(pair.arrival ? { arrivalEventId: pair.arrival.eventId } : {}),
      ...(pair.departure ? { departureEventId: pair.departure.eventId } : {}),
      provisional: open,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const statusChanged = !existing || existing.status !== charge.status;
    await Database.putItem(config.dynamodb.accessorialChargesTable, charge);
    if (statusChanged) {
      await this.recordHistory({
        chargeId,
        loadId: load.loadId,
        fromStatus: existing?.status ?? 'NONE',
        toStatus: charge.status,
        amountCentsAfter: charge.amountCents,
        reason: open ? 'accruing' : 'computed on stop close',
        actorId,
      });
    }
    return charge;
  }

  /** Shipper approves a charge. PENDING_REVIEW or ADJUSTED -> APPROVED. Idempotent. */
  static async approve(chargeId: string, actorId: string): Promise<AccessorialCharge> {
    const charge = await this.requireCharge(chargeId);
    if (charge.status === 'APPROVED') return charge;
    this.assertTransition(charge.status, 'APPROVED');
    return this.transition(charge, 'APPROVED', actorId, 'shipper approved');
  }

  /**
   * Shipper adjusts a charge to a new amount. Records the original and new amounts
   * in the append-only history; the charge moves to ADJUSTED (pending re-approval).
   */
  static async adjust(chargeId: string, newAmountCents: number, actorId: string, reason?: string): Promise<AccessorialCharge> {
    assertIntegerCents(newAmountCents, 'adjusted amount');
    if (newAmountCents < 0) throw new Error('adjust: amount must be >= 0');
    const charge = await this.requireCharge(chargeId);
    this.assertTransition(charge.status, 'ADJUSTED');
    const before = charge.amountCents;
    const updated: AccessorialCharge = { ...charge, status: 'ADJUSTED', amountCents: newAmountCents, updatedAt: Helpers.getCurrentTimestamp() };
    await Database.putItem(config.dynamodb.accessorialChargesTable, updated);
    await this.recordHistory({
      chargeId,
      loadId: charge.loadId,
      fromStatus: charge.status,
      toStatus: 'ADJUSTED',
      amountCentsBefore: before,
      amountCentsAfter: newAmountCents,
      reason: reason ?? 'shipper adjusted',
      actorId,
    });
    await this.flagAdvancesAtRisk(chargeId, 'ADJUSTED');
    return updated;
  }

  /**
   * Audit v4 M6: an advance may already have been issued against this charge
   * while it was APPROVED. A regression to DISPUTED/ADJUSTED must surface the
   * money-at-risk explicitly (append-only ADVANCE_AT_RISK outcome) instead of
   * leaving reconciliation to discover it by accident. Best-effort: the
   * shipper's action must not fail because the flag could not be written.
   * Lazy import avoids a static charge->reconciliation->charge type cycle
   * becoming a runtime one.
   */
  private static async flagAdvancesAtRisk(chargeId: string, statusNow: string): Promise<void> {
    try {
      const { ReconciliationService } = await import('./reconciliationService');
      await ReconciliationService.flagAdvancesAtRiskForCharge(chargeId, statusNow);
    } catch (err) {
      Logger.error(`failed to flag advances at risk for charge ${chargeId}`, err);
    }
  }

  /**
   * Shipper disputes a charge. Moves to DISPUTED and raises a trust event against
   * the mover. carrierId identifies the mover for the trust signal.
   */
  static async dispute(chargeId: string, actorId: string, carrierId: string, reason?: string): Promise<AccessorialCharge> {
    const charge = await this.requireCharge(chargeId);
    if (charge.status === 'DISPUTED') return charge;
    this.assertTransition(charge.status, 'DISPUTED');
    const updated = await this.transition(charge, 'DISPUTED', actorId, reason ?? 'shipper disputed');
    try {
      await BetaTrustEventService.record({
        eventType: 'TRUST_INCIDENT',
        loadId: charge.loadId,
        carrierId,
        recordedByAdminId: actorId,
        note: `accessorial dispute on charge ${chargeId}${reason ? `: ${reason}` : ''}`,
      });
    } catch (err) {
      Logger.error('failed to record trust event for accessorial dispute', err);
    }
    await this.flagAdvancesAtRisk(chargeId, 'DISPUTED');
    return updated;
  }

  /** Settlement marks an approved charge SETTLED once money has moved (Phase 10). */
  static async markSettled(chargeId: string, actorId: string): Promise<AccessorialCharge> {
    const charge = await this.requireCharge(chargeId);
    if (charge.status === 'SETTLED') return charge;
    this.assertTransition(charge.status, 'SETTLED');
    return this.transition(charge, 'SETTLED', actorId, 'settled');
  }

  // ── internals ────────────────────────────────────────────────────────────

  private static async requireCharge(chargeId: string): Promise<AccessorialCharge> {
    const charge = await this.getCharge(chargeId);
    if (!charge) throw new Error(`charge not found: ${chargeId}`);
    return charge;
  }

  private static async transition(
    charge: AccessorialCharge,
    to: ChargeStatus,
    actorId: string,
    reason: string
  ): Promise<AccessorialCharge> {
    const updated: AccessorialCharge = { ...charge, status: to, updatedAt: Helpers.getCurrentTimestamp() };
    await Database.putItem(config.dynamodb.accessorialChargesTable, updated);
    await this.recordHistory({
      chargeId: charge.chargeId,
      loadId: charge.loadId,
      fromStatus: charge.status,
      toStatus: to,
      amountCentsAfter: updated.amountCents,
      reason,
      actorId,
    });
    return updated;
  }

  private static assertTransition(from: ChargeStatus, to: ChargeStatus): void {
    const allowed: Record<ChargeStatus, ChargeStatus[]> = {
      ACCRUING: ['PENDING_REVIEW', 'APPROVED'],
      PENDING_REVIEW: ['APPROVED', 'ADJUSTED', 'DISPUTED'],
      APPROVED: ['SETTLED', 'ADJUSTED', 'DISPUTED'],
      ADJUSTED: ['APPROVED', 'DISPUTED'],
      DISPUTED: ['APPROVED', 'ADJUSTED'],
      SETTLED: [],
    };
    if (!allowed[from]?.includes(to)) {
      throw new Error(`invalid charge transition: ${from} -> ${to}`);
    }
  }

  private static async recordHistory(
    input: Omit<ChargeStatusHistory, 'historyId' | 'recordedAt'>
  ): Promise<ChargeStatusHistory> {
    const row: ChargeStatusHistory = {
      historyId: Helpers.generateId('chghist'),
      recordedAt: Helpers.getCurrentTimestamp(),
      ...input,
    };
    await Database.putItem(config.dynamodb.chargeStatusHistoryTable, row);
    return row;
  }
}
