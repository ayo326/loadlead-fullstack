/**
 * BetaTrustEventService: recording each event type, aggregation counts, and the
 * hard boundary that these events never touch the Load model.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, updateItem, scan } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      (tables[table] ??= []).push(item);
    }),
    getItem: vi.fn(async () => null),
    updateItem: vi.fn(async () => ({})),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, updateItem, scan },
  default: { putItem, getItem, updateItem, scan },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import config from '../../../src/config/environment';
import { BetaTrustEventService } from '../../../src/services/betaTrustEventService';

const TRUST_TABLE = config.dynamodb.betaTrustEventsTable;
const LOADS_TABLE = config.dynamodb.loadsTable;

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  getItem.mockClear();
  updateItem.mockClear();
  scan.mockClear();
});

describe('BetaTrustEventService', () => {
  it('records a NO_SHOW into the beta trust store with its own id namespace', async () => {
    const ev = await BetaTrustEventService.record({
      eventType: 'NO_SHOW',
      loadId: 'load-1',
      carrierId: 'carrier-1',
      recordedByAdminId: 'admin-1',
      note: 'accepted then never showed',
    });
    expect(ev.eventType).toBe('NO_SHOW');
    expect(ev.eventId.startsWith('btrust_')).toBe(true);
    expect(ev.loadId).toBe('load-1');
    expect(ev.carrierId).toBe('carrier-1');
    expect(ev.recordedByAdminId).toBe('admin-1');
    expect(typeof ev.recordedAt).toBe('number');
    expect(putItem).toHaveBeenCalledWith(TRUST_TABLE, expect.objectContaining({ eventId: ev.eventId }));
  });

  it('records a TRUST_INCIDENT', async () => {
    const ev = await BetaTrustEventService.record({
      eventType: 'TRUST_INCIDENT',
      loadId: 'load-2',
      carrierId: 'carrier-2',
      recordedByAdminId: 'admin-1',
    });
    expect(ev.eventType).toBe('TRUST_INCIDENT');
  });

  it('rejects an invalid event type', async () => {
    await expect(
      BetaTrustEventService.record({
        eventType: 'BOGUS' as any,
        loadId: 'l',
        carrierId: 'c',
        recordedByAdminId: 'a',
      })
    ).rejects.toThrow();
  });

  it('aggregates counts by type', async () => {
    await BetaTrustEventService.record({ eventType: 'NO_SHOW', loadId: 'l1', carrierId: 'c1', recordedByAdminId: 'a' });
    await BetaTrustEventService.record({ eventType: 'NO_SHOW', loadId: 'l2', carrierId: 'c1', recordedByAdminId: 'a' });
    await BetaTrustEventService.record({ eventType: 'TRUST_INCIDENT', loadId: 'l3', carrierId: 'c2', recordedByAdminId: 'a' });
    expect(await BetaTrustEventService.getCounts()).toEqual({ noShows: 2, trustIncidents: 1 });
  });

  it('returns a real 0 for both counts when no events exist', async () => {
    expect(await BetaTrustEventService.getCounts()).toEqual({ noShows: 0, trustIncidents: 0 });
  });

  it('degrades to empty (not a throw) when the table does not exist yet', async () => {
    scan.mockImplementationOnce(async () => {
      const e: any = new Error('Requested resource not found');
      e.name = 'ResourceNotFoundException';
      throw e;
    });
    expect(await BetaTrustEventService.getCounts()).toEqual({ noShows: 0, trustIncidents: 0 });
  });

  it('windows counts by recordedAt', async () => {
    const ev = await BetaTrustEventService.record({ eventType: 'NO_SHOW', loadId: 'l', carrierId: 'c', recordedByAdminId: 'a' });
    expect(await BetaTrustEventService.getCounts({ toMs: ev.recordedAt - 1 })).toEqual({ noShows: 0, trustIncidents: 0 });
    expect(await BetaTrustEventService.getCounts({ fromMs: ev.recordedAt, toMs: ev.recordedAt })).toEqual({
      noShows: 1,
      trustIncidents: 0,
    });
  });

  it('does NOT touch or require any Load model change (no read or write of the loads table)', async () => {
    await BetaTrustEventService.record({ eventType: 'NO_SHOW', loadId: 'load-1', carrierId: 'carrier-1', recordedByAdminId: 'a' });
    await BetaTrustEventService.getCounts();
    await BetaTrustEventService.list({ loadId: 'load-1' });

    // Every write went to the trust events table, never the loads table.
    for (const call of putItem.mock.calls) expect(call[0]).toBe(TRUST_TABLE);
    expect(putItem.mock.calls.some((c) => c[0] === LOADS_TABLE)).toBe(false);
    // The service never reads or updates a load.
    expect(getItem).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
    // The stored record references the load and carrier by id only.
    const stored = tables[TRUST_TABLE][0];
    expect(stored.loadId).toBe('load-1');
    expect(stored.carrierId).toBe('carrier-1');
  });
});
