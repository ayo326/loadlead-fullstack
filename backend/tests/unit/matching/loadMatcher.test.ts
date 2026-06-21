// Spec proof for the consolidated matching rule (Equipment & Load Type
// Taxonomy spec §3). Headline test: a Reefer + hazmat load must accept a
// Reefer driver with the H endorsement and reject everything else.
//
// These tests intentionally bypass DynamoDB; they exercise the pure rule
// in services/loadMatcher.ts so a regression in the rule shows up here
// regardless of integration plumbing.

import { describe, it, expect } from 'vitest';
import { TrailerType } from '../../../src/types';
import { checkLoadMatch } from '../../../src/services/loadMatcher';
import { aDriver, aLoad } from '../../fixtures/factories';

const TEMP_REEFER_RANGE = { min_temp: -10, max_temp: 30, temperature_required: true } as const;

function reeferHazmatLoad() {
  // Reefer load that is also hazmat. Both the legacy and orthogonal fields
  // are set so the matcher sees the same intent regardless of which path it
  // takes — this proves the consolidation actually consolidates.
  return aLoad({
    equipmentType:           TrailerType.REEFER,
    acceptedEquipmentTypes:  [TrailerType.REEFER],
    equipment_required:      'R',
    tempRequiredMin:         -10,
    tempRequiredMax:         30,
    hazmat:                  true,
    hazmatClass:             '3',
    characteristics:         { hazmat: true, hazmat_class: '3', ...TEMP_REEFER_RANGE },
  });
}

describe('loadMatcher — Reefer + hazmat headline exclusion', () => {
  it('accepts a Reefer driver with hazmat (H) endorsement and temp range', () => {
    const driver = aDriver({
      trailerType:   TrailerType.REEFER,
      endorsements:  ['H'],
      tempRangeMin:  -20,
      tempRangeMax:  40,
    });
    const r = checkLoadMatch(driver, reeferHazmatLoad());
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('excludes a Flatbed driver from a Reefer load (the spec headline)', () => {
    const driver = aDriver({
      trailerType:  TrailerType.FLATBED,
      endorsements: ['H'],   // even with hazmat endorsement, wrong equipment
    });
    const r = checkLoadMatch(driver, reeferHazmatLoad());
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' | ')).toMatch(/Equipment mismatch|temperature/i);
  });

  it('excludes a Dry Van driver from a hazmat-tank load (different family)', () => {
    const tankerLoad = aLoad({
      equipmentType:          TrailerType.TANKER,
      acceptedEquipmentTypes: [TrailerType.TANKER],
      equipment_required:     'TF',                  // fuel tanker
      hazmat:                 true,
      hazmatClass:            '3',
      characteristics:        { hazmat: true, hazmat_class: '3' },
    });
    const driver = aDriver({
      trailerType:  TrailerType.DRY_VAN,
      endorsements: ['H', 'N'],
    });
    const r = checkLoadMatch(driver, tankerLoad);
    expect(r.eligible).toBe(false);
  });

  it('rejects a Reefer driver missing hazmat endorsement for a hazmat load', () => {
    const driver = aDriver({
      trailerType:  TrailerType.REEFER,
      endorsements: [],
      tempRangeMin: -20,
      tempRangeMax: 40,
    });
    const r = checkLoadMatch(driver, reeferHazmatLoad());
    expect(r.eligible).toBe(false);
    expect(r.reasons.some(s => /hazmat/i.test(s))).toBe(true);
  });

  it('rejects a tanker load when the driver has no tanker endorsement', () => {
    const tankerLoad = aLoad({
      equipmentType:          TrailerType.TANKER,
      acceptedEquipmentTypes: [TrailerType.TANKER],
      equipment_required:     'TF',
    });
    const driver = aDriver({
      trailerType:  TrailerType.TANKER,
      endorsements: [],            // no N or X
    });
    const r = checkLoadMatch(driver, tankerLoad);
    expect(r.eligible).toBe(false);
    expect(r.reasons.some(s => /N or X|tanker/i.test(s))).toBe(true);
  });
});

describe('loadMatcher — facility-derived requirements still flow through', () => {
  it('rejects a driver without a liftgate when the facility derives one', () => {
    const load = aLoad({
      equipmentType:          TrailerType.DRY_VAN,
      acceptedEquipmentTypes: [TrailerType.DRY_VAN],
      pickupFacility:  { dockAvailable: false, forkliftAvailable: false, freightFormat: 'PALLETIZED' },
      deliveryFacility:{ dockAvailable: false, forkliftAvailable: false, freightFormat: 'PALLETIZED' },
    });
    const driver = aDriver({ trailerType: TrailerType.DRY_VAN, liftgateEquipped: false });
    const r = checkLoadMatch(driver, load);
    expect(r.eligible).toBe(false);
    expect(r.reasons.some(s => /liftgate/i.test(s))).toBe(true);
  });
});
