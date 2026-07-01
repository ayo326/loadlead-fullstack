/**
 * Accessorial policy defaults and the rate-class resolver.
 *
 * Detention and layover sit on top of linehaul and are computed from immutable
 * evidence (Phase 4 stop events) against a policy agreed at booking (Phase 3).
 * DEFAULT_ACCESSORIAL_POLICY is the pre-fill; a per-load policy (see
 * services/accessorialPolicyService.ts) starts from it and can be tuned per load,
 * then frozen onto each charge at compute time.
 *
 * All money here is integer US cents and all time spans are whole minutes, per
 * the global money/time convention. There is no floating point.
 */

import { TrailerType } from '../types';
import type { SignatureType } from '../types/signatures';

/** Detention rate band. Pre-filled from the load (hazmat, equipment), overridable per load. */
export type AccessorialRateClass = 'STANDARD' | 'SPECIALIZED' | 'HAZMAT';

export const ACCESSORIAL_RATE_CLASSES: AccessorialRateClass[] = ['STANDARD', 'SPECIALIZED', 'HAZMAT'];

export interface AccessorialPolicy {
  /** Free dwell before detention accrues, in minutes. */
  freeTimeMinutes: number;
  /** Detained minutes are rounded UP to this increment. */
  billingIncrementMinutes: number;
  /** Detention hourly rate per band, in integer cents. */
  detentionHourlyRateCents: Record<AccessorialRateClass, number>;
  /** Dwell at or under this is detention; above it becomes layover. Minutes. */
  layoverThresholdMinutes: number;
  /** Layover rate per started 24-hour period, in integer cents. */
  layoverDailyRateCents: number;
  /** Detention at or under this many hours auto-approves; above routes to review. */
  detentionAutoApproveMaxHours: number;
  /** false = pass 100% of accessorials to the mover (the linehaul take never applies). */
  applyTakeRateToAccessorials: boolean;
}

export const DEFAULT_ACCESSORIAL_POLICY: AccessorialPolicy = {
  freeTimeMinutes: 120,
  billingIncrementMinutes: 15,
  detentionHourlyRateCents: {
    STANDARD: 5000, // $50/hr
    SPECIALIZED: 15000, // $150/hr
    HAZMAT: 17500, // $175/hr
  },
  layoverThresholdMinutes: 1440, // 24 hours
  layoverDailyRateCents: 15000, // $150/day
  detentionAutoApproveMaxHours: 2,
  applyTakeRateToAccessorials: false,
};

/** Optional per-load ceilings on accrued accessorials, in integer cents. */
export interface AccessorialCaps {
  detentionMaxCents?: number;
  layoverMaxCents?: number;
}

/**
 * Equipment that warrants the SPECIALIZED detention band (open-deck, temperature
 * controlled, or otherwise harder to load/unload). Everything else is STANDARD;
 * hazmat takes precedence over both.
 */
const SPECIALIZED_EQUIPMENT: ReadonlySet<TrailerType> = new Set<TrailerType>([
  TrailerType.REEFER,
  TrailerType.FLATBED,
  TrailerType.STEP_DECK,
  TrailerType.RGN,
  TrailerType.CONESTOGA,
  TrailerType.TANKER,
  TrailerType.CAR_HAULER,
]);

/**
 * Pre-fill the detention rate class from the load: hazmat first, then specialized
 * equipment, else standard. The per-load policy may override this.
 */
export function resolveRateClass(load: { hazmat?: boolean; equipmentType: TrailerType }): AccessorialRateClass {
  if (load.hazmat) return 'HAZMAT';
  if (SPECIALIZED_EQUIPMENT.has(load.equipmentType)) return 'SPECIALIZED';
  return 'STANDARD';
}

/**
 * The ESIGN/UETA statement a carrier or owner-operator attests to when accepting
 * the accessorial policy at claim. Versioned: bumping the version never edits an
 * old entry, and the version travels on every recorded acceptance.
 */
export const ACCESSORIAL_POLICY_ATTESTATION: { version: string; text: string } = {
  version: '1.0.0',
  text:
    'I, the authorized representative of the carrier of record, accept the detention and layover ' +
    'accessorial policy for this load as shown, including the free time, billing increment, rate ' +
    'class, and layover terms. I understand accessorials are computed from recorded check-in and ' +
    'check-out evidence and are subject to shipper review. I consent to sign electronically; this ' +
    'signature has the same legal effect as a handwritten signature under ESIGN (15 U.S.C. ch. 96) ' +
    'and UETA.',
};

/** Re-exported for callers recording an acceptance; matches the attestation chain. */
export type AccessorialSignatureType = SignatureType;
