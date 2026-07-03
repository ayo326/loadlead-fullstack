/**
 * Shipper detention/layover confirmation at posting.
 *
 * Proves the rate-card prefill (standard $50, hazmat $175), bounds enforcement on
 * the override, that posting freezes the policy and records ONE append-only
 * shipper agreement with the version + exact values + a server timestamp, that a
 * post-posting change is a new version (not a mutation of the frozen snapshot),
 * and the symmetry: the carrier's acknowledgment for the same load references the
 * same version and identical values the shipper agreed to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, updateItem, deleteItem } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      if (item.acceptanceId || item.agreementId) { arr.push(item); return; } // append-only
      const idx = arr.findIndex((x) => x.loadId === item.loadId); // policy upsert by loadId
      if (idx >= 0) arr[idx] = item; else arr.push(item);
    }),
    getItem: vi.fn(async (table: string, key: any) => {
      const arr = tables[table] ?? [];
      return arr.find((x) => Object.keys(key).every((k) => x[k] === key[k])) ?? null;
    }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
    updateItem: vi.fn(async () => ({})),
    deleteItem: vi.fn(async () => ({})),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, scan, updateItem, deleteItem },
  default: { putItem, getItem, scan, updateItem, deleteItem },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import config from '../../../src/config/environment';
import { TrailerType } from '../../../src/types';
import { AccessorialPolicyService } from '../../../src/services/accessorialPolicyService';

const AGREE = config.dynamodb.shipperAgreementsTable;

const dryVan = { loadId: 'load-std', hazmat: false, equipmentType: TrailerType.DRY_VAN };
const hazVan = { loadId: 'load-haz', hazmat: true, equipmentType: TrailerType.DRY_VAN };

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  updateItem.mockClear();
  deleteItem.mockClear();
});

describe('rate-card prefill (no load needed)', () => {
  it('standard dry van prefills $50/hr, hazmat $175/hr', () => {
    expect(AccessorialPolicyService.rateCardDisclosure(dryVan).detentionHourlyRateCents).toBe(5000);
    expect(AccessorialPolicyService.rateCardDisclosure(hazVan).detentionHourlyRateCents).toBe(17500);
    expect(AccessorialPolicyService.rateCardDisclosure(hazVan).rateClass).toBe('HAZMAT');
  });
});

describe('override bounds', () => {
  it('accepts an in-band detention override and rejects an out-of-band one', () => {
    expect(() => AccessorialPolicyService.assertOverrideWithinBounds({ detentionHourlyRateCents: { STANDARD: 6000 } }, 'STANDARD')).not.toThrow();
    expect(() => AccessorialPolicyService.assertOverrideWithinBounds({ detentionHourlyRateCents: { STANDARD: 30000 } }, 'STANDARD')).toThrow(/OUT_OF_BOUNDS/);
    expect(() => AccessorialPolicyService.assertOverrideWithinBounds({ layoverDailyRateCents: 30000 }, 'STANDARD')).toThrow(/OUT_OF_BOUNDS/);
  });
});

describe('freeze and agree at posting', () => {
  it('freezes the prefill and records one append-only agreement with version, values, and a server timestamp', async () => {
    const before = Date.now();
    const { policy, agreement, disclosure } = await AccessorialPolicyService.freezeAndAgreeAtPosting({
      load: dryVan, shipperId: 'shipper-1', actorId: 'user-1',
    });
    expect(policy.version).toBe(1);
    expect(disclosure.detentionHourlyRateCents).toBe(5000);
    expect(agreement.agreementId.startsWith('shipagree_')).toBe(true);
    expect(agreement.agreedVersion).toBe(1);
    expect(agreement.disclosure.detentionHourlyRateCents).toBe(5000);
    expect(agreement.shipperId).toBe('shipper-1');
    expect(agreement.agreedAt).toBeGreaterThanOrEqual(before);
    expect(tables[AGREE].length).toBe(1);
  });

  it('applies an in-bounds override, bumping the version and the frozen values', async () => {
    const { policy, agreement } = await AccessorialPolicyService.freezeAndAgreeAtPosting({
      load: dryVan, shipperId: 'shipper-1', actorId: 'user-1',
      override: { detentionHourlyRateCents: { STANDARD: 6000 } },
    });
    expect(policy.version).toBe(2); // v1 prefill -> v2 override
    expect(agreement.agreedVersion).toBe(2);
    expect(agreement.disclosure.detentionHourlyRateCents).toBe(6000);
  });

  it('rejects an out-of-bounds override and writes no agreement', async () => {
    await expect(AccessorialPolicyService.freezeAndAgreeAtPosting({
      load: dryVan, shipperId: 'shipper-1', actorId: 'user-1',
      override: { detentionHourlyRateCents: { STANDARD: 30000 } },
    })).rejects.toThrow(/OUT_OF_BOUNDS/);
    expect(tables[AGREE] ?? []).toHaveLength(0);
  });
});

describe('symmetry with the carrier side', () => {
  it('the carrier acknowledgment references the same version and identical values the shipper agreed to', async () => {
    const { agreement } = await AccessorialPolicyService.freezeAndAgreeAtPosting({
      load: dryVan, shipperId: 'shipper-1', actorId: 'user-1',
      override: { detentionHourlyRateCents: { STANDARD: 6000 } },
    });
    // What the carrier's offer view / modal read:
    const carrierDisclosure = await AccessorialPolicyService.disclosureForLoad(dryVan);
    expect(carrierDisclosure.version).toBe(agreement.agreedVersion);
    expect(carrierDisclosure.detentionHourlyRateCents).toBe(agreement.disclosure.detentionHourlyRateCents);
    // The carrier's acknowledgment pins the same version + values:
    const acc = await AccessorialPolicyService.acceptPolicy({
      load: dryVan, acceptedByUserId: 'driver-1', signerRole: 'DRIVER',
      signatureType: 'click', signatureData: 'ack', consentGiven: true, acknowledged: true,
    });
    expect(acc.acceptedVersion).toBe(agreement.agreedVersion);
    expect(acc.acknowledgment?.disclosure.detentionHourlyRateCents).toBe(agreement.disclosure.detentionHourlyRateCents);
  });

  it('a post-posting change is a new version, not a mutation of the frozen agreement', async () => {
    const { agreement } = await AccessorialPolicyService.freezeAndAgreeAtPosting({ load: dryVan, shipperId: 's', actorId: 'u' });
    expect(agreement.agreedVersion).toBe(1);
    const updated = await AccessorialPolicyService.updatePolicy(dryVan, { detentionHourlyRateCents: { STANDARD: 7000 } });
    expect(updated.version).toBe(2);
    // The frozen agreement still references v1; it was not mutated.
    expect(tables[AGREE][0].agreedVersion).toBe(1);
    expect(tables[AGREE][0].disclosure.detentionHourlyRateCents).toBe(5000);
  });
});
