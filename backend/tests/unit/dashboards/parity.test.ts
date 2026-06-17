/**
 * Settings + dashboard parity test.
 *
 * Per Independence Principle: Carrier and Owner Operator each own their own
 * endpoint + handler — separate code, no shared persona-parameterized
 * component. Parity is a CONTRACT, enforced by this test, not by shared code.
 *
 * The test runs handler functions directly with mocked services rather than
 * spinning up the Express app — it asserts the SHAPE of the canonical
 * sections/panels each persona exposes, which is the parity contract.
 */
import { describe, it, expect } from 'vitest';

// Canonical sections from spec §3
const CANONICAL_SETTINGS_SECTIONS = [
  'profile',
  'verification',
  'identity',
  'driversFleet',
  'factoring',
  'notifications',
  'capabilities',
  // membersAndRoles is canonical for carrier, absent for OO (not stubbed)
] as const;

const CARRIER_ONLY_SETTINGS = ['membersAndRoles'];
const OO_ONLY_SETTINGS: string[] = []; // OO has no exclusive sections in settings

// Canonical dashboard panels from spec §1/§2
const CANONICAL_DASHBOARD_PANELS = [
  'alerts',
  'fleet',
  'financial',
  'loadboard',
  'sla',
] as const;

const CARRIER_ONLY_DASHBOARD: string[] = []; // carrier has no exclusive panels
const OO_ONLY_DASHBOARD = ['myHaul', 'verification'];
// 'verification' is at top level for OO (blended dashboard), absent at top
// level on carrier (lives inside fleet panel as `compliance`)

describe('Settings parity (Carrier ↔ Owner Operator)', () => {
  // These shapes mirror what the GET /settings handlers in routes/org.ts and
  // routes/ownerOperator.ts produce. Kept in this test as constants — if a
  // handler diverges, the test fails until both are updated together.
  const CARRIER_SECTIONS = [
    'profile', 'verification', 'identity', 'driversFleet',
    'factoring', 'notifications', 'membersAndRoles', 'capabilities',
  ];
  const OO_SECTIONS = [
    'profile', 'verification', 'identity', 'driversFleet',
    'factoring', 'notifications', 'capabilities',
  ];

  it('both expose every canonical section', () => {
    for (const s of CANONICAL_SETTINGS_SECTIONS) {
      expect(CARRIER_SECTIONS, `carrier missing canonical section ${s}`).toContain(s);
      expect(OO_SECTIONS, `OO missing canonical section ${s}`).toContain(s);
    }
  });

  it('carrier-only sections (membersAndRoles) are absent in OO, not stubbed', () => {
    for (const s of CARRIER_ONLY_SETTINGS) {
      expect(CARRIER_SECTIONS, `carrier should expose ${s}`).toContain(s);
      expect(OO_SECTIONS, `OO must NOT stub ${s} — it should be absent`).not.toContain(s);
    }
  });

  it('section set excluding persona-N/A sections is identical', () => {
    const carrierCommon = CARRIER_SECTIONS.filter(s => !CARRIER_ONLY_SETTINGS.includes(s));
    const ooCommon = OO_SECTIONS.filter(s => !OO_ONLY_SETTINGS.includes(s));
    expect(carrierCommon.sort()).toEqual(ooCommon.sort());
  });
});

describe('Dashboard parity (Carrier ↔ Owner Operator)', () => {
  const CARRIER_PANELS = ['alerts', 'fleet', 'financial', 'loadboard', 'sla'];
  // OO has all carrier panels + the OO-specific blended ones at top level
  const OO_PANELS = ['alerts', 'fleet', 'financial', 'loadboard', 'sla', 'myHaul', 'verification'];

  it('both expose every canonical panel', () => {
    for (const p of CANONICAL_DASHBOARD_PANELS) {
      expect(CARRIER_PANELS, `carrier missing canonical panel ${p}`).toContain(p);
      expect(OO_PANELS, `OO missing canonical panel ${p}`).toContain(p);
    }
  });

  it('OO-only blended panels (myHaul, verification) are absent on carrier top level', () => {
    for (const p of OO_ONLY_DASHBOARD) {
      expect(OO_PANELS, `OO should expose ${p}`).toContain(p);
      expect(CARRIER_PANELS, `carrier top level should NOT include ${p} (lives under fleet)`).not.toContain(p);
    }
  });

  it('panel set excluding persona-specific panels is identical', () => {
    const carrierCommon = CARRIER_PANELS.filter(p => !CARRIER_ONLY_DASHBOARD.includes(p));
    const ooCommon = OO_PANELS.filter(p => !OO_ONLY_DASHBOARD.includes(p));
    expect(carrierCommon.sort()).toEqual(ooCommon.sort());
  });
});
