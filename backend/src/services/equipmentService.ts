/**
 * Equipment type matching - spec §11
 *
 * Implements the 4-step matching order (cheapest checks first):
 *   1. Equipment type matches an accepted type
 *   2. Loading requirements satisfied
 *   3. Capacity check (delegated to CapacityService)
 *   4. Per-dimension geometric fit (inside CapacityService.evaluateLoad)
 */

import { Driver, Load, FacilityProfile, DerivedLoadingRequirements, TrailerType } from '../types';

// Open-deck types that are forklift-accessible from ground level
const OPEN_DECK: TrailerType[] = [
  TrailerType.FLATBED,
  TrailerType.STEP_DECK,
  TrailerType.RGN,
  TrailerType.CONESTOGA,
];

// ─── Derive hard loading requirements from facility profiles (§11.3) ──────────

export function deriveLoadingRequirements(
  pickup: FacilityProfile | undefined,
  delivery: FacilityProfile | undefined,
): DerivedLoadingRequirements {
  // When no facility profile is provided (most loads), default to the most permissive
  // assumption: no dock required, forklift available, palletized freight.
  // This prevents every load from requiring dock-height trailers by default.
  const p = pickup  ?? { dockAvailable: false, forkliftAvailable: true, freightFormat: 'PALLETIZED' as const };
  const d = delivery ?? { dockAvailable: false, forkliftAvailable: true, freightFormat: 'PALLETIZED' as const };

  const driveOn   = p.freightFormat === 'DRIVE_ON'   || d.freightFormat === 'DRIVE_ON';
  const liquidBulk = p.freightFormat === 'LIQUID_BULK' || d.freightFormat === 'LIQUID_BULK';

  // Liftgate: needed at any stop that has no dock AND no forklift AND is not drive-on/bulk
  const needsLiftgatePickup   = !p.dockAvailable && !p.forkliftAvailable && !driveOn && !liquidBulk;
  const needsLiftgateDelivery = !d.dockAvailable && !d.forkliftAvailable && !driveOn && !liquidBulk;
  const requiresLiftgate = needsLiftgatePickup || needsLiftgateDelivery;

  // Pallet jack: needed at liftgate stops where freight is palletized
  const requiresPalletJack =
    requiresLiftgate &&
    (p.freightFormat === 'PALLETIZED' || d.freightFormat === 'PALLETIZED');

  // Dock height: required when dock IS available (so trailer floor must align)
  const requiresDockHeight = p.dockAvailable || d.dockAvailable;

  const requiresRgnOrCarHauler = driveOn;
  const requiresTanker         = liquidBulk;

  let notes = '';
  if (!p.dockAvailable && !p.forkliftAvailable && p.freightFormat === 'FLOOR_LOADED') {
    notes += 'Pickup is hand-load (no dock, no forklift, floor-loaded). ';
  }
  if (!d.dockAvailable && !d.forkliftAvailable && d.freightFormat === 'FLOOR_LOADED') {
    notes += 'Delivery is hand-unload (no dock, no forklift, floor-loaded). ';
  }

  return { requiresLiftgate, requiresPalletJack, requiresDockHeight, requiresRgnOrCarHauler, requiresTanker, notes: notes.trim() || undefined };
}

// ─── Step 1: equipment type filter ───────────────────────────────────────────

export function equipmentTypeMatches(driver: Driver, load: Load): { matches: boolean; reason?: string } {
  const accepted = load.acceptedEquipmentTypes?.length
    ? load.acceptedEquipmentTypes
    : [load.equipmentType]; // backward-compat: single type

  if (!accepted.includes(driver.trailerType)) {
    return {
      matches: false,
      reason: `Equipment mismatch: driver has ${driver.trailerType}, load accepts [${accepted.join(', ')}]`,
    };
  }
  return { matches: true };
}

// ─── Step 2: loading requirements filter ─────────────────────────────────────

export function loadingRequirementsMet(driver: Driver, load: Load): { met: boolean; reason?: string } {
  const req = load.derivedLoadingRequirements
    ?? deriveLoadingRequirements(load.pickupFacility, load.deliveryFacility);

  // Liftgate
  if (req.requiresLiftgate && !driver.liftgateEquipped) {
    return { met: false, reason: 'Load requires a liftgate; driver equipment is not liftgate-equipped.' };
  }

  // Pallet jack
  if (req.requiresPalletJack && !driver.palletJackOnboard) {
    return { met: false, reason: 'Load requires a pallet jack onboard; driver does not have one.' };
  }

  // Dock height: only applies to enclosed trailers (open-deck loads by definition at ground level)
  if (req.requiresDockHeight && !OPEN_DECK.includes(driver.trailerType) && driver.dockHeightCompatible === false) {
    return { met: false, reason: 'Load facility requires dock-height trailer; driver equipment is not dock-height compatible.' };
  }

  // RGN / Car Hauler for drive-on cargo
  if (req.requiresRgnOrCarHauler && driver.trailerType !== TrailerType.RGN && driver.trailerType !== TrailerType.CAR_HAULER) {
    return { met: false, reason: 'Drive-on cargo requires RGN or Car Hauler.' };
  }

  // Tanker for liquid/bulk
  if (req.requiresTanker && driver.trailerType !== TrailerType.TANKER) {
    return { met: false, reason: 'Liquid/bulk freight requires a Tanker.' };
  }

  // Temperature range (reefer loads)
  if (load.tempRequiredMin !== undefined && load.tempRequiredMax !== undefined) {
    if (driver.trailerType !== TrailerType.REEFER) {
      return { met: false, reason: 'Temperature-controlled freight requires a Reefer trailer.' };
    }
    if (driver.tempRangeMin !== undefined && driver.tempRangeMin > load.tempRequiredMin) {
      return { met: false, reason: `Driver reefer min temp ${driver.tempRangeMin}°F cannot meet load requirement ${load.tempRequiredMin}°F.` };
    }
    if (driver.tempRangeMax !== undefined && driver.tempRangeMax < load.tempRequiredMax) {
      return { met: false, reason: `Driver reefer max temp ${driver.tempRangeMax}°F cannot meet load requirement ${load.tempRequiredMax}°F.` };
    }
  }

  return { met: true };
}

// ─── Combined equipment check ────────────────────────────────────────────────
//
// THIN WRAPPER. As of the Equipment & Load Type Taxonomy spec (Phase 5), the
// canonical eligibility rule lives in services/loadMatcher.ts and incorporates
// the orthogonal characteristic mirror + endorsement checks that this file's
// type+requirements pair doesn't see. Existing callers keep the same
// signature so we don't have to update every call site at once.
export class EquipmentService {
  static checkEquipmentMatch(
    driver: Driver,
    load: Load,
  ): { eligible: boolean; reason?: string } {
    // Defer to the shared matcher so broadcast eligibility, the dispatcher
    // manual-assign confirm, and dashboard guardrails all evaluate the same
    // rule. Collapse the reasons array into the first message for the
    // legacy single-reason shape.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkLoadMatch } = require('./loadMatcher') as typeof import('./loadMatcher');
    const r = checkLoadMatch(driver, load);
    return r.eligible ? { eligible: true } : { eligible: false, reason: r.reasons[0] };
  }
}
