/**
 * Phase 3: per-load accessorial policy and its append-only acceptance trail.
 *
 * Proves the rate-class pre-fill, idempotent get-or-create, per-load overrides
 * with version bumps, the frozen hashable snapshot, and append-only ESIGN/UETA
 * acceptance (consent required, version + hash pinned, never overwritten). The
 * Load model is never read or written.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, updateItem, deleteItem } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      if (item.acceptanceId) {
        arr.push(item); // acceptances are append-only
        return;
      }
      // policy rows upsert by loadId (PK)
      const idx = arr.findIndex((x) => x.loadId === item.loadId);
      if (idx >= 0) arr[idx] = item;
      else arr.push(item);
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
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import config from '../../../src/config/environment';
import { TrailerType } from '../../../src/types';
import { AccessorialPolicyService } from '../../../src/services/accessorialPolicyService';
import { DEFAULT_ACCESSORIAL_POLICY, resolveRateClass } from '../../../src/config/accessorialPolicy';

const POLICY_TABLE = config.dynamodb.accessorialPoliciesTable;
const ACCEPT_TABLE = config.dynamodb.accessorialPolicyAcceptancesTable;
const LOADS_TABLE = config.dynamodb.loadsTable;

const dryVan = { loadId: 'load-1', hazmat: false, equipmentType: TrailerType.DRY_VAN };
const reefer = { loadId: 'load-2', hazmat: false, equipmentType: TrailerType.REEFER };
const hazmatVan = { loadId: 'load-3', hazmat: true, equipmentType: TrailerType.DRY_VAN };

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  getItem.mockClear();
  scan.mockClear();
});

describe('rate-class pre-fill', () => {
  it('hazmat wins, then specialized equipment, else standard', () => {
    expect(resolveRateClass(hazmatVan)).toBe('HAZMAT');
    expect(resolveRateClass(reefer)).toBe('SPECIALIZED');
    expect(resolveRateClass({ equipmentType: TrailerType.FLATBED })).toBe('SPECIALIZED');
    expect(resolveRateClass(dryVan)).toBe('STANDARD');
    expect(resolveRateClass({ equipmentType: TrailerType.POWER_ONLY })).toBe('STANDARD');
  });
});

describe('get-or-create per-load policy', () => {
  it('creates a pre-filled v1 from defaults + the load rate class', async () => {
    const p = await AccessorialPolicyService.getOrCreateForLoad(reefer);
    expect(p.version).toBe(1);
    expect(p.prefilled).toBe(true);
    expect(p.rateClass).toBe('SPECIALIZED');
    expect(p.policy.freeTimeMinutes).toBe(DEFAULT_ACCESSORIAL_POLICY.freeTimeMinutes);
    expect(p.policy.detentionHourlyRateCents.SPECIALIZED).toBe(15000);
    expect(putItem).toHaveBeenCalledWith(POLICY_TABLE, expect.objectContaining({ loadId: 'load-2' }));
  });

  it('is idempotent: a second call returns the same row and does not re-create', async () => {
    const a = await AccessorialPolicyService.getOrCreateForLoad(dryVan);
    putItem.mockClear();
    const b = await AccessorialPolicyService.getOrCreateForLoad(dryVan);
    expect(b.version).toBe(a.version);
    expect(b.createdAt).toBe(a.createdAt);
    expect(putItem).not.toHaveBeenCalled();
  });
});

describe('per-load overrides', () => {
  it('bumps the version, applies overrides + caps, clears prefilled, keeps cents', async () => {
    await AccessorialPolicyService.getOrCreateForLoad(dryVan);
    const updated = await AccessorialPolicyService.updatePolicy(dryVan, {
      freeTimeMinutes: 60,
      rateClass: 'SPECIALIZED',
      detentionHourlyRateCents: { STANDARD: 7500 },
      caps: { detentionMaxCents: 50000 },
    });
    expect(updated.version).toBe(2);
    expect(updated.prefilled).toBe(false);
    expect(updated.policy.freeTimeMinutes).toBe(60);
    expect(updated.rateClass).toBe('SPECIALIZED');
    expect(updated.policy.detentionHourlyRateCents.STANDARD).toBe(7500);
    expect(updated.policy.detentionHourlyRateCents.HAZMAT).toBe(17500); // untouched
    expect(updated.caps?.detentionMaxCents).toBe(50000);
  });

  it('rejects a non-integer-cents rate override', async () => {
    await expect(
      AccessorialPolicyService.updatePolicy(dryVan, { detentionHourlyRateCents: { STANDARD: 75.5 } })
    ).rejects.toThrow();
  });
});

describe('frozen snapshot + hash', () => {
  it('produces a stable hash that changes when the policy changes', async () => {
    const p1 = await AccessorialPolicyService.getOrCreateForLoad(dryVan);
    const s1 = AccessorialPolicyService.snapshotOf(p1);
    const s1again = AccessorialPolicyService.snapshotOf(p1);
    expect(s1.policyHash).toBe(s1again.policyHash);
    expect(s1.policyHash).toMatch(/^[0-9a-f]{64}$/);

    const p2 = await AccessorialPolicyService.updatePolicy(dryVan, { freeTimeMinutes: 30 });
    const s2 = AccessorialPolicyService.snapshotOf(p2);
    expect(s2.policyHash).not.toBe(s1.policyHash);
    expect(s2.version).toBe(2);
  });
});

describe('append-only acceptance (ESIGN/UETA)', () => {
  it('records an acceptance pinning the accepted version, hash, and statement', async () => {
    const a = await AccessorialPolicyService.acceptPolicy({
      load: dryVan,
      acceptedByUserId: 'user-1',
      signerRole: 'CARRIER',
      signatureType: 'click',
      signatureData: 'click',
      consentGiven: true,
      ipAddress: '203.0.113.7',
    });
    expect(a.acceptanceId.startsWith('apaccept_')).toBe(true);
    expect(a.loadId).toBe('load-1');
    expect(a.acceptedVersion).toBe(1);
    expect(a.policyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.consentGiven).toBe(true);
    expect(a.attestationVersion).toBe('1.0.0');
    expect(a.attestationText).toMatch(/ESIGN/);
    expect(putItem).toHaveBeenCalledWith(ACCEPT_TABLE, expect.objectContaining({ acceptanceId: a.acceptanceId }));
  });

  it('refuses to record without explicit consent', async () => {
    await expect(
      AccessorialPolicyService.acceptPolicy({
        load: dryVan,
        acceptedByUserId: 'user-1',
        signerRole: 'CARRIER',
        signatureType: 'click',
        signatureData: 'click',
        consentGiven: false,
      })
    ).rejects.toThrow(/CONSENT_REQUIRED/);
  });

  it('appends every acceptance (a re-accept is a new row, newest first)', async () => {
    await AccessorialPolicyService.acceptPolicy({
      load: dryVan, acceptedByUserId: 'u1', signerRole: 'CARRIER', signatureType: 'click', signatureData: 'c', consentGiven: true,
    });
    await new Promise((r) => setTimeout(r, 2));
    await AccessorialPolicyService.acceptPolicy({
      load: dryVan, acceptedByUserId: 'u2', signerRole: 'CARRIER', signatureType: 'click', signatureData: 'c', consentGiven: true,
    });
    const list = await AccessorialPolicyService.listAcceptances('load-1');
    expect(list.length).toBe(2);
    expect(list[0].signedAt).toBeGreaterThanOrEqual(list[1].signedAt);
    expect(tables[ACCEPT_TABLE].length).toBe(2);
    expect(updateItem).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
  });
});

describe('Load model isolation', () => {
  it('never reads or writes the loads table', async () => {
    await AccessorialPolicyService.getOrCreateForLoad(hazmatVan);
    await AccessorialPolicyService.acceptPolicy({
      load: hazmatVan, acceptedByUserId: 'u', signerRole: 'CARRIER', signatureType: 'click', signatureData: 'c', consentGiven: true,
    });
    for (const call of putItem.mock.calls) expect(call[0]).not.toBe(LOADS_TABLE);
    for (const call of getItem.mock.calls) expect(call[0]).not.toBe(LOADS_TABLE);
  });
});
