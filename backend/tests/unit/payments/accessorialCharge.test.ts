/**
 * Phase 5: accessorial charge ledger, calculation engine, and lifecycle.
 *
 * Covers the DoD calc matrix (free time, 15-min round-up, per-class rate, layover
 * past 24h, no-double-bill), idempotent recompute, auto-approve vs review,
 * append-only status history with original/new amounts on adjust, dispute raising
 * a trust event, and the "only APPROVED/SETTLED affect money" rule.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, updateItem, deleteItem } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      let pk: string | null = null;
      if ('chargeId' in item) pk = 'chargeId';
      else if ('loadId' in item && 'version' in item && 'policy' in item) pk = 'loadId';
      if (pk) {
        const idx = arr.findIndex((x) => x[pk!] === item[pk!]);
        if (idx >= 0) {
          arr[idx] = item;
          return;
        }
      }
      arr.push(item);
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
import { AccessorialChargeService, isBillable } from '../../../src/services/accessorialChargeService';

const CHARGES = config.dynamodb.accessorialChargesTable;
const HISTORY = config.dynamodb.chargeStatusHistoryTable;
const STOPS = config.dynamodb.stopEventsTable;
const TRUST = config.dynamodb.betaTrustEventsTable;

const HOUR = 3600 * 1000;
const dryVan = { loadId: 'load-1', hazmat: false, equipmentType: TrailerType.DRY_VAN };
const hazVan = { loadId: 'load-haz', hazmat: true, equipmentType: TrailerType.DRY_VAN };

function seedStop(loadId: string, stopId: string, arrivalAt: number, departureAt?: number) {
  tables[STOPS] ??= [];
  tables[STOPS].push({ eventId: `a-${loadId}-${stopId}`, loadId, stopId, eventType: 'ARRIVAL', eventAt: arrivalAt, actorId: 'd', createdAt: arrivalAt });
  if (departureAt != null) {
    tables[STOPS].push({ eventId: `d-${loadId}-${stopId}`, loadId, stopId, eventType: 'DEPARTURE', eventAt: departureAt, actorId: 'd', createdAt: departureAt });
  }
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  getItem.mockClear();
  scan.mockClear();
});

describe('calculation matrix', () => {
  it('a sub-free-time dwell bills nothing and auto-approves', async () => {
    seedStop('load-1', 'PICKUP', 0, 1 * HOUR); // 1h dwell, under the 2h free time
    const c = await AccessorialChargeService.computeForStop(dryVan, 'PICKUP', 'sys');
    expect(c!.type).toBe('DETENTION');
    expect(c!.amountCents).toBe(0);
    expect(c!.status).toBe('APPROVED');
  });

  it('a 3.5h dwell at the standard rate bills the rounded detained time and auto-approves', async () => {
    seedStop('load-1', 'PICKUP', 0, 3.5 * HOUR); // detained 90 min -> 1.5h * $50
    const c = await AccessorialChargeService.computeForStop(dryVan, 'PICKUP', 'sys');
    expect(c!.type).toBe('DETENTION');
    expect(c!.billableMinutes).toBe(90);
    expect(c!.amountCents).toBe(7500);
    expect(c!.status).toBe('APPROVED'); // 1.5h <= 2h auto-approve
  });

  it('a hazmat stop uses the hazmat rate', async () => {
    seedStop('load-haz', 'PICKUP', 0, 3.5 * HOUR); // 1.5h * $175
    const c = await AccessorialChargeService.computeForStop(hazVan, 'PICKUP', 'sys');
    expect(c!.rateClass).toBe('HAZMAT');
    expect(c!.amountCents).toBe(26250);
  });

  it('a 30h dwell produces layover, not detention, and does not double-bill', async () => {
    seedStop('load-1', 'DROP', 0, 30 * HOUR);
    const c = await AccessorialChargeService.computeForStop(dryVan, 'DROP', 'sys');
    expect(c!.type).toBe('LAYOVER');
    expect(c!.layoverDays).toBe(2); // 2 started 24h periods
    expect(c!.amountCents).toBe(30000); // 2 * $150
    expect(c!.billableMinutes).toBe(0); // no detention component
    expect(c!.status).toBe('PENDING_REVIEW'); // layover always routes to review
  });
});

describe('auto-approve vs review', () => {
  it('detention over the auto-approve hours routes to review; under auto-approves', async () => {
    seedStop('load-1', 'OVER', 0, 5 * HOUR); // detained 3h > 2h
    const over = await AccessorialChargeService.computeForStop(dryVan, 'OVER', 'sys');
    expect(over!.status).toBe('PENDING_REVIEW');
    expect(over!.amountCents).toBe(15000); // 3h * $50

    seedStop('load-1', 'UNDER', 0, 3 * HOUR); // detained 1h <= 2h
    const under = await AccessorialChargeService.computeForStop(dryVan, 'UNDER', 'sys');
    expect(under!.status).toBe('APPROVED');
    expect(under!.amountCents).toBe(5000);
  });
});

describe('idempotency', () => {
  it('recomputing a closed stop does not duplicate the charge or write new history', async () => {
    seedStop('load-1', 'PICKUP', 0, 3.5 * HOUR);
    const a = await AccessorialChargeService.computeForStop(dryVan, 'PICKUP', 'sys');
    const b = await AccessorialChargeService.computeForStop(dryVan, 'PICKUP', 'sys');
    expect(b!.chargeId).toBe(a!.chargeId);
    expect(tables[CHARGES].length).toBe(1);
    expect(tables[HISTORY].length).toBe(1); // only the initial transition
  });

  it('an open stop accrues provisionally', async () => {
    seedStop('load-1', 'OPEN', Date.now() - 3 * HOUR); // no departure
    const c = await AccessorialChargeService.computeForStop(dryVan, 'OPEN', 'sys');
    expect(c!.status).toBe('ACCRUING');
    expect(c!.provisional).toBe(true);
  });
});

describe('lifecycle: approve, adjust, dispute', () => {
  it('approve moves PENDING_REVIEW to APPROVED idempotently', async () => {
    seedStop('load-1', 'OVER', 0, 5 * HOUR);
    const c = await AccessorialChargeService.computeForStop(dryVan, 'OVER', 'sys');
    const ap = await AccessorialChargeService.approve(c!.chargeId, 'shipper-1');
    expect(ap.status).toBe('APPROVED');
    const again = await AccessorialChargeService.approve(c!.chargeId, 'shipper-1');
    expect(again.status).toBe('APPROVED');
  });

  it('adjust records the original and new amounts in append-only history', async () => {
    seedStop('load-1', 'OVER', 0, 5 * HOUR);
    const c = await AccessorialChargeService.computeForStop(dryVan, 'OVER', 'sys');
    const adj = await AccessorialChargeService.adjust(c!.chargeId, 9000, 'shipper-1', 'agreed reduction');
    expect(adj.status).toBe('ADJUSTED');
    expect(adj.amountCents).toBe(9000);
    const hist = await AccessorialChargeService.history(c!.chargeId);
    const adjRow = hist.find((h) => h.toStatus === 'ADJUSTED');
    expect(adjRow?.amountCentsBefore).toBe(15000);
    expect(adjRow?.amountCentsAfter).toBe(9000);
  });

  it('dispute moves to DISPUTED and raises a trust event against the mover', async () => {
    seedStop('load-1', 'OVER', 0, 5 * HOUR);
    const c = await AccessorialChargeService.computeForStop(dryVan, 'OVER', 'sys');
    const d = await AccessorialChargeService.dispute(c!.chargeId, 'shipper-1', 'carrier-9', 'service failure');
    expect(d.status).toBe('DISPUTED');
    const trust = tables[TRUST] ?? [];
    expect(trust.length).toBe(1);
    expect(trust[0]).toMatchObject({ eventType: 'TRUST_INCIDENT', loadId: 'load-1', carrierId: 'carrier-9' });
  });

  it('rejects an invalid transition', async () => {
    seedStop('load-1', 'UNDER', 0, 3 * HOUR); // auto-APPROVED
    const c = await AccessorialChargeService.computeForStop(dryVan, 'UNDER', 'sys');
    await AccessorialChargeService.markSettled(c!.chargeId, 'sys');
    await expect(AccessorialChargeService.adjust(c!.chargeId, 100, 'sys')).rejects.toThrow(/invalid charge transition/);
  });
});

describe('only APPROVED/SETTLED affect money', () => {
  it('isBillable reflects the money rule', () => {
    expect(isBillable({ status: 'APPROVED' })).toBe(true);
    expect(isBillable({ status: 'SETTLED' })).toBe(true);
    expect(isBillable({ status: 'PENDING_REVIEW' })).toBe(false);
    expect(isBillable({ status: 'ACCRUING' })).toBe(false);
    expect(isBillable({ status: 'DISPUTED' })).toBe(false);
    expect(isBillable({ status: 'ADJUSTED' })).toBe(false);
  });
});
