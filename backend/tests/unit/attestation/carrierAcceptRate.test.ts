/**
 * CARRIER_ACCEPT binds the AGREED rate, not the load's posted rate.
 *
 * A negotiated accept passes the rate the carrier is committing to
 * (i.rateAmount / i.rateType); the projection binds it into the canonical
 * documentHash so the attestation matches what settlement pays out. A straight
 * claim passes nothing and falls back to the load's posted rate (unchanged).
 */
import { describe, it, expect } from 'vitest';
import { canonicalize } from '../../../src/services/attestation/canonicalize';
import type { Load } from '../../../src/types';

// projectCarrierAccept only reads loadId, rateAmount, rateType, assignedDriverId.
const load = { loadId: 'load_x', rateAmount: 2.50, rateType: 'PER_MILE' } as unknown as Load;
const cor = { entityType: 'OWNER_OPERATOR', entityId: 'op-1' } as any;
const base = { load, carrierOfRecord: cor, assignedDriverId: 'drv-1' };

describe('CARRIER_ACCEPT rate binding', () => {
  it('falls back to the load posted rate when no negotiated rate is passed', () => {
    const r = canonicalize('CARRIER_ACCEPT', { ...base });
    expect(r.canonicalJSON).toContain('"rateAmount":2.5');
    expect(r.canonicalJSON).toContain('"rateType":"PER_MILE"');
  });

  it('binds the agreed per-mile rate when passed (overrides the posted rate)', () => {
    const r = canonicalize('CARRIER_ACCEPT', { ...base, rateAmount: 2.60, rateType: 'PER_MILE' });
    expect(r.canonicalJSON).toContain('"rateAmount":2.6');
  });

  it('a different agreed rate yields a different documentHash (rate is in the hash)', () => {
    const posted = canonicalize('CARRIER_ACCEPT', { ...base });
    const agreed = canonicalize('CARRIER_ACCEPT', { ...base, rateAmount: 2.60, rateType: 'PER_MILE' });
    expect(agreed.documentHash).not.toBe(posted.documentHash);
  });

  it('binds a flat total when the load negotiates in flat dollars', () => {
    const r = canonicalize('CARRIER_ACCEPT', { ...base, rateAmount: 600, rateType: 'FLAT_RATE' });
    expect(r.canonicalJSON).toContain('"rateAmount":600');
    expect(r.canonicalJSON).toContain('"rateType":"FLAT_RATE"');
  });
});
