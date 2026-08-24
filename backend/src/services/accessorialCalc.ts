/**
 * Accessorial calculation engine (pure, deterministic, integer cents).
 *
 * Detention is a PENALTY that accrues per hour once the free-time grace is used
 * up. Layover is an ADDITIONAL, escalating penalty for multi-day holds: it is
 * billed ON TOP of the first-window detention, never in place of it. Keeping the
 * detention that already accrued makes the total charge monotonic non-decreasing
 * in dwell - a longer hold can never cost less than a shorter one. (Audit v8 F1;
 * the prior model discarded detention at the threshold and could bill far LESS
 * for a longer hold.)
 *
 *   dwell        = departure - arrival, in whole minutes
 *   detention(d) = round( roundUp(max(0, d - freeTime), increment) / 60 * hourlyRate[class] )
 *
 *   if dwell <= layoverThreshold:
 *       charge = detention(dwell)                                   type DETENTION
 *   else:
 *       charge = detention(layoverThreshold)          first-window penalty, frozen
 *              + ceil((dwell - layoverThreshold) / 1440) * layoverDailyRate
 *                                                                    type LAYOVER
 *
 * The two components are reported separately (detentionCents / layoverCents) and
 * summed into amountCents. Optional per-load caps clamp each component. All money
 * is integer cents.
 */

import type { AccessorialPolicy, AccessorialRateClass, AccessorialCaps } from '../config/accessorialPolicy';
import { assertIntegerCents } from '../utils/money';

export type AccessorialChargeType = 'DETENTION' | 'LAYOVER';

export interface AccessorialComputation {
  /** DETENTION when the hold stays within the layover threshold; LAYOVER once it
   *  crosses into the multi-day regime (which still includes the frozen detention). */
  type: AccessorialChargeType;
  dwellMinutes: number;
  /** Billable detention minutes (capped at the threshold window for a LAYOVER charge). */
  detainedMinutes: number;
  /** Started 24-hour periods billed BEYOND the layover threshold (0 for detention). */
  layoverDays: number;
  rateClass: AccessorialRateClass;
  /** Marginal rate used: hourly (detention) or daily (layover), in cents. */
  rateCents: number;
  /** Detention penalty component, integer cents (>= 0). */
  detentionCents: number;
  /** Layover surcharge component, integer cents (0 when within the threshold). */
  layoverCents: number;
  /** detentionCents + layoverCents. */
  amountCents: number;
  /** true when a per-load cap clamped either component. */
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
 * Detention penalty for a dwell (whole minutes), integer cents. Monotonic
 * non-decreasing in dwell. Clamped by the optional per-load detention cap.
 */
function detentionFor(
  dwellMinutes: number,
  rateClass: AccessorialRateClass,
  policy: AccessorialPolicy,
  caps?: AccessorialCaps
): { billableMinutes: number; amountCents: number; capped: boolean } {
  const rawDetained = Math.max(0, dwellMinutes - policy.freeTimeMinutes);
  const billableMinutes = roundUpTo(rawDetained, policy.billingIncrementMinutes);
  const rateCents = policy.detentionHourlyRateCents[rateClass];
  let amountCents = Math.round((billableMinutes * rateCents) / 60);
  let capped = false;
  if (caps?.detentionMaxCents != null && amountCents > caps.detentionMaxCents) {
    amountCents = caps.detentionMaxCents;
    capped = true;
  }
  assertIntegerCents(amountCents, 'detention amount');
  return { billableMinutes, amountCents, capped };
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

  // Detention penalty: the whole dwell while within the threshold, frozen at the
  // threshold amount once layover takes over (min(dwell, threshold)).
  const detentionDwell = Math.min(dwellMinutes, policy.layoverThresholdMinutes);
  const det = detentionFor(detentionDwell, rateClass, policy, caps);
  const detentionRateCents = policy.detentionHourlyRateCents[rateClass];

  // Within the threshold: pure detention.
  if (dwellMinutes <= policy.layoverThresholdMinutes) {
    return {
      type: 'DETENTION',
      dwellMinutes,
      detainedMinutes: det.billableMinutes,
      layoverDays: 0,
      rateClass,
      rateCents: detentionRateCents,
      detentionCents: det.amountCents,
      layoverCents: 0,
      amountCents: det.amountCents,
      capped: det.capped,
    };
  }

  // Extended hold: KEEP the first-window detention penalty and ADD an escalating
  // layover surcharge for each started 24-hour period beyond the threshold. This
  // is what makes the charge monotonic in dwell. (Audit v8 F1.)
  const layoverDays = Math.ceil((dwellMinutes - policy.layoverThresholdMinutes) / 1440);
  const layoverRateCents = policy.layoverDailyRateCents;
  let layoverCents = layoverDays * layoverRateCents;
  let layoverCapped = false;
  if (caps?.layoverMaxCents != null && layoverCents > caps.layoverMaxCents) {
    layoverCents = caps.layoverMaxCents;
    layoverCapped = true;
  }
  assertIntegerCents(layoverCents, 'layover amount');

  const amountCents = det.amountCents + layoverCents;
  assertIntegerCents(amountCents, 'accessorial amount');

  return {
    type: 'LAYOVER',
    dwellMinutes,
    detainedMinutes: det.billableMinutes,
    layoverDays,
    rateClass,
    rateCents: layoverRateCents,
    detentionCents: det.amountCents,
    layoverCents,
    amountCents,
    capped: det.capped || layoverCapped,
  };
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
