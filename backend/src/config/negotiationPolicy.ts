/**
 * Negotiation policy - configurable knobs for the load negotiation window.
 * All time spans are whole minutes; all money is integer cents (cents per
 * mile for rates), per the global money/time convention.
 */
export const NEGOTIATION_POLICY = {
  /** Total window from engagement; after this the load rebroadcasts. */
  windowMinutes: 20,
  /** On rebroadcast, the load returns at its posted rate (Load is never mutated). */
  rebroadcastRate: 'ORIGINAL',
  /** Reject non-positive rates. Integer cents per mile. */
  minRatePerMileCents: 1,
  /** 0 = unlimited offers within the window. */
  maxRounds: 0,
} as const;
