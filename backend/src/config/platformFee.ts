/**
 * Platform fee policy. The single source of truth for what LoadLead takes on the
 * linehaul. During the private beta the take is waived: betaFeeWaiver true means
 * the effective linehaul take is zero, so a carrier (fleet carrier or owner
 * operator) nets the full gross linehaul. When the waiver is lifted the take
 * becomes linehaulTakeRateBps (basis points; 500 bps = 5.00%).
 *
 * This constant is the seed/default. The live policy is read from the append-only
 * PlatformFeePolicy store (see services/platformFeeService.ts), which falls back
 * to this default when no change has ever been recorded. Every change to the live
 * policy is an append-only event with an actor and a timestamp.
 */

export interface PlatformFeePolicy {
  /** Linehaul take in basis points. 500 = 5.00%. Applies only when the waiver is off. */
  linehaulTakeRateBps: number;
  /** When true the effective linehaul take is 0 regardless of linehaulTakeRateBps. */
  betaFeeWaiver: boolean;
}

export const PLATFORM_FEE_POLICY: PlatformFeePolicy = {
  linehaulTakeRateBps: 500,
  betaFeeWaiver: true,
};

/** Hard bounds for a sane take rate: 0 to 100.00%. Guards stored policy changes. */
export const MIN_TAKE_RATE_BPS = 0;
export const MAX_TAKE_RATE_BPS = 10000;
