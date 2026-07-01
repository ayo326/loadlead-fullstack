/**
 * Detention/layover disclosure + acknowledgment.
 *
 * Proves the disclosure reads the load's frozen policy (standard -> $50/hr,
 * hazmat -> $175/hr), and that accepting with acknowledgment records ONE
 * append-only acceptance row carrying the e-sign plus the acknowledgment with the
 * policy version, the exact shown rates, and a server timestamp. A re-acceptance
 * appends a new row; an acceptance without acknowledgment records no ack block.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, updateItem, deleteItem } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      if (item.acceptanceId) { arr.push(item); return; } // acceptances append-only
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

const ACCEPT_TABLE = config.dynamodb.accessorialPolicyAcceptancesTable;

const dryVan = { loadId: 'load-std', hazmat: false, equipmentType: TrailerType.DRY_VAN };
const hazVan = { loadId: 'load-haz', hazmat: true, equipmentType: TrailerType.DRY_VAN };

function acceptInput(load: any, acknowledged: boolean) {
  return {
    load,
    acceptedByUserId: 'driver-1',
    signerRole: 'DRIVER',
    signatureType: 'click' as const,
    signatureData: 'acknowledged',
    consentGiven: true,
    acknowledged,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  updateItem.mockClear();
  deleteItem.mockClear();
});

describe('disclosure reads the freight-class rate from the snapshot', () => {
  it('a standard dry van discloses $50 per hour', async () => {
    const d = await AccessorialPolicyService.disclosureForLoad(dryVan);
    expect(d.rateClass).toBe('STANDARD');
    expect(d.detentionHourlyRateCents).toBe(5000);
    expect(d.freeTimeMinutes).toBe(120);
    expect(d.billingIncrementMinutes).toBe(15);
    expect(d.layoverThresholdMinutes).toBe(1440);
    expect(d.layoverDailyRateCents).toBe(15000);
  });

  it('a hazmat load discloses $175 per hour', async () => {
    const d = await AccessorialPolicyService.disclosureForLoad(hazVan);
    expect(d.rateClass).toBe('HAZMAT');
    expect(d.detentionHourlyRateCents).toBe(17500);
  });

  it('reflects a per-load rate override (no hardcoded numbers)', async () => {
    await AccessorialPolicyService.updatePolicy(dryVan, { detentionHourlyRateCents: { STANDARD: 6000 } });
    const d = await AccessorialPolicyService.disclosureForLoad(dryVan);
    expect(d.detentionHourlyRateCents).toBe(6000);
  });
});

describe('acknowledgment is recorded on the append-only acceptance', () => {
  it('accepting with acknowledgment records one row with version, exact rates, and a server timestamp', async () => {
    const a = await AccessorialPolicyService.acceptPolicy(acceptInput(dryVan, true));
    expect(a.consentGiven).toBe(true);
    expect(a.acknowledgment?.acknowledged).toBe(true);
    expect(typeof a.acknowledgment?.acknowledgedAt).toBe('number');
    expect(a.acknowledgment?.disclosure.detentionHourlyRateCents).toBe(5000);
    // the recorded policy version matches the acceptance version
    expect(a.acknowledgment?.disclosure.version).toBe(a.acceptedVersion);
    expect(tables[ACCEPT_TABLE].length).toBe(1);
  });

  it('a hazmat acceptance records the hazmat rate exactly as shown', async () => {
    const a = await AccessorialPolicyService.acceptPolicy(acceptInput(hazVan, true));
    expect(a.acknowledgment?.disclosure.detentionHourlyRateCents).toBe(17500);
    expect(a.acknowledgment?.disclosure.rateClass).toBe('HAZMAT');
  });

  it('accepting without acknowledgment records no ack block', async () => {
    const a = await AccessorialPolicyService.acceptPolicy(acceptInput(dryVan, false));
    expect(a.acknowledgment).toBeUndefined();
  });

  it('a re-acknowledgment appends a new row rather than mutating the first', async () => {
    await AccessorialPolicyService.acceptPolicy(acceptInput(dryVan, true));
    await new Promise((r) => setTimeout(r, 2));
    await AccessorialPolicyService.acceptPolicy(acceptInput(dryVan, true));
    expect(tables[ACCEPT_TABLE].length).toBe(2);
    expect(updateItem).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
  });
});
