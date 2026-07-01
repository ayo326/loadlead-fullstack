/**
 * Phase 4: append-only stop-events log.
 *
 * Proves server-set event time, the check-in/check-out writers, the ordered
 * effective ARRIVAL/DEPARTURE pair per stop, append-only correction semantics
 * (newest non-superseded wins, old rows retained), and Load-model isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, updateItem, deleteItem } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      (tables[table] ??= []).push(item);
    }),
    getItem: vi.fn(async () => null),
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
import { StopEventService } from '../../../src/services/stopEventService';

const STOP_TABLE = config.dynamodb.stopEventsTable;
const LOADS_TABLE = config.dynamodb.loadsTable;

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  getItem.mockClear();
  scan.mockClear();
  updateItem.mockClear();
  deleteItem.mockClear();
});

const base = { loadId: 'load-1', stopId: 'PICKUP', actorId: 'driver-1' };

describe('check-in / check-out writers', () => {
  it('records ARRIVAL and DEPARTURE with a server-set time and its own id namespace', async () => {
    const before = Date.now();
    const arr = await StopEventService.checkIn({ ...base, lat: 30.26, lng: -97.74, geofenceMatch: true, evidencePhotoId: 'photo-1' });
    const dep = await StopEventService.checkOut(base);
    expect(arr.eventId.startsWith('stopevt_')).toBe(true);
    expect(arr.eventType).toBe('ARRIVAL');
    expect(dep.eventType).toBe('DEPARTURE');
    expect(arr.eventAt).toBeGreaterThanOrEqual(before);
    expect(arr.geofenceMatch).toBe(true);
    expect(arr.evidencePhotoId).toBe('photo-1');
    expect(putItem).toHaveBeenCalledWith(STOP_TABLE, expect.objectContaining({ eventId: arr.eventId }));
  });

  it('rejects a client-supplied time except on a correction', async () => {
    await expect(StopEventService.checkIn({ ...base, eventAt: 123 })).rejects.toThrow(/eventAt/);
  });

  it('requires loadId, stopId, and actor', async () => {
    await expect(StopEventService.checkIn({ loadId: '', stopId: 'PICKUP', actorId: 'd' })).rejects.toThrow();
    await expect(StopEventService.checkIn({ loadId: 'l', stopId: '', actorId: 'd' })).rejects.toThrow();
    await expect(StopEventService.checkIn({ loadId: 'l', stopId: 's', actorId: '' })).rejects.toThrow();
  });
});

describe('effective arrival/departure pair', () => {
  it('returns the single arrival and departure for a stop', async () => {
    const arr = await StopEventService.checkIn(base);
    const dep = await StopEventService.checkOut(base);
    const pair = await StopEventService.effectivePair('load-1', 'PICKUP');
    expect(pair.arrival?.eventId).toBe(arr.eventId);
    expect(pair.departure?.eventId).toBe(dep.eventId);
  });

  it('a correction supersedes the named row; newest non-superseded wins, old row kept', async () => {
    const arr = await StopEventService.checkIn(base);
    await new Promise((r) => setTimeout(r, 2));
    // Correct the arrival time with a new append-only row.
    const corrected = await StopEventService.checkIn({
      ...base,
      correctsEventId: arr.eventId,
      eventAt: arr.eventAt - 60 * 60 * 1000, // arrived an hour earlier than first recorded
    });
    const pair = await StopEventService.effectivePair('load-1', 'PICKUP');
    expect(pair.arrival?.eventId).toBe(corrected.eventId);
    expect(pair.arrival?.eventAt).toBe(arr.eventAt - 60 * 60 * 1000);
    // Both rows remain; nothing was updated or deleted.
    expect(tables[STOP_TABLE].length).toBe(2);
    expect(updateItem).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
  });

  it('reports null sides when a stop is still open', async () => {
    await StopEventService.checkIn(base);
    const pair = await StopEventService.effectivePair('load-1', 'PICKUP');
    expect(pair.arrival).not.toBeNull();
    expect(pair.departure).toBeNull();
  });

  it('lists distinct stop ids for a load', async () => {
    await StopEventService.checkIn({ ...base, stopId: 'PICKUP' });
    await StopEventService.checkIn({ ...base, stopId: 'DELIVERY' });
    expect(await StopEventService.stopIds('load-1')).toEqual(['PICKUP', 'DELIVERY']);
  });
});

describe('table tolerance + Load isolation', () => {
  it('degrades to empty when the table does not exist yet', async () => {
    scan.mockImplementationOnce(async () => {
      const e: any = new Error('not found');
      e.name = 'ResourceNotFoundException';
      throw e;
    });
    expect(await StopEventService.list('load-1')).toEqual([]);
  });

  it('never reads or writes the loads table', async () => {
    await StopEventService.checkIn(base);
    await StopEventService.checkOut(base);
    await StopEventService.effectivePair('load-1', 'PICKUP');
    for (const call of putItem.mock.calls) expect(call[0]).toBe(STOP_TABLE);
    expect(putItem.mock.calls.some((c) => c[0] === LOADS_TABLE)).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
  });
});
