/**
 * Platform fee policy service.
 *
 * The live linehaul take rate lives in an append-only store
 * (LoadLead_PlatformFeePolicy). Every change is a new row with an actor and a
 * timestamp; rows are never updated or deleted, so the policy has a full audit
 * trail. The current policy is the most recently recorded change; when nothing
 * has been recorded the seeded default (config/platformFee.ts PLATFORM_FEE_POLICY)
 * is used, so a fresh environment behaves as if the beta waiver were recorded on
 * day one.
 *
 * resolveEffectiveTakeRateBps is the single resolver the rest of the system goes
 * through to learn the take rate: while the waiver is on it returns 0; otherwise
 * it returns linehaulTakeRateBps, less an optional per-account discount. All money
 * is computed in integer cents via utils/money.
 *
 * This mirrors the append-only, table-tolerant pattern of betaTrustEventService.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { applyBps, assertIntegerCents } from '../utils/money';
import {
  PLATFORM_FEE_POLICY,
  PlatformFeePolicy,
  MIN_TAKE_RATE_BPS,
  MAX_TAKE_RATE_BPS,
} from '../config/platformFee';

/** One append-only policy-change row. The current policy is the newest of these. */
export interface PlatformFeePolicyChange {
  changeId: string; // 'feepol_...'
  linehaulTakeRateBps: number;
  betaFeeWaiver: boolean;
  actorId: string; // who recorded the change (admin user id, or 'system')
  recordedAt: number; // epoch ms
  note?: string;
}

export interface RecordPolicyChangeInput {
  linehaulTakeRateBps: number;
  betaFeeWaiver: boolean;
  actorId: string;
  note?: string;
}

/** Result of splitting a gross linehaul into platform fee and carrier net, in cents. */
export interface LinehaulSettlement {
  grossLinehaulCents: number;
  effectiveTakeRateBps: number;
  platformFeeCents: number;
  carrierNetCents: number;
}

export interface ResolveTakeRateOptions {
  /** A policy already loaded by the caller; avoids a second store read. */
  policy?: PlatformFeePolicy;
  /**
   * Optional per-account discount in basis points subtracted from the base take
   * rate (floored at 0). Has no effect while the waiver is on (rate is already 0).
   */
  accountDiscountBps?: number;
}

function validateTakeRateBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < MIN_TAKE_RATE_BPS || bps > MAX_TAKE_RATE_BPS) {
    throw new Error(
      `platformFee: linehaulTakeRateBps must be an integer in [${MIN_TAKE_RATE_BPS}, ${MAX_TAKE_RATE_BPS}], got ${bps}`
    );
  }
}

export class PlatformFeeService {
  /**
   * The live fee policy: the newest recorded change, or the seeded default when
   * none has been recorded (or the table does not exist yet).
   */
  static async getCurrentPolicy(): Promise<PlatformFeePolicy> {
    const changes = await this.scanAll();
    if (changes.length === 0) {
      return { ...PLATFORM_FEE_POLICY };
    }
    const latest = changes.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
    return {
      linehaulTakeRateBps: latest.linehaulTakeRateBps,
      betaFeeWaiver: latest.betaFeeWaiver,
    };
  }

  /** Record an append-only policy change. Validates the rate before writing. */
  static async recordPolicyChange(input: RecordPolicyChangeInput): Promise<PlatformFeePolicyChange> {
    validateTakeRateBps(input.linehaulTakeRateBps);
    if (typeof input.betaFeeWaiver !== 'boolean') {
      throw new Error('platformFee: betaFeeWaiver must be a boolean');
    }
    if (!input.actorId) {
      throw new Error('platformFee: actorId is required to record a policy change');
    }

    const change: PlatformFeePolicyChange = {
      changeId: Helpers.generateId('feepol'),
      linehaulTakeRateBps: input.linehaulTakeRateBps,
      betaFeeWaiver: input.betaFeeWaiver,
      actorId: input.actorId,
      recordedAt: Helpers.getCurrentTimestamp(),
      ...(input.note ? { note: input.note } : {}),
    };

    await Database.putItem(config.dynamodb.platformFeePolicyTable, change);
    return change;
  }

  /** Full append-only history, newest first. */
  static async history(): Promise<PlatformFeePolicyChange[]> {
    const changes = await this.scanAll();
    return changes.sort((a, b) => b.recordedAt - a.recordedAt);
  }

  /**
   * The single resolver for the effective linehaul take rate, in basis points.
   * Waiver on -> 0. Waiver off -> linehaulTakeRateBps less an optional per-account
   * discount, floored at 0. Pure given the policy passed in (or loads the live one).
   */
  static async resolveEffectiveTakeRateBps(opts: ResolveTakeRateOptions = {}): Promise<number> {
    const policy = opts.policy ?? (await this.getCurrentPolicy());
    if (policy.betaFeeWaiver) return 0;
    const base = policy.linehaulTakeRateBps;
    const discount = opts.accountDiscountBps ?? 0;
    if (!Number.isInteger(discount) || discount < 0) {
      throw new Error(`platformFee: accountDiscountBps must be a non-negative integer, got ${discount}`);
    }
    return Math.max(0, base - discount);
  }

  /**
   * Split a gross linehaul amount (integer cents) into the platform fee and the
   * carrier's net, routed through the effective-take-rate resolver. While the
   * waiver is on the fee is 0 and the carrier nets the full gross. Idempotent and
   * deterministic for a given gross + policy.
   */
  static async computeLinehaulSettlement(
    grossLinehaulCents: number,
    opts: ResolveTakeRateOptions = {}
  ): Promise<LinehaulSettlement> {
    assertIntegerCents(grossLinehaulCents, 'grossLinehaulCents');
    if (grossLinehaulCents < 0) {
      throw new Error(`platformFee: grossLinehaulCents must be >= 0, got ${grossLinehaulCents}`);
    }
    const effectiveTakeRateBps = await this.resolveEffectiveTakeRateBps(opts);
    const platformFeeCents = applyBps(grossLinehaulCents, effectiveTakeRateBps);
    const carrierNetCents = grossLinehaulCents - platformFeeCents;
    return { grossLinehaulCents, effectiveTakeRateBps, platformFeeCents, carrierNetCents };
  }

  /**
   * Scan the store, tolerating a not-yet-created table (mirrors
   * betaTrustEventService). A missing table means "no changes recorded", which
   * getCurrentPolicy reads as the seeded default rather than failing the caller.
   */
  private static async scanAll(): Promise<PlatformFeePolicyChange[]> {
    try {
      return await Database.scan<PlatformFeePolicyChange>(config.dynamodb.platformFeePolicyTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(
          `PlatformFeePolicy table ${config.dynamodb.platformFeePolicyTable} not found; ` +
            `using the seeded default policy. Apply the Terraform that creates it.`
        );
        return [];
      }
      throw err;
    }
  }
}
