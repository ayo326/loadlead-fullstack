/**
 * Load negotiation: the full definition-of-done matrix.
 *
 * The docClient mock emulates DynamoDB conditional semantics for exactly the
 * commands the service issues (attribute_not_exists on the lock put; status
 * and turn equality on session updates; owner equality on lock delete), so
 * the concurrency guarantees are what is actually under test:
 *   - two haulers engaging concurrently -> one negotiation, one clear 409
 *   - only the party whose turn it is may act
 *   - repeated accept never assigns twice
 *   - late actions expire the negotiation and rebroadcast
 *   - offers are append-only; the Load model is never written
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const H = vi.hoisted(() => {
  const tables: Record<string, Map<string, any>> = {};
  const tbl = (name: string) => (tables[name] ??= new Map());
  // Table-aware key extraction: lock rows carry BOTH loadId and negotiationId
  // (keyed by loadId) and offer rows carry negotiationId (keyed by negOfferId),
  // so the key must come from the table, not from attribute presence.
  const keyOf = (table: string, item: any) =>
    table.includes('Locks') ? item.loadId
    : table.includes('Offers') ? item.negOfferId
    : item.negotiationId ?? item.loadId ?? item.id;

  function evalCondition(expr: string, existing: any, values: Record<string, any>): boolean {
    if (!expr) return true;
    if (expr.includes('attribute_not_exists')) return existing === undefined;
    // equality conditions: '#status = :expectStatus [AND #cop = :expectParty]' / 'negotiationId = :n'
    if (existing === undefined) return false;
    const checks: [string, string][] = [];
    if (expr.includes(':expectStatus')) checks.push(['status', ':expectStatus']);
    if (expr.includes(':expectParty')) checks.push(['currentOfferParty', ':expectParty']);
    if (expr.includes(':n')) checks.push(['negotiationId', ':n']);
    return checks.every(([attr, v]) => existing[attr] === values[v]);
  }

  const send = vi.fn(async (cmd: any) => {
    const name = cmd.constructor.name;
    const inp = cmd.input;
    const t = tbl(inp.TableName);
    if (name === 'PutCommand') {
      const k = keyOf(inp.TableName, inp.Item);
      if (!evalCondition(inp.ConditionExpression, t.get(k), inp.ExpressionAttributeValues ?? {})) {
        const e: any = new Error('conditional failed'); e.name = 'ConditionalCheckFailedException'; throw e;
      }
      t.set(k, { ...inp.Item });
      return {};
    }
    if (name === 'GetCommand') return { Item: t.get(keyOf(inp.TableName, inp.Key)) };
    if (name === 'DeleteCommand') {
      const k = keyOf(inp.TableName, inp.Key);
      if (!evalCondition(inp.ConditionExpression, t.get(k), inp.ExpressionAttributeValues ?? {})) {
        const e: any = new Error('conditional failed'); e.name = 'ConditionalCheckFailedException'; throw e;
      }
      t.delete(k);
      return {};
    }
    if (name === 'UpdateCommand') {
      const k = keyOf(inp.TableName, inp.Key);
      const existing = t.get(k);
      if (!evalCondition(inp.ConditionExpression, existing, inp.ExpressionAttributeValues ?? {})) {
        const e: any = new Error('conditional failed'); e.name = 'ConditionalCheckFailedException'; throw e;
      }
      // apply SET #si = :vi pairs
      const updated = { ...existing };
      const names = inp.ExpressionAttributeNames ?? {};
      const values = inp.ExpressionAttributeValues ?? {};
      for (const m of inp.UpdateExpression.replace(/^SET /, '').split(', ')) {
        const [n, v] = m.split(' = ');
        updated[names[n.trim()]] = values[v.trim()];
      }
      t.set(k, updated);
      return {};
    }
    throw new Error(`unmocked command ${name}`);
  });

  // Database wrapper reads/writes plain items through the same maps.
  const putItem = vi.fn(async (table: string, item: any) => { tbl(table).set(keyOf(table, item), { ...item }); });
  const getItem = vi.fn(async (table: string, key: any) => tbl(table).get(keyOf(table, key)) ?? null);
  const scan = vi.fn(async (table: string) => [...tbl(table).values()]);

  const loads = new Map<string, any>();
  const assignDriver = vi.fn(async (loadId: string, driverId: string) => {
    const l = loads.get(loadId); if (l) { l.assignedDriverId = driverId; l.status = 'BOOKED'; }
  });
  const getLoadById = vi.fn(async (loadId: string) => loads.get(loadId) ?? null);

  return { tables, tbl, send, putItem, getItem, scan, loads, assignDriver, getLoadById };
});

vi.mock('../../../src/config/aws', () => ({ docClient: { send: H.send } }));
vi.mock('../../../src/config/database', () => ({
  Database: { putItem: H.putItem, getItem: H.getItem, scan: H.scan, updateItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../../../src/services/loadService', () => ({
  LoadService: { getLoadById: H.getLoadById, assignDriver: H.assignDriver },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import config from '../../../src/config/environment';
import { NegotiationService, linehaulCentsAt } from '../../../src/services/negotiationService';
import { NEGOTIATION_POLICY } from '../../../src/config/negotiationPolicy';

const LOAD = () => ({
  loadId: 'load-1', shipperId: 'ship-1', rateType: 'PER_MILE', rateAmount: 2.5, totalMiles: 400,
});
const HAULER = { loadId: 'load-1', haulerCarrierId: 'carrier-1', haulerDriverId: 'drv-1', haulerUserId: 'user-h' };

beforeEach(() => {
  for (const k of Object.keys(H.tables)) delete H.tables[k];
  H.loads.clear();
  H.loads.set('load-1', LOAD());
  vi.clearAllMocks();
});

describe('engagement and the exclusive lock', () => {
  it('two haulers engaging the same load concurrently: one negotiation, one clear 409', async () => {
    const [a, b] = await Promise.allSettled([
      NegotiationService.engage(HAULER),
      NegotiationService.engage({ ...HAULER, haulerDriverId: 'drv-2', haulerUserId: 'user-h2', haulerCarrierId: 'carrier-2' }),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(String(failed.reason?.message)).toContain('no longer available');
  });

  it('an active negotiation excludes the load from other haulers (lock map)', async () => {
    await NegotiationService.engage(HAULER);
    const locks = await NegotiationService.activeLockedLoadIds();
    expect(locks.get('load-1')).toBe('drv-1'); // visible only to drv-1
  });

  it('snapshots the posted rate in integer cents per mile at engagement', async () => {
    const neg = await NegotiationService.engage(HAULER);
    expect(neg.postedRatePerMileCents).toBe(250); // $2.50/mi
    expect(neg.postedLinehaulCents).toBe(100000); // 250 x 400
    expect(neg.deadlineAt - neg.startedAt).toBe(NEGOTIATION_POLICY.windowMinutes * 60_000);
  });
});

describe('accept load at the posted rate', () => {
  it('assigns at the posted rate, terminal ACCEPTED, lock released', async () => {
    const neg = await NegotiationService.engage(HAULER);
    const done = await NegotiationService.acceptLoad(neg.negotiationId, 'drv-1');
    expect(done.status).toBe('ACCEPTED');
    expect(done.outcome).toBe('ACCEPT_LOAD');
    expect(done.agreedRatePerMileCents).toBe(250);
    expect(done.agreedLinehaulCents).toBe(100000);
    expect(H.assignDriver).toHaveBeenCalledWith('load-1', 'drv-1');
    expect((await NegotiationService.activeLockedLoadIds()).size).toBe(0);
  });
});

describe('M1: accept -> assign is atomic-ish (heals a failed assignment)', () => {
  it('a retry heals an accept whose assignment failed after the terminal transition', async () => {
    const neg = await NegotiationService.engage(HAULER);
    // First accept: the terminal transition to ACCEPTED succeeds, then the
    // assignDriver write fails (e.g. DynamoDB throttle).
    H.assignDriver.mockImplementationOnce(async () => { throw new Error('ddb throttled'); });
    await expect(NegotiationService.acceptLoad(neg.negotiationId, 'drv-1')).rejects.toThrow(/ddb throttled/);
    // Stranded: ACCEPTED, load unassigned, lock still held (release never reached).
    expect((await NegotiationService.getById(neg.negotiationId))!.status).toBe('ACCEPTED');
    expect(H.loads.get('load-1').assignedDriverId).toBeUndefined();
    expect((await NegotiationService.activeLockedLoadIds()).size).toBe(1);
    // A retry (idempotent) reconciles it: assigns + releases the lock.
    const healed = await NegotiationService.acceptLoad(neg.negotiationId, 'drv-1');
    expect(healed.status).toBe('ACCEPTED');
    expect(H.loads.get('load-1').assignedDriverId).toBe('drv-1');
    expect((await NegotiationService.activeLockedLoadIds()).size).toBe(0);
  });

  it('the reconcile sweeper heals an accepted-but-unassigned load with no client retry', async () => {
    const neg = await NegotiationService.engage(HAULER);
    H.assignDriver.mockImplementationOnce(async () => { throw new Error('ddb throttled'); });
    await expect(NegotiationService.acceptLoad(neg.negotiationId, 'drv-1')).rejects.toThrow();
    expect(H.loads.get('load-1').assignedDriverId).toBeUndefined();
    // No client retry — the background sweeper reconciles it.
    expect(await NegotiationService.reconcileAcceptedAssignments()).toBe(1);
    expect(H.loads.get('load-1').assignedDriverId).toBe('drv-1');
    expect((await NegotiationService.activeLockedLoadIds()).size).toBe(0);
    // Idempotent: a second sweep finds nothing to heal.
    expect(await NegotiationService.reconcileAcceptedAssignments()).toBe(0);
  });
});

describe('defensive guards (path-coverage COAs)', () => {
  it('U7: refuses to assign if the load was taken by another driver mid-negotiation', async () => {
    const neg = await NegotiationService.engage(HAULER);
    // The load gets assigned to a different driver out-of-band — should be
    // impossible while we hold the lock; this proves the guard is live code.
    H.loads.get('load-1').assignedDriverId = 'other-drv';
    await expect(NegotiationService.acceptLoad(neg.negotiationId, 'drv-1'))
      .rejects.toThrow(/assigned to another driver/i);
    expect(H.assignDriver).not.toHaveBeenCalled();
  });

  it('U3: accepting with no offer on the table returns 409 (stale-view accept)', async () => {
    // A PENDING_SHIPPER negotiation with no current offer — the normal flow
    // never produces this; it is reachable only from a stale client view.
    const now = Date.now();
    await H.putItem(config.dynamodb.loadNegotiationsTable, {
      negotiationId: 'neg-u3', loadId: 'load-1', shipperId: 'ship-1',
      haulerCarrierId: 'carrier-1', haulerDriverId: 'drv-1', haulerUserId: 'user-h',
      status: 'PENDING_SHIPPER', rateBasis: 'PER_MILE',
      postedRatePerMileCents: 250, postedLinehaulCents: 100000,
      currentOfferRatePerMileCents: null, currentOfferTotalCents: null, currentOfferParty: 'HAULER',
      totalMiles: 400, roundCount: 1,
      startedAt: now, deadlineAt: now + 600_000, createdAt: now, updatedAt: now,
    });
    await expect(NegotiationService.acceptOffer('neg-u3', { party: 'SHIPPER', shipperId: 'ship-1' }))
      .rejects.toThrow(/No offer is on the table/i);
    expect(H.assignDriver).not.toHaveBeenCalled();
  });

  it('U5: expireIfOverdue short-circuits on a terminal negotiation (idempotent)', async () => {
    // Already EXPIRED → reports expired without touching the store.
    const expired = { negotiationId: 'x', loadId: 'load-1', status: 'EXPIRED', deadlineAt: Date.now() + 1000 } as any;
    expect(await NegotiationService.expireIfOverdue(expired)).toBe(true);
    // Terminal but NOT expired (ACCEPTED) → not expired.
    const accepted = { negotiationId: 'y', loadId: 'load-1', status: 'ACCEPTED', deadlineAt: Date.now() - 1000 } as any;
    expect(await NegotiationService.expireIfOverdue(accepted)).toBe(false);
  });

  it('U6: a losing conditional-write during expiry still reports expired (fall-through)', async () => {
    const now = Date.now();
    // Stored row moved on (PENDING_SHIPPER); we hand expireIfOverdue a stale
    // ENGAGED snapshot past its deadline, so the conditional transition loses.
    await H.putItem(config.dynamodb.loadNegotiationsTable, {
      negotiationId: 'neg-u6', loadId: 'load-1', shipperId: 'ship-1', haulerDriverId: 'drv-1',
      status: 'PENDING_SHIPPER', rateBasis: 'PER_MILE', totalMiles: 400,
      deadlineAt: now - 1_000, updatedAt: now - 1_000,
    });
    const stale = { negotiationId: 'neg-u6', loadId: 'load-1', status: 'ENGAGED', deadlineAt: now - 1_000 } as any;
    expect(await NegotiationService.expireIfOverdue(stale)).toBe(true);
  });

  it('U4: rejecting after the window expired returns the rebroadcast (expired) negotiation', async () => {
    const now = Date.now();
    await H.putItem(config.dynamodb.loadNegotiationsTable, {
      negotiationId: 'neg-u4', loadId: 'load-1', shipperId: 'ship-1',
      haulerCarrierId: 'carrier-1', haulerDriverId: 'drv-1', haulerUserId: 'user-h',
      status: 'PENDING_SHIPPER', rateBasis: 'PER_MILE',
      postedRatePerMileCents: 250, currentOfferRatePerMileCents: 240, currentOfferParty: 'HAULER',
      totalMiles: 400, roundCount: 1,
      startedAt: now - 10_000, deadlineAt: now - 1_000, createdAt: now - 10_000, updatedAt: now - 10_000,
    });
    const result = await NegotiationService.reject('neg-u4', { party: 'HAULER', driverId: 'drv-1' });
    expect(result.status).toBe('EXPIRED');
    expect(H.assignDriver).not.toHaveBeenCalled();
  });

  it('U1: a non-conditional lock error is rethrown, not swallowed as a 409', async () => {
    // The exclusive-lock PutCommand fails with a generic (non-conditional)
    // error; engage must propagate it rather than report "no longer available".
    H.send.mockImplementationOnce(async () => { throw new Error('dynamo exploded'); });
    await expect(NegotiationService.engage(HAULER)).rejects.toThrow(/dynamo exploded/);
  });
});

describe('bid -> shipper actions', () => {
  it('bid then shipper accept assigns at the hauler rate with linehaul round(rate x miles)', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 });
    const done = await NegotiationService.acceptOffer(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' });
    expect(done.status).toBe('ACCEPTED');
    expect(done.outcome).toBe('ACCEPT_BID');
    expect(done.agreedRatePerMileCents).toBe(300);
    expect(done.agreedLinehaulCents).toBe(linehaulCentsAt(300, 400)); // 120000
    expect(H.assignDriver).toHaveBeenCalledWith('load-1', 'drv-1');
  });

  it('bid, shipper counter, hauler accept-counter assigns at the shipper rate', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 320 });
    await NegotiationService.counter(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' }, { ratePerMileCents: 280 });
    const done = await NegotiationService.acceptOffer(neg.negotiationId, { party: 'HAULER', driverId: 'drv-1' });
    expect(done.outcome).toBe('ACCEPT_COUNTER');
    expect(done.agreedRatePerMileCents).toBe(280);
    expect(done.agreedLinehaulCents).toBe(112000);
  });

  it('turn enforcement: the hauler cannot act on the shipper turn and the reverse', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 }); // now PENDING_SHIPPER
    await expect(NegotiationService.counter(neg.negotiationId, { party: 'HAULER', driverId: 'drv-1' }, { ratePerMileCents: 310 }))
      .rejects.toThrow(/not your turn/);
    await NegotiationService.counter(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' }, { ratePerMileCents: 275 }); // now PENDING_HAULER
    await expect(NegotiationService.counter(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' }, { ratePerMileCents: 270 }))
      .rejects.toThrow(/not your turn/);
  });

  it('reject rebroadcasts: lock released, load unassigned, offer row appended', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 });
    const done = await NegotiationService.reject(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' });
    expect(done.status).toBe('REJECTED');
    expect((await NegotiationService.activeLockedLoadIds()).size).toBe(0);
    expect(H.loads.get('load-1').assignedDriverId).toBeUndefined();
    const offers = await NegotiationService.offersFor(neg.negotiationId);
    expect(offers.map((o) => o.action)).toEqual(['BID', 'REJECT']);
  });

  it('the same load can be engaged again after rejection (including by the same hauler)', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await NegotiationService.reject(neg.negotiationId, { party: 'HAULER', driverId: 'drv-1' });
    const again = await NegotiationService.engage(HAULER);
    expect(again.negotiationId).not.toBe(neg.negotiationId);
    expect(again.status).toBe('ENGAGED');
  });
});

describe('window expiry', () => {
  it('an action after the deadline expires the negotiation and rebroadcasts', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 });
    vi.spyOn(Date, 'now').mockReturnValue(neg.deadlineAt + 60_000);
    await expect(NegotiationService.acceptOffer(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' }))
      .rejects.toThrow(/expired/);
    const after = await NegotiationService.getById(neg.negotiationId);
    expect(after!.status).toBe('EXPIRED');
    expect((await NegotiationService.activeLockedLoadIds()).size).toBe(0);
    vi.restoreAllMocks();
  });

  it('the sweeper expires overdue negotiations and releases their locks', async () => {
    const neg = await NegotiationService.engage(HAULER);
    vi.spyOn(Date, 'now').mockReturnValue(neg.deadlineAt + 1);
    const n = await NegotiationService.expireOverdue();
    expect(n).toBe(1);
    expect((await NegotiationService.getById(neg.negotiationId))!.status).toBe('EXPIRED');
    expect((await NegotiationService.activeLockedLoadIds()).size).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('idempotency and validation', () => {
  it('a repeated accept does not assign twice', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 });
    const once = await NegotiationService.acceptOffer(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' });
    const twice = await NegotiationService.acceptOffer(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' });
    expect(twice.negotiationId).toBe(once.negotiationId);
    expect(twice.agreedLinehaulCents).toBe(once.agreedLinehaulCents);
    expect(H.assignDriver).toHaveBeenCalledTimes(1);
  });

  it('a non-positive or non-integer bid is rejected', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await expect(NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 0 })).rejects.toThrow(/at least/);
    await expect(NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 250.5 as any })).rejects.toThrow(/integer/);
  });

  it('every action is a new append-only offer row; nothing is mutated', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 });
    await NegotiationService.counter(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' }, { ratePerMileCents: 280 });
    await NegotiationService.counter(neg.negotiationId, { party: 'HAULER', driverId: 'drv-1' }, { ratePerMileCents: 290 });
    await NegotiationService.acceptOffer(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' });
    const offers = await NegotiationService.offersFor(neg.negotiationId);
    expect(offers.map((o) => `${o.party}:${o.action}`)).toEqual([
      'HAULER:BID', 'SHIPPER:COUNTER', 'HAULER:COUNTER', 'SHIPPER:ACCEPT_BID',
    ]);
    expect(new Set(offers.map((o) => o.negOfferId)).size).toBe(4);
  });

  it('the Load model is never written by the negotiation store (only assignDriver on accept)', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 });
    await NegotiationService.reject(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' });
    expect(H.assignDriver).not.toHaveBeenCalled();
    expect(H.loads.get('load-1')).toEqual(LOAD()); // untouched
  });

  it('a FLAT_RATE load negotiates in flat totals: per-mile field rejected, totalCents flows end to end', async () => {
    H.loads.set('load-1', { loadId: 'load-1', shipperId: 'ship-1', rateType: 'FLAT_RATE', rateAmount: 1200, totalMiles: 400 });
    const neg = await NegotiationService.engage(HAULER);
    expect(neg.rateBasis).toBe('FLAT_TOTAL');
    // wrong-unit fields are rejected in both directions
    await expect(NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 })).rejects.toThrow(/flat rate/);
    // hauler bids a flat total, shipper counters a flat total, hauler accepts
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { totalCents: 135000 });
    await expect(NegotiationService.counter(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' }, { ratePerMileCents: 280 })).rejects.toThrow(/flat rate/);
    await NegotiationService.counter(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' }, { totalCents: 125000 });
    const done = await NegotiationService.acceptOffer(neg.negotiationId, { party: 'HAULER', driverId: 'drv-1' });
    expect(done.status).toBe('ACCEPTED');
    expect(done.agreedRatePerMileCents).toBeNull();
    expect(done.agreedLinehaulCents).toBe(125000); // the accepted flat total
    expect(H.assignDriver).toHaveBeenCalledWith('load-1', 'drv-1');
  });

  it('a FLAT_RATE load can still be accepted at the posted amount', async () => {
    H.loads.set('load-1', { loadId: 'load-1', shipperId: 'ship-1', rateType: 'FLAT_RATE', rateAmount: 1200, totalMiles: 400 });
    const neg = await NegotiationService.engage(HAULER);
    const done = await NegotiationService.acceptLoad(neg.negotiationId, 'drv-1');
    expect(done.status).toBe('ACCEPTED');
    expect(done.agreedLinehaulCents).toBe(120000); // the flat amount in cents
  });

  it('a PER_MILE load rejects a totalCents offer (unit safety both ways)', async () => {
    const neg = await NegotiationService.engage(HAULER);
    await expect(NegotiationService.bid(neg.negotiationId, 'drv-1', { totalCents: 100000 })).rejects.toThrow(/cents per mile/);
  });

  it('waitForChange resolves as soon as the negotiation moves past since (long-poll seam)', async () => {
    const neg = await NegotiationService.engage(HAULER);
    const since = neg.updatedAt;
    const wait = NegotiationService.waitForChange('load-1', since, { holdMs: 3000, stepMs: 20 });
    // act after the wait has armed
    await new Promise((r) => setTimeout(r, 40));
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 });
    const changed = await wait;
    expect(changed).not.toBeNull();
    expect(changed!.status).toBe('PENDING_SHIPPER');
    expect(changed!.updatedAt).toBeGreaterThan(since);
  });

  it('waitForChange returns null when nothing changes inside the hold window', async () => {
    const neg = await NegotiationService.engage(HAULER);
    const out = await NegotiationService.waitForChange('load-1', neg.updatedAt, { holdMs: 80, stepMs: 20 });
    expect(out).toBeNull();
  });

  it('settlement seam: agreedLinehaulCentsFor returns the negotiated linehaul only when ACCEPTED', async () => {
    const neg = await NegotiationService.engage(HAULER);
    expect(await NegotiationService.agreedLinehaulCentsFor('load-1')).toBeNull();
    await NegotiationService.bid(neg.negotiationId, 'drv-1', { ratePerMileCents: 300 });
    await NegotiationService.acceptOffer(neg.negotiationId, { party: 'SHIPPER', shipperId: 'ship-1' });
    expect(await NegotiationService.agreedLinehaulCentsFor('load-1')).toBe(120000);
  });
});
