/**
 * Hauler on-board capacity - Phase 7 definition-of-done tests.
 *
 * Covers the spec matrix: registration empty/loaded branches, reject-over-rated,
 * login-prompt gating (active load / fresh / stale / unknown), idempotent deduct,
 * restore on delivery, declare-empty-with-active-load, soft/hard/off matching,
 * unknown-treated-as-rated, and resolver determinism. The fold and the filter are
 * pure, so most of this needs no I/O; the service tests use an in-memory Database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, query } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (t: string, item: any) => { (tables[t] ??= []).push(item); }),
    query: vi.fn(async (t: string, _idx: any, _kc: any, _names: any, values: any) => {
      const eq = values?.[':e'];
      return (tables[t] ?? []).filter((r) => r.equipmentId === eq);
    }),
  };
});
vi.mock('../../../src/config/database', () => ({
  Database: { putItem, query, getItem: vi.fn(async () => null), updateItem: vi.fn(), scan: vi.fn(async () => []) },
  default: { putItem, query, getItem: vi.fn(async () => null), updateItem: vi.fn(), scan: vi.fn(async () => []) },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  HaulerCapacityService,
  foldSnapshot,
  needsCapacityPrompt,
  effectiveRemainingForMatching,
  applyCapacityFilter,
} from '../../../src/services/haulerCapacityService';
import { CapacityStateEvent, CapacityEventType } from '../../../src/types';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
let seq = 0;
function evt(type: CapacityEventType, extra: Partial<CapacityStateEvent> = {}): CapacityStateEvent {
  return {
    eventId: `capevt_${seq++}`,
    carrierId: 'car-1',
    equipmentId: 'drv-1',
    eventType: type,
    source: 'SYSTEM',
    createdAt: NOW,
    ...extra,
  };
}

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; seq = 0; putItem.mockClear(); });

describe('foldSnapshot (the single resolver)', () => {
  it('registration EMPTY branch: DECLARED_EMPTY leaves remaining at full rated', () => {
    const s = foldSnapshot('drv-1', 45000, [evt('DECLARED_EMPTY')], NOW);
    expect(s.declState).toBe('EMPTY');
    expect(s.declaredExternalWeightLbs).toBe(0);
    expect(s.remainingWeightLbs).toBe(45000);
    expect(s.stale).toBe(false);
  });

  it('registration LOADED branch: 17,500 on a 45,000 dry van leaves 27,500 remaining', () => {
    const s = foldSnapshot('drv-1', 45000, [evt('DECLARED_LOADED', { weightLbs: 17500 })], NOW);
    expect(s.declState).toBe('LOADED');
    expect(s.onboardWeightLbs).toBe(17500);
    expect(s.remainingWeightLbs).toBe(27500);
  });

  it('idempotent: two PLATFORM_DEDUCT events for the same load count once', () => {
    const s = foldSnapshot('drv-1', 45000, [
      evt('PLATFORM_DEDUCT', { loadId: 'load-1', weightLbs: 12000, createdAt: NOW - 2 }),
      evt('PLATFORM_DEDUCT', { loadId: 'load-1', weightLbs: 12000, createdAt: NOW - 1 }),
    ], NOW);
    expect(s.platformActiveWeightLbs).toBe(12000);
    expect(s.remainingWeightLbs).toBe(33000);
    expect(s.hasActivePlatformLoad).toBe(true);
  });

  it('POD delivery: a DEDUCT then RESTORE for a load nets to zero platform weight', () => {
    const s = foldSnapshot('drv-1', 45000, [
      evt('PLATFORM_DEDUCT', { loadId: 'load-1', weightLbs: 12000, createdAt: NOW - 2 }),
      evt('PLATFORM_RESTORE', { loadId: 'load-1', createdAt: NOW - 1 }),
    ], NOW);
    expect(s.platformActiveWeightLbs).toBe(0);
    expect(s.hasActivePlatformLoad).toBe(false);
    expect(s.remainingWeightLbs).toBe(45000);
  });

  it('BL-L1: same-millisecond declarations fold deterministically by seq, not array order', () => {
    // Two declarations written in the same ms; the EMPTY has the higher seq (later).
    const loaded = evt('DECLARED_LOADED', { weightLbs: 5000, createdAt: NOW, seq: 1 });
    const empty = evt('DECLARED_EMPTY', { createdAt: NOW, seq: 2 });
    // Either array order must fold to the same result - EMPTY wins by seq.
    const a = foldSnapshot('drv-1', 45000, [loaded, empty], NOW);
    const b = foldSnapshot('drv-1', 45000, [empty, loaded], NOW);
    expect(a.declState).toBe('EMPTY');
    expect(b.declState).toBe('EMPTY');
    expect(a.declaredExternalWeightLbs).toBe(b.declaredExternalWeightLbs);
  });

  it('BL-L1: same-ms DEDUCT+RESTORE of one load nets to zero regardless of array order', () => {
    const deduct = evt('PLATFORM_DEDUCT', { loadId: 'load-1', weightLbs: 12000, createdAt: NOW, seq: 1 });
    const restore = evt('PLATFORM_RESTORE', { loadId: 'load-1', createdAt: NOW, seq: 2 });
    const a = foldSnapshot('drv-1', 45000, [deduct, restore], NOW);
    const b = foldSnapshot('drv-1', 45000, [restore, deduct], NOW);
    expect(a.hasActivePlatformLoad).toBe(false);
    expect(b.hasActivePlatformLoad).toBe(false);
  });

  it('declaring EMPTY during an active platform load clears only the external component', () => {
    const s = foldSnapshot('drv-1', 45000, [
      evt('PLATFORM_DEDUCT', { loadId: 'load-1', weightLbs: 12000, createdAt: NOW - 2 }),
      evt('DECLARED_LOADED', { weightLbs: 5000, createdAt: NOW - 1 }),
      evt('DECLARED_EMPTY', { createdAt: NOW }),
    ], NOW);
    expect(s.declaredExternalWeightLbs).toBe(0);   // external cleared
    expect(s.platformActiveWeightLbs).toBe(12000); // platform-known stands
    expect(s.remainingWeightLbs).toBe(33000);
  });

  it('remaining floors at zero and never goes negative', () => {
    const s = foldSnapshot('drv-1', 10000, [evt('DECLARED_LOADED', { weightLbs: 10000 })], NOW);
    expect(s.remainingWeightLbs).toBe(0);
  });

  it('staleness: a 13-hour-old declaration is stale (window is 12h)', () => {
    const fresh = foldSnapshot('drv-1', 45000, [evt('DECLARED_EMPTY', { createdAt: NOW - 3 * HOUR })], NOW);
    expect(fresh.stale).toBe(false);
    const stale = foldSnapshot('drv-1', 45000, [evt('DECLARED_EMPTY', { createdAt: NOW - 13 * HOUR })], NOW);
    expect(stale.stale).toBe(true);
  });

  it('is deterministic: same events yield an identical snapshot for every surface', () => {
    const events = [evt('DECLARED_LOADED', { weightLbs: 8000 })];
    expect(foldSnapshot('drv-1', 45000, events, NOW)).toEqual(foldSnapshot('drv-1', 45000, events, NOW));
  });
});

describe('needsCapacityPrompt (smart login prompt gating)', () => {
  it('does NOT prompt when a platform load is active', () => {
    const s = foldSnapshot('drv-1', 45000, [evt('PLATFORM_DEDUCT', { loadId: 'l1', weightLbs: 9000 })], NOW);
    expect(needsCapacityPrompt(s)).toBe(false);
  });
  it('does NOT prompt when the declared state is fresh', () => {
    const s = foldSnapshot('drv-1', 45000, [evt('DECLARED_EMPTY', { createdAt: NOW - 2 * HOUR })], NOW);
    expect(needsCapacityPrompt(s)).toBe(false);
  });
  it('prompts when state is unknown', () => {
    expect(needsCapacityPrompt(foldSnapshot('drv-1', 45000, [], NOW))).toBe(true);
  });
  it('prompts when the declaration is stale', () => {
    const s = foldSnapshot('drv-1', 45000, [evt('DECLARED_EMPTY', { createdAt: NOW - 13 * HOUR })], NOW);
    expect(needsCapacityPrompt(s)).toBe(true);
  });
});

describe('capacity-aware matching (Phase 6)', () => {
  const loads = [
    { id: 'a', totalWeightLbs: 40000 }, // over 34,000 remaining
    { id: 'b', totalWeightLbs: 10000 }, // fits
  ];
  const snap = foldSnapshot('drv-1', 45000, [evt('DECLARED_LOADED', { weightLbs: 11000 })], NOW); // remaining 34,000

  it('soft mode badges the oversized load and sorts it below fitting loads', () => {
    const out = applyCapacityFilter(loads, snap, 'soft');
    expect(out.map((l) => l.id)).toEqual(['b', 'a']);       // fitting first
    expect(out.find((l) => l.id === 'a')!.capacityFits).toBe(false);
    expect(out.find((l) => l.id === 'a')!.capacityBadge).toMatch(/Over your available capacity/);
    expect(out.find((l) => l.id === 'b')!.capacityBadge).toBeNull();
  });
  it('hard mode excludes the oversized load', () => {
    const out = applyCapacityFilter(loads, snap, 'hard');
    expect(out.map((l) => l.id)).toEqual(['b']);
  });
  it('off mode changes nothing and marks everything as fitting', () => {
    const out = applyCapacityFilter(loads, snap, 'off');
    expect(out.map((l) => l.id)).toEqual(['a', 'b']);
    expect(out.every((l) => l.capacityFits)).toBe(true);
  });
  it('unknown state leaves the board full (treated as rated)', () => {
    const unknown = foldSnapshot('drv-1', 45000, [], NOW);
    expect(effectiveRemainingForMatching(unknown)).toBe(45000);
    const out = applyCapacityFilter(loads, unknown, 'hard');
    expect(out.map((l) => l.id)).toEqual(['a', 'b']); // 40,000 fits within 45,000 rated
  });
});

describe('HaulerCapacityService (append-only store, in-memory DB)', () => {
  it('rejects a declared weight above rated with a clear message', async () => {
    await expect(
      HaulerCapacityService.declareLoaded('drv-1', 'car-1', 50000, 45000, 'REGISTRATION'),
    ).rejects.toThrow(/cannot exceed your rated capacity/);
  });

  it('declareLoaded 17,500 then getCapacity resolves to 27,500 remaining', async () => {
    await HaulerCapacityService.declareLoaded('drv-1', 'car-1', 17500, 45000, 'REGISTRATION');
    const s = await HaulerCapacityService.getCapacity('drv-1', 45000, 'car-1');
    expect(s.remainingWeightLbs).toBe(27500);
    expect(s.declState).toBe('LOADED');
  });

  it('platformDeduct is idempotent per loadId (a repeated assign never double-deducts)', async () => {
    const first = await HaulerCapacityService.platformDeduct('drv-1', 'car-1', 'load-1', 12000);
    const second = await HaulerCapacityService.platformDeduct('drv-1', 'car-1', 'load-1', 12000);
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // no-op
    const s = await HaulerCapacityService.getCapacity('drv-1', 45000, 'car-1');
    expect(s.platformActiveWeightLbs).toBe(12000);
    expect(s.remainingWeightLbs).toBe(33000);
  });

  it('platformRestore after a deduct frees the weight; restore without a deduct is a no-op', async () => {
    await HaulerCapacityService.platformDeduct('drv-1', 'car-1', 'load-1', 12000);
    const restored = await HaulerCapacityService.platformRestore('drv-1', 'car-1', 'load-1');
    expect(restored).not.toBeNull();
    expect((await HaulerCapacityService.getCapacity('drv-1', 45000, 'car-1')).remainingWeightLbs).toBe(45000);

    const noop = await HaulerCapacityService.platformRestore('drv-1', 'car-1', 'never-deducted');
    expect(noop).toBeNull();
  });
});
