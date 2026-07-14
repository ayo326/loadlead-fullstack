/**
 * Hauler equipment capacity policy (configurable).
 *
 * Capacity model, three numbers:
 *   RATED     - the equipment's full payload, a fixed fact on the equipment
 *               profile (Driver.maxCapacityLbs). Prefilled by equipment type at
 *               registration, editable.
 *   ON-BOARD  - what is on the truck right now: platform-known (active LoadLead
 *               loads assigned to this hauler) plus hauler-declared external
 *               freight.
 *   REMAINING - always computed, never typed:
 *               remaining = rated - platform-known active weight - declared
 *               external weight, floored at zero.
 *
 * All weights are whole pounds (integers). No floats. This constant is the one
 * place matching and display read the capacity rules from, mirroring
 * config/negotiationPolicy.ts and config/accessorialPolicy.ts.
 */

import { TrailerType } from '../types';

export const CAPACITY_POLICY = {
  // A declared state older than this is stale; the login prompt asks to refresh it.
  staleAfterHours: 12,
  // off  - matching ignores capacity
  // soft - keep oversized loads visible, badge them, sort them below fitting loads (default)
  // hard - exclude loads whose weight exceeds remaining from the hauler board
  capacityFilterMode: 'soft' as 'off' | 'soft' | 'hard',
  // When capacity state is unknown, matching treats remaining as the full rated
  // capacity, so a hauler who ignored the prompt sees a full board, not an empty one.
  unknownTreatedAs: 'rated' as 'rated' | 'zero',
  // Prefill at registration, editable, whole pounds. Keys are equipment + trailer
  // length as the product spec defines them; the TrailerType mapping below bridges
  // to the codebase enum (which is length-agnostic).
  defaultRatedByEquipment: {
    DRY_VAN_53: 45000,
    REEFER_53: 43000,
    FLATBED_48: 48000,
    BOX_TRUCK_26: 10000,
    HOTSHOT_40: 16500,
  },
} as const;

export type CapacityFilterMode = typeof CAPACITY_POLICY.capacityFilterMode;

/**
 * Prefill rated payload for a trailer type (whole pounds), or undefined when we
 * have no sensible default (e.g. POWER_ONLY has no trailer, CAR_HAULER is not
 * weight-primary). The value is only a prefill; the hauler edits it and the
 * edited number is the fact recorded on the equipment profile.
 */
export function defaultRatedForTrailerType(t: TrailerType | string | undefined): number | undefined {
  switch (t) {
    case TrailerType.DRY_VAN:
      return CAPACITY_POLICY.defaultRatedByEquipment.DRY_VAN_53;
    case TrailerType.REEFER:
      return CAPACITY_POLICY.defaultRatedByEquipment.REEFER_53;
    case TrailerType.BOX_TRUCK:
      return CAPACITY_POLICY.defaultRatedByEquipment.BOX_TRUCK_26;
    case TrailerType.FLATBED:
    case TrailerType.STEP_DECK:
    case TrailerType.CONESTOGA:
      return CAPACITY_POLICY.defaultRatedByEquipment.FLATBED_48;
    case TrailerType.RGN:
      return 40000;
    case TrailerType.TANKER:
      return 45000;
    case TrailerType.CAR_HAULER:
    case TrailerType.POWER_ONLY:
    default:
      return undefined;
  }
}
