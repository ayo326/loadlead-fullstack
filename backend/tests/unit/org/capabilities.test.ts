import { describe, it, expect } from 'vitest';
import { OrgCapability } from '../../../src/types';
import { assertCapabilities } from '../../../src/services/orgService';

describe('assertCapabilities', () => {
  it('[C1] create [SHIPPER] → ok', () => {
    expect(() => assertCapabilities([OrgCapability.SHIPPER])).not.toThrow();
  });

  it('[C2] create [CARRIER] → ok', () => {
    expect(() => assertCapabilities([OrgCapability.CARRIER])).not.toThrow();
  });

  it('[C3] create [RECEIVER] → ok', () => {
    expect(() => assertCapabilities([OrgCapability.RECEIVER])).not.toThrow();
  });

  it('[C4] create [SHIPPER, CARRIER] → 400 exclusivity', () => {
    expect(() => assertCapabilities([OrgCapability.SHIPPER, OrgCapability.CARRIER]))
      .toThrow(/mutually exclusive/i);
  });

  it('[C5] create [SHIPPER, RECEIVER] → ok', () => {
    expect(() => assertCapabilities([OrgCapability.SHIPPER, OrgCapability.RECEIVER]))
      .not.toThrow();
  });

  it('[C6] create [CARRIER, RECEIVER] → ok', () => {
    expect(() => assertCapabilities([OrgCapability.CARRIER, OrgCapability.RECEIVER]))
      .not.toThrow();
  });

  it('[C7] create [] empty → 400', () => {
    expect(() => assertCapabilities([])).toThrow(/at least one/i);
  });

  it('[C8] add CARRIER to [SHIPPER] on update → 400', () => {
    expect(() => assertCapabilities([OrgCapability.SHIPPER, OrgCapability.CARRIER]))
      .toThrow(/mutually exclusive/i);
  });

  it('[C4b] order does not matter: [CARRIER, SHIPPER] → 400', () => {
    expect(() => assertCapabilities([OrgCapability.CARRIER, OrgCapability.SHIPPER]))
      .toThrow(/mutually exclusive/i);
  });

  it('all three [SHIPPER, CARRIER, RECEIVER] → 400 (SHIPPER+CARRIER present)', () => {
    expect(() => assertCapabilities([OrgCapability.SHIPPER, OrgCapability.CARRIER, OrgCapability.RECEIVER]))
      .toThrow(/mutually exclusive/i);
  });

  it('[C11] duplicate caps treated as single (deduped via Set)', () => {
    expect(() => assertCapabilities([OrgCapability.SHIPPER, OrgCapability.SHIPPER]))
      .not.toThrow();
  });
});
