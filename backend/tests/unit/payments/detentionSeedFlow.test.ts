/**
 * Detention seed helper (scripts/seedDetentionCharge.ts): reproduces the exact
 * sequence the helper performs — write a backdated ARRIVAL/DEPARTURE pair, then
 * AccessorialChargeService.computeForStop — and asserts a real $150 DETENTION
 * charge lands in PENDING_REVIEW (so it can be approved/adjusted/disputed), is
 * idempotent on re-run, and can then be approved into a billable state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, deleteItem } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  const pkOf = (item: any): string | null =>
    'eventId' in item ? 'eventId'
    : 'chargeId' in item ? 'chargeId'
    : 'historyId' in item ? 'historyId'
    : 'loadId' in item && 'version' in item && 'policy' in item ? 'loadId'
    : null;
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      const pk = pkOf(item);
      if (pk) {
        const idx = arr.findIndex((x) => x[pk] === item[pk]);
        if (idx >= 0) { arr[idx] = item; return; }
      }
      arr.push(item);
    }),
    getItem: vi.fn(async (table: string, key: any) => {
      const arr = tables[table] ?? [];
      return arr.find((x) => Object.keys(key).every((k) => x[k] === key[k])) ?? null;
    }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
    deleteItem: vi.fn(async (table: string, key: any) => {
      const arr = tables[table] ?? [];
      const idx = arr.findIndex((x) => Object.keys(key).every((k) => x[k] === key[k]));
      if (idx >= 0) arr.splice(idx, 1);
    }),
  };
});
vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, scan, deleteItem, updateItem: vi.fn() },
  default: { putItem, getItem, scan, deleteItem, updateItem: vi.fn() },
}));
vi.mock('../../../src/config/aws', () => ({ docClient: { send: vi.fn() } }));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import config from '../../../src/config/environment';
import { AccessorialChargeService, isBillable } from '../../../src/services/accessorialChargeService';
import { TrailerType } from '../../../src/types';
import type { StopEvent } from '../../../src/services/stopEventService';

const STOPS = config.dynamodb.stopEventsTable;

/** Mirror the helper: put a clean, backdated ARRIVAL/DEPARTURE pair for a stop. */
function seedPair(loadId: string, stopId: string, dwellMinutes: number, now = Date.now()) {
  const mk = (type: 'ARRIVAL' | 'DEPARTURE', eventAt: number, createdAt: number): StopEvent => ({
    eventId: `stopevt_SEEDDET_${loadId}_${stopId}_${type}`,
    loadId, stopId, eventType: type, eventAt, actorId: 'seed-script', createdAt,
  });
  putItem(STOPS, mk('ARRIVAL', now - dwellMinutes * 60000, now));
  putItem(STOPS, mk('DEPARTURE', now, now + 1));
}

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; });

describe('detention seed helper flow', () => {
  const load = { loadId: 'SEEDDET-TEST', equipmentType: TrailerType.DRY_VAN }; // STANDARD @ $50/hr

  it('a 5h dwell yields exactly $150 detention in PENDING_REVIEW (free 2h + 3h detained @ $50)', async () => {
    seedPair(load.loadId, 'DELIVERY', 300);
    const charge = await AccessorialChargeService.computeForStop(load, 'DELIVERY', 'seed');
    expect(charge).not.toBeNull();
    expect(charge!.type).toBe('DETENTION');
    expect(charge!.dwellMinutes).toBe(300);
    expect(charge!.billableMinutes).toBe(180); // 3h past the 2h free window
    expect(charge!.amountCents).toBe(15000);   // $150.00
    expect(charge!.status).toBe('PENDING_REVIEW'); // 3h > 2h auto-approve => review
    expect(isBillable(charge!)).toBe(false);
  });

  it('recompute is idempotent: same deterministic chargeId, no duplicate row', async () => {
    seedPair(load.loadId, 'DELIVERY', 300);
    const first = await AccessorialChargeService.computeForStop(load, 'DELIVERY', 'seed');
    const again = await AccessorialChargeService.computeForStop(load, 'DELIVERY', 'seed');
    expect(again!.chargeId).toBe(first!.chargeId);
    expect((tables[config.dynamodb.accessorialChargesTable] ?? []).length).toBe(1);
  });

  it('the shipper can then approve it into a billable state', async () => {
    seedPair(load.loadId, 'DELIVERY', 300);
    const charge = await AccessorialChargeService.computeForStop(load, 'DELIVERY', 'seed');
    const approved = await AccessorialChargeService.approve(charge!.chargeId, 'shipper-1');
    expect(approved.status).toBe('APPROVED');
    expect(isBillable(approved)).toBe(true);
  });

  it('a 2h detention auto-approves (the boundary the helper warns about)', async () => {
    seedPair(load.loadId, 'DELIVERY', 240); // free 2h + exactly 2h detained
    const charge = await AccessorialChargeService.computeForStop(load, 'DELIVERY', 'seed');
    expect(charge!.billableMinutes).toBe(120);
    expect(charge!.amountCents).toBe(10000); // $100 @ $50/hr
    expect(charge!.status).toBe('APPROVED');
  });
});
