// Single source of truth for "is this driver/equipment eligible to haul this load?".
//
// Implements the spec §3 rule:
//
//   match(load, equipment) =
//     equipment.class compatible with load.equipment_required
//     AND for each required characteristic on the load,
//         the assigned equipment provides it
//     AND driver endorsements satisfy load (hazmat, TWIC, team)
//
// Every call site (broadcast eligibility, the dashboard equipment-match
// guardrail, the dispatcher's manual-assign confirm) routes through here.
// Persona-neutral by construction - no Carrier/OO branching anywhere.

import type { Driver, Load } from '../types';
import { equipmentTypeMatches, loadingRequirementsMet } from './equipmentService';
import { checkCharacteristicMatch, classCodeToTrailerType } from './loadTaxonomy';

export interface MatchResult {
  eligible: boolean;
  /** Empty when eligible; ordered list of failing reasons otherwise. */
  reasons: string[];
}

const HAZMAT_ENDORSEMENTS = new Set(['H', 'X']);     // X = hazmat + tanker combined
const TWIC_CREDENTIAL     = 'TWIC';
const TANKER_ENDORSEMENT  = new Set(['N', 'X']);
const TEAM_ENDORSEMENT    = 'TEAM';                  // marker on driver.endorsements

function ok(): MatchResult { return { eligible: true, reasons: [] }; }
function fail(reason: string): MatchResult { return { eligible: false, reasons: [reason] }; }

/**
 * Eligibility check. Reasons aggregate so the UI can show all failures at
 * once rather than peeling one error per retry.
 */
export function checkLoadMatch(driver: Driver, load: Load): MatchResult {
  const reasons: string[] = [];

  // 1. Legacy equipment-class compatibility (driver.trailerType vs load.acceptedEquipmentTypes).
  //    This is the load-board-style class filter.
  const typeCheck = equipmentTypeMatches(driver, load);
  if (!typeCheck.matches && typeCheck.reason) reasons.push(typeCheck.reason);

  // 2. Facility-derived loading requirements (liftgate, pallet jack, dock height,
  //    RGN/Car Hauler, Tanker for liquid/bulk, reefer temp range).
  const reqCheck = loadingRequirementsMet(driver, load);
  if (!reqCheck.met && reqCheck.reason) reasons.push(reqCheck.reason);

  // 3. Orthogonal characteristic mirror (spec §3) - only run when the load
  //    carries the new shape. driver.equipmentClassCode is optional today;
  //    fall back to a legacy-to-class translation in loadTaxonomy.
  if (load.equipment_required) {
    // Today we don't track the driver's class code on Driver yet (Phase 6
    // adds it on the equipment screen). For now, derive from trailerType
    // via the same mapper that LoadService uses on writes.
    const wantedFamily = classCodeToTrailerType(load.equipment_required);
    if (wantedFamily && driver.trailerType !== wantedFamily) {
      // Already caught by step 1 if acceptedEquipmentTypes was set - dedupe.
      const msg = `Driver class ${driver.trailerType} does not satisfy load.equipment_required=${load.equipment_required}`;
      if (!reasons.includes(msg)) reasons.push(msg);
    }

    // Characteristic check using the load's required class and a placeholder
    // candidate code derived from the driver. This shines once the driver
    // has its own equipment_class_code field (Phase 6); for now we let the
    // legacy filters carry the load and only surface NEW mismatches.
    const candidateCode = trailerTypeToClassCode(driver.trailerType);
    if (candidateCode) {
      const charFails = checkCharacteristicMatch(load.equipment_required, candidateCode, load.characteristics);
      // Drop equipment_class_mismatch - step 1 already covered that.
      for (const f of charFails) {
        if (f === 'equipment_class_mismatch') continue;
        const msg = mapCharacteristicFailureReason(f);
        if (!reasons.includes(msg)) reasons.push(msg);
      }
    }
  }

  // 4. Driver endorsements / credentials (spec §3 - hazmat, TWIC, team).
  const driverEndorsements = new Set((driver.endorsements ?? []).map(e => e.toUpperCase()));

  if (load.characteristics?.hazmat || load.hazmat) {
    const hasHazmatEndorsement = [...driverEndorsements].some(e => HAZMAT_ENDORSEMENTS.has(e));
    if (!hasHazmatEndorsement) {
      reasons.push('Hazmat load: driver lacks H or X endorsement.');
    }
  }
  if (load.twic_required && !driverEndorsements.has(TWIC_CREDENTIAL)) {
    reasons.push('Load requires TWIC credential; driver does not carry one.');
  }
  if (load.team_driver_required && !driverEndorsements.has(TEAM_ENDORSEMENT)) {
    reasons.push('Load is team-driver-required; driver is not configured as team.');
  }

  // Tanker endorsement: required when load.equipment_required is in the tanker family.
  if (load.equipment_required && load.equipment_required.startsWith('T') &&
      load.equipment_required !== 'TR' /* insulated dry tanker treated separately */) {
    const hasTanker = [...driverEndorsements].some(e => TANKER_ENDORSEMENT.has(e));
    if (!hasTanker) {
      reasons.push('Tanker load: driver lacks N or X endorsement.');
    }
  }

  return reasons.length ? { eligible: false, reasons } : ok();
}

/**
 * One-line "is this driver eligible?" used by guardrails that don't need
 * the failure detail. Same logic as checkLoadMatch, just thinner return.
 */
export function isEligible(driver: Driver, load: Load): boolean {
  return checkLoadMatch(driver, load).eligible;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function trailerTypeToClassCode(tt: string): string | undefined {
  switch (tt) {
    case 'DRY_VAN':    return 'V';
    case 'REEFER':     return 'R';
    case 'BOX_TRUCK':  return 'BOX26';
    case 'FLATBED':    return 'F';
    case 'STEP_DECK':  return 'SD';
    case 'RGN':        return 'RGN';
    case 'CONESTOGA':  return 'CN';
    case 'TANKER':     return 'TF';
    case 'CAR_HAULER': return 'CH';
    case 'POWER_ONLY': return 'PO';
    default: return undefined;
  }
}

function mapCharacteristicFailureReason(code: string): string {
  switch (code) {
    case 'temperature_required':    return 'Load requires temperature control; assigned equipment does not provide it.';
    case 'hazmat':                  return 'Load is hazmat; assigned equipment is not hazmat-capable.';
    case 'food_grade_required':     return 'Load requires food-grade equipment; candidate does not provide it.';
    case 'oversized_or_heavy_haul': return 'Load is oversized/heavy-haul; candidate equipment is not oversize-capable.';
    case 'unknown_equipment_class': return 'Candidate equipment class is unknown to the taxonomy.';
    default:                        return `Equipment characteristic mismatch: ${code}`;
  }
}
