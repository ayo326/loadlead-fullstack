// Bridges the legacy TrailerType enum to the canonical equipment_required
// class codes from /data/taxonomy/equipment-classes.json, and provides a
// one-shot deriver that fills new orthogonal fields from a legacy payload.
//
// This file is intentionally tiny - the matching engine reads the class code
// directly, so all this needs to do is normalize input shape.

import { TrailerType, type Load, type LoadCharacteristics, type LoadMode } from '../types';
import { getEquipmentClass } from './taxonomyLoader';

/** Legacy TrailerType → canonical equipment class code. */
const TRAILER_TYPE_TO_CLASS: Record<TrailerType, string> = {
  [TrailerType.DRY_VAN]:    'V',
  [TrailerType.REEFER]:     'R',
  [TrailerType.BOX_TRUCK]:  'BOX26',
  [TrailerType.FLATBED]:    'F',
  [TrailerType.STEP_DECK]:  'SD',
  [TrailerType.RGN]:        'RGN',
  [TrailerType.CONESTOGA]:  'CN',
  [TrailerType.TANKER]:     'TF',       // fuel as default; chemical/food-grade is set explicitly
  [TrailerType.CAR_HAULER]: 'CH',
  [TrailerType.POWER_ONLY]: 'PO',
};

/** Reverse: equipment class code → TrailerType (for back-compat reads). */
export function classCodeToTrailerType(code: string): TrailerType | undefined {
  for (const [k, v] of Object.entries(TRAILER_TYPE_TO_CLASS)) {
    if (v === code) return k as TrailerType;
  }
  // Sub-variants collapse to their parent (V48 → DRY_VAN, R48 → REEFER, etc.)
  if (code.startsWith('V'))    return TrailerType.DRY_VAN;
  if (code.startsWith('R'))    return TrailerType.REEFER;
  if (code.startsWith('F'))    return TrailerType.FLATBED;
  if (code.startsWith('BOX'))  return TrailerType.BOX_TRUCK;
  return undefined;
}

/** Legacy loadSize → canonical mode. */
const LOAD_SIZE_TO_MODE: Record<'FULL' | 'PARTIAL' | 'LTL', LoadMode> = {
  FULL:    'FTL',
  PARTIAL: 'PARTIAL',
  LTL:     'LTL',
};

/**
 * Derive orthogonal type fields from a legacy load payload. Use this when an
 * older client posts a load shape without the new fields - the result is a
 * patch the LoadService merges in so persisted records carry both views.
 */
export function deriveOrthogonalFields(input: Partial<Load>): Partial<Load> {
  const out: Partial<Load> = {};

  // equipment_required
  if (!input.equipment_required && input.equipmentType) {
    out.equipment_required = TRAILER_TYPE_TO_CLASS[input.equipmentType];
  }

  // mode
  if (!input.mode && input.loadSize) {
    out.mode = LOAD_SIZE_TO_MODE[input.loadSize];
  }

  // characteristics - collect every legacy flag we can map
  const c: LoadCharacteristics = { ...(input.characteristics ?? {}) };
  let touched = false;
  if (input.hazmat !== undefined && c.hazmat === undefined) {
    c.hazmat = input.hazmat;
    touched = true;
  }
  if (input.hazmatClass && !c.hazmat_class) {
    c.hazmat_class = input.hazmatClass;
    touched = true;
  }
  if (input.tempRequiredMin !== undefined && c.min_temp === undefined) {
    c.min_temp = input.tempRequiredMin;
    c.temperature_required = true;
    touched = true;
  }
  if (input.tempRequiredMax !== undefined && c.max_temp === undefined) {
    c.max_temp = input.tempRequiredMax;
    c.temperature_required = true;
    touched = true;
  }
  if (touched) out.characteristics = c;

  return out;
}

/**
 * Equipment-attribute compatibility check (spec §3). Returns the list of
 * required characteristics the candidate equipment fails to provide. An
 * empty array means the candidate is compatible.
 *
 * Caller is responsible for the equipment_required class-code match itself;
 * this only validates the orthogonal characteristic mirror.
 */
export function checkCharacteristicMatch(
  loadClassCode: string,
  candidateClassCode: string,
  characteristics: LoadCharacteristics | undefined,
): string[] {
  const cls = getEquipmentClass(candidateClassCode);
  if (!cls) return ['unknown_equipment_class'];
  if (!characteristics) return [];

  const a = cls.attributes;
  const fails: string[] = [];

  const provides = (v: 'Y' | 'N' | 'opt' | 'n/a') => v === 'Y' || v === 'opt';

  if (characteristics.temperature_required && !provides(a.temperature_controlled)) {
    fails.push('temperature_required');
  }
  if (characteristics.hazmat && !provides(a.hazmat_capable)) {
    fails.push('hazmat');
  }
  if (characteristics.food_grade_required && !provides(a.food_grade)) {
    fails.push('food_grade_required');
  }
  if ((characteristics.oversized || characteristics.heavy_haul) && !provides(a.oversize_capable)) {
    fails.push('oversized_or_heavy_haul');
  }

  // For exact-class loads (load specifies a class), the candidate must match it.
  // Sub-variants of the same family are accepted (V48 ↔ V).
  if (loadClassCode && candidateClassCode !== loadClassCode) {
    const familyMatch =
      loadClassCode === candidateClassCode ||
      (loadClassCode.startsWith('V') && candidateClassCode.startsWith('V')) ||
      (loadClassCode.startsWith('R') && candidateClassCode.startsWith('R')) ||
      (loadClassCode.startsWith('F') && candidateClassCode.startsWith('F')) ||
      (loadClassCode.startsWith('BOX') && candidateClassCode.startsWith('BOX'));
    if (!familyMatch) fails.push('equipment_class_mismatch');
  }

  return fails;
}
