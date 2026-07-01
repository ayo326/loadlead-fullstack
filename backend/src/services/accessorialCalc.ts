/**
 * Accessorial calculation engine (pure, deterministic, integer cents).
 *
 * Given the immutable arrival and departure times (Phase 4) and a frozen policy
 * snapshot (Phase 3), it computes either a DETENTION or a LAYOVER charge, never
 * both, so the same hours are never billed twice.
 *
 *  dwell            = departure - arrival, in whole minutes
 *  if dwell > layoverThreshold:
 *      LAYOVER  = ceil(dwell / 1440) started 24h periods * layoverDailyRateCents
 *      (detention stops accruing once layover takes over)
 *  else:
 *      detained = max(0, dwell - freeTime), rounded UP to billingIncrement
 *      DETENTION = round(detained / 60 * detentionHourlyRateCents[rateClass])
 *
 * Optional per-load caps clamp the amount. All money is integer cents.
 */

import type { AccessorialPolicy, AccessorialRateClass, AccessorialCaps } from '../config/accessorialPolicy';
import { assertIntegerCents } from '../utils/money';

export type AccessorialChargeType = 'DETENTION' | 'LAYOVER';

export interface AccessorialComputation {
  type: AccessorialChargeType;
  dwellMinutes: number;
  /** Rounded billable detention minutes (0 for layover). */
  detainedMinutes: number;
  /** Started 24-hour periods (0 for detention). */
  layoverDays: number;
  rateClass: AccessorialRateClass;
  /** Hourly rate (detention) or daily rate (layover) used, in cents. */
  rateCents: number;
  amountCents: number;
  /** true when a per-load cap clamped the amount. */
  capped: boolean;
}

/** Whole minutes between two epoch-ms timestamps. Departure must not precede arrival. */
export function dwellMinutesBetween(arrivalAt: number, departureAt: number): number {
  if (!Number.isFinite(arrivalAt) || !Number.isFinite(departureAt)) {
    throw new Error('accessorialCalc: arrival and departure must be finite timestamps');
  }
  if (departureAt < arrivalAt) {
    throw new Error('accessorialCalc: departure must be at or after arrival');
  }
  return Math.floor((departureAt - arrivalAt) / 60000);
}

function roundUpTo(value: number, increment: number): number {
  if (increment <= 0) return value;
  return Math.ceil(value / increment) * increment;
}

/**
 * Compute the accessorial for a dwell expressed in whole minutes. Separated from
 * the timestamp form so callers can compute a provisional amount for an open stop
 * (dwell so far) without faking a departure time.
 */
export function computeAccessorialFromDwell(
  dwellMinutes: number,
  rateClass: AccessorialRateClass,
  policy: AccessorialPolicy,
  caps?: AccessorialCaps
): AccessorialComputation {
  if (!Number.isInteger(dwellMinutes) || dwellMinutes < 0) {
    throw new Error(`accessorialCalc: dwellMinutes must be a non-negative integer, got ${dwellMinutes}`);
  }

  if (dwellMinutes > policy.layoverThresholdMinutes) {
    const layoverDays = Math.ceil(dwellMinutes / 1440);
    const rateCents = policy.layoverDailyRateCents;
    let amountCents = layoverDays * rateCents;
    let capped = false;
    if (caps?.layoverMaxCents != null && amountCents > caps.layoverMaxCents) {
      amountCents = caps.layoverMaxCents;
      capped = true;
    }
    assertIntegerCents(amountCents, 'layover amount');
    return { type: 'LAYOVER', dwellMinutes, detainedMinutes: 0, layoverDays, rateClass, rateCents, amountCents, capped };
  }

  const rawDetained = Math.max(0, dwellMinutes - policy.freeTimeMinutes);
  const detainedMinutes = roundUpTo(rawDetained, policy.billingIncrementMinutes);
  const rateCents = policy.detentionHourlyRateCents[rateClass];
  let amountCents = Math.round((detainedMinutes * rateCents) / 60);
  let capped = false;
  if (caps?.detentionMaxCents != null && amountCents > caps.detentionMaxCents) {
    amountCents = caps.detentionMaxCents;
    capped = true;
  }
  assertIntegerCents(amountCents, 'detention amount');
  return { type: 'DETENTION', dwellMinutes, detainedMinutes, layoverDays: 0, rateClass, rateCents, amountCents, capped };
}

/** Compute the accessorial from arrival and departure timestamps. */
export function computeAccessorial(
  arrivalAt: number,
  departureAt: number,
  rateClass: AccessorialRateClass,
  policy: AccessorialPolicy,
  caps?: AccessorialCaps
): AccessorialComputation {
  return computeAccessorialFromDwell(dwellMinutesBetween(arrivalAt, departureAt), rateClass, policy, caps);
}
