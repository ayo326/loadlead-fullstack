/**
 * Load negotiation: engage, bid, counter, accept, reject, expire.
 *
 * The first hauler to engage a broadcast load acquires an exclusive per-load
 * lock (conditional put on the locks table - the DynamoDB equivalent of a
 * unique partial index). While the negotiation is active the load is hidden
 * from every other hauler (loadboard filters on the lock, and the legacy
 * accept path refuses locked loads). The two sides then alternate offers
 * inside a fixed window; on accept the load is assigned at the agreed rate
 * through the existing assignment path, and the agreed linehaul becomes the
 * settlement input. On reject or expiry the lock releases and the load
 * returns to the pool at its posted rate (the Load row is NEVER mutated).
 *
 * Concurrency rules, all enforced with conditional writes so simultaneous
 * actions cannot double-apply:
 *   - one active negotiation per load (attribute_not_exists on the lock)
 *   - only the party whose turn it is may act (status + turn condition)
 *   - assignment is idempotent (a repeated accept returns the same result)
 *
 * Offers are append-only: every action is an immutable row in the offers
 * table. Corrections are new rows. Money is integer cents; rates are integer
 * cents per mile; linehaul = round(ratePerMileCents * miles).
 *
 * Statuses: ENGAGED (hauler holds the lock, deciding between Accept load and
 * Bid) -> PENDING_SHIPPER <-> PENDING_HAULER -> ACCEPTED | REJECTED | EXPIRED.
 * ENGAGED is an internal pre-offer state; the spec's window (deadlineAt)
 * starts at engagement and covers it.
 */

import { PutCommand, UpdateCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/aws';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { NEGOTIATION_POLICY } from '../config/negotiationPolicy';
import { dollarsToCents, assertIntegerCents } from '../utils/money';
import { LoadService } from './loadService';
import { AppError } from '../middleware/errorHandler';

export type NegotiationStatus = 'ENGAGED' | 'PENDING_SHIPPER' | 'PENDING_HAULER' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
export type NegotiationParty = 'HAULER' | 'SHIPPER';
export type NegotiationAction = 'ACCEPT_LOAD' | 'BID' | 'COUNTER' | 'ACCEPT_BID' | 'ACCEPT_COUNTER' | 'REJECT';

export const ACTIVE_STATUSES: NegotiationStatus[] = ['ENGAGED', 'PENDING_SHIPPER', 'PENDING_HAULER'];

export interface LoadNegotiation {
  negotiationId: string; // 'neg_...'
  loadId: string;
  haulerCarrierId: string; // carrier of record (OO or org), by id
  haulerDriverId: string; // the engaged driver, for assignment
  haulerUserId: string; // for notifications
  shipperId: string;
  /** Snapshot of the posted rate at engagement. Null for FLAT_RATE loads. */
  postedRatePerMileCents: number | null;
  /** Snapshot linehaul at the posted rate (per-mile derived, or the flat amount). */
  postedLinehaulCents: number;
  totalMiles: number | null;
  status: NegotiationStatus;
  /** The rate currently on the table (cents per mile). */
  currentOfferRatePerMileCents: number | null;
  /** Who made the offer currently on the table. */
  currentOfferParty: NegotiationParty | null;
  roundCount: number;
  startedAt: number;
  deadlineAt: number;
  outcome?: NegotiationAction;
  agreedRatePerMileCents?: number | null;
  agreedLinehaulCents?: number;
  createdAt: number;
  updatedAt: number;
}

export interface NegotiationOffer {
  negOfferId: string; // 'negoffer_...'
  negotiationId: string;
  loadId: string;
  party: NegotiationParty;
  action: NegotiationAction;
  ratePerMileCents?: number;
  createdAt: number;
}

const T = () => ({
  neg: config.dynamodb.loadNegotiationsTable,
  offers: config.dynamodb.negotiationOffersTable,
  locks: config.dynamodb.negotiationLocksTable,
});

function isConditionFailure(err: any): boolean {
  return err?.name === 'ConditionalCheckFailedException' || err?.name === 'TransactionCanceledException';
}

/** Whole-cents linehaul for a load at a given per-mile rate. Explicit rounding. */
export function linehaulCentsAt(ratePerMileCents: number, totalMiles: number): number {
  const cents = Math.round(ratePerMileCents * totalMiles);
  assertIntegerCents(cents, 'negotiated linehaul');
  return cents;
}

export class NegotiationService {
  // ── locks: the one-active-negotiation-per-load primitive ─────────────────

  /** Loads currently locked by an active negotiation. Read-time pool exclusion. */
  static async activeLockedLoadIds(): Promise<Map<string, string>> {
    try {
      const rows = await Database.scan<{ loadId: string; haulerDriverId: string }>(T().locks);
      return new Map(rows.map((r) => [r.loadId, r.haulerDriverId]));
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return new Map();
      throw err;
    }
  }

  static async lockFor(loadId: string): Promise<{ loadId: string; negotiationId: string; haulerDriverId: string } | null> {
    try {
      const r = await docClient.send(new GetCommand({ TableName: T().locks, Key: { loadId } }));
      return (r.Item as any) ?? null;
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return null;
      throw err;
    }
  }

  private static async releaseLock(loadId: string, negotiationId: string): Promise<void> {
    // Only release our own lock (a later negotiation may hold a new one).
    try {
      await docClient.send(new DeleteCommand({
        TableName: T().locks,
        Key: { loadId },
        ConditionExpression: 'negotiationId = :n',
        ExpressionAttributeValues: { ':n': negotiationId },
      }));
    } catch (err) {
      if (!isConditionFailure(err)) throw err;
    }
  }

  // ── engagement ────────────────────────────────────────────────────────────

  /**
   * Engage a broadcast load: atomically acquire the exclusive lock and open
   * the negotiation in ENGAGED. The first hauler wins; a concurrent second
   * hauler gets a clear 409 "no longer available".
   */
  static async engage(input: {
    loadId: string;
    haulerCarrierId: string;
    haulerDriverId: string;
    haulerUserId: string;
  }): Promise<LoadNegotiation> {
    const load = await LoadService.getLoadById(input.loadId);
    if (!load) throw new AppError('Load not found', 404);
    if (load.assignedDriverId) throw new AppError('Load is no longer available', 409);

    const now = Helpers.getCurrentTimestamp();
    const negotiationId = Helpers.generateId('neg');

    const perMile = load.rateType === 'PER_MILE' && load.totalMiles
      ? dollarsToCents(load.rateAmount)
      : null;
    const postedLinehaulCents = perMile != null
      ? linehaulCentsAt(perMile, load.totalMiles)
      : dollarsToCents(load.rateAmount ?? 0);

    // Atomic exclusivity: the conditional put IS the unique-active-negotiation
    // constraint. Losing the race throws ConditionalCheckFailedException.
    try {
      await docClient.send(new PutCommand({
        TableName: T().locks,
        Item: { loadId: input.loadId, negotiationId, haulerDriverId: input.haulerDriverId, lockedAt: now },
        ConditionExpression: 'attribute_not_exists(loadId)',
      }));
    } catch (err) {
      if (isConditionFailure(err)) throw new AppError('Load is no longer available', 409);
      throw err;
    }

    const neg: LoadNegotiation = {
      negotiationId,
      loadId: input.loadId,
      haulerCarrierId: input.haulerCarrierId,
      haulerDriverId: input.haulerDriverId,
      haulerUserId: input.haulerUserId,
      shipperId: load.shipperId,
      postedRatePerMileCents: perMile,
      postedLinehaulCents,
      totalMiles: load.totalMiles ?? null,
      status: 'ENGAGED',
      currentOfferRatePerMileCents: null,
      currentOfferParty: null,
      roundCount: 0,
      startedAt: now,
      deadlineAt: now + NEGOTIATION_POLICY.windowMinutes * 60_000,
      createdAt: now,
      updatedAt: now,
    };
    await Database.putItem(T().neg, neg);
    return neg;
  }

  static async getById(negotiationId: string): Promise<LoadNegotiation | null> {
    return Database.getItem<LoadNegotiation>(T().neg, { negotiationId });
  }

  /** Latest negotiation for a load (any status), newest first. */
  static async latestForLoad(loadId: string): Promise<LoadNegotiation | null> {
    const all = await this.scanNegs();
    return all.filter((n) => n.loadId === loadId).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }

  static async offersFor(negotiationId: string): Promise<NegotiationOffer[]> {
    try {
      const rows = await Database.scan<NegotiationOffer>(T().offers);
      return rows.filter((o) => o.negotiationId === negotiationId).sort((a, b) => a.createdAt - b.createdAt);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
  }

  // ── the state machine ─────────────────────────────────────────────────────

  /** Hauler takes the posted rate at engagement. Terminal ACCEPTED + assign. */
  static async acceptLoad(negotiationId: string, actorDriverId: string): Promise<LoadNegotiation> {
    const neg = await this.requireNeg(negotiationId);
    this.requireHauler(neg, actorDriverId);
    // Idempotency: a repeated accept returns the same accepted negotiation.
    if (neg.status === 'ACCEPTED' && neg.outcome === 'ACCEPT_LOAD') return neg;
    if (await this.expireIfOverdue(neg)) throw new AppError('Negotiation window has expired; the load was rebroadcast', 409);
    if (neg.status !== 'ENGAGED') throw new AppError('Accept load is only available at engagement, before any bid', 409);

    const agreedRate = neg.postedRatePerMileCents;
    const agreedLinehaul = neg.postedLinehaulCents;
    return this.finishAccepted(neg, 'ACCEPT_LOAD', 'HAULER', 'ENGAGED', agreedRate, agreedLinehaul);
  }

  /** Hauler's first offer. ENGAGED -> PENDING_SHIPPER, window already running. */
  static async bid(negotiationId: string, actorDriverId: string, ratePerMileCents: number): Promise<LoadNegotiation> {
    const neg = await this.requireNeg(negotiationId);
    this.requireHauler(neg, actorDriverId);
    if (await this.expireIfOverdue(neg)) throw new AppError('Negotiation window has expired; the load was rebroadcast', 409);
    if (neg.status !== 'ENGAGED') throw new AppError('A bid is only the first offer; use counter instead', 409);
    if (neg.postedRatePerMileCents == null) {
      throw new AppError('This load is posted at a flat rate; per-mile bidding is not available. You can accept the load at the posted rate.', 400);
    }
    this.validateRate(ratePerMileCents);

    await this.transition(neg, {
      expectStatus: 'ENGAGED',
      set: {
        status: 'PENDING_SHIPPER',
        currentOfferRatePerMileCents: ratePerMileCents,
        currentOfferParty: 'HAULER',
        roundCount: 1,
      },
    });
    await this.appendOffer(neg, 'HAULER', 'BID', ratePerMileCents);
    return (await this.getById(negotiationId))!;
  }

  /**
   * Counter by the party whose turn it is: shipper counters PENDING_SHIPPER,
   * hauler counters PENDING_HAULER. Flips the turn.
   */
  static async counter(negotiationId: string, actor: { party: NegotiationParty; driverId?: string; shipperId?: string }, ratePerMileCents: number): Promise<LoadNegotiation> {
    const neg = await this.requireNeg(negotiationId);
    this.requireActor(neg, actor);
    if (await this.expireIfOverdue(neg)) throw new AppError('Negotiation window has expired; the load was rebroadcast', 409);
    const expectStatus: NegotiationStatus = actor.party === 'SHIPPER' ? 'PENDING_SHIPPER' : 'PENDING_HAULER';
    if (neg.status !== expectStatus) throw new AppError('It is not your turn to act on this negotiation', 409);
    if (NEGOTIATION_POLICY.maxRounds > 0 && neg.roundCount >= NEGOTIATION_POLICY.maxRounds) {
      throw new AppError('Maximum rounds reached; only accept or reject are available', 409);
    }
    this.validateRate(ratePerMileCents);

    await this.transition(neg, {
      expectStatus,
      expectParty: neg.currentOfferParty,
      set: {
        status: actor.party === 'SHIPPER' ? 'PENDING_HAULER' : 'PENDING_SHIPPER',
        currentOfferRatePerMileCents: ratePerMileCents,
        currentOfferParty: actor.party,
        roundCount: neg.roundCount + 1,
      },
    });
    await this.appendOffer(neg, actor.party, 'COUNTER', ratePerMileCents);
    return (await this.getById(negotiationId))!;
  }

  /**
   * Accept the offer on the table: shipper accepts the hauler's bid/counter
   * (ACCEPT_BID), hauler accepts the shipper's counter (ACCEPT_COUNTER).
   * Terminal ACCEPTED + assignment at the counterparty's last offered rate.
   */
  static async acceptOffer(negotiationId: string, actor: { party: NegotiationParty; driverId?: string; shipperId?: string }): Promise<LoadNegotiation> {
    const neg = await this.requireNeg(negotiationId);
    this.requireActor(neg, actor);
    const action: NegotiationAction = actor.party === 'SHIPPER' ? 'ACCEPT_BID' : 'ACCEPT_COUNTER';
    // Idempotency: repeated accept returns the same accepted negotiation.
    if (neg.status === 'ACCEPTED' && neg.outcome === action) return neg;
    if (await this.expireIfOverdue(neg)) throw new AppError('Negotiation window has expired; the load was rebroadcast', 409);
    const expectStatus: NegotiationStatus = actor.party === 'SHIPPER' ? 'PENDING_SHIPPER' : 'PENDING_HAULER';
    if (neg.status !== expectStatus) throw new AppError('It is not your turn to act on this negotiation', 409);
    if (neg.currentOfferRatePerMileCents == null || neg.totalMiles == null) {
      throw new AppError('No offer is on the table', 409);
    }

    const agreedRate = neg.currentOfferRatePerMileCents;
    const agreedLinehaul = linehaulCentsAt(agreedRate, neg.totalMiles);
    return this.finishAccepted(neg, action, actor.party, expectStatus, agreedRate, agreedLinehaul);
  }

  /** Reject by the party whose turn it is. Terminal REJECTED + rebroadcast. */
  static async reject(negotiationId: string, actor: { party: NegotiationParty; driverId?: string; shipperId?: string }): Promise<LoadNegotiation> {
    const neg = await this.requireNeg(negotiationId);
    this.requireActor(neg, actor);
    if (await this.expireIfOverdue(neg)) return (await this.getById(negotiationId))!; // already rebroadcast
    const expectStatus: NegotiationStatus = actor.party === 'SHIPPER' ? 'PENDING_SHIPPER' : 'PENDING_HAULER';
    // A hauler may also walk away before bidding (ENGAGED).
    const ok = neg.status === expectStatus || (actor.party === 'HAULER' && neg.status === 'ENGAGED');
    if (!ok) throw new AppError('It is not your turn to act on this negotiation', 409);

    await this.transition(neg, {
      expectStatus: neg.status,
      set: { status: 'REJECTED', outcome: 'REJECT' },
    });
    await this.appendOffer(neg, actor.party, 'REJECT');
    await this.releaseLock(neg.loadId, neg.negotiationId);
    return (await this.getById(negotiationId))!;
  }

  // ── window: lazy + swept expiry ───────────────────────────────────────────

  /**
   * Expire a negotiation past its deadline. Returns true when it expired (now
   * or previously). Safe under concurrency: the conditional transition means
   * only one caller performs the terminal write; everyone else no-ops.
   */
  static async expireIfOverdue(neg: LoadNegotiation): Promise<boolean> {
    if (!ACTIVE_STATUSES.includes(neg.status)) return neg.status === 'EXPIRED';
    if (Helpers.getCurrentTimestamp() <= neg.deadlineAt) return false;
    try {
      await this.transition(neg, { expectStatus: neg.status, set: { status: 'EXPIRED' } });
    } catch (err) {
      if (!(err instanceof AppError)) throw err; // someone else transitioned; fall through
    }
    await this.releaseLock(neg.loadId, neg.negotiationId);
    return true;
  }

  /** Sweeper: expire every active negotiation past its deadline. */
  static async expireOverdue(): Promise<number> {
    const now = Helpers.getCurrentTimestamp();
    const all = await this.scanNegs();
    let expired = 0;
    for (const neg of all) {
      if (ACTIVE_STATUSES.includes(neg.status) && now > neg.deadlineAt) {
        if (await this.expireIfOverdue(neg)) expired++;
      }
    }
    if (expired > 0) Logger.info(`[negotiation sweeper] expired ${expired} overdue negotiation(s); loads rebroadcast`);
    return expired;
  }

  // ── settlement seam ───────────────────────────────────────────────────────

  /**
   * The agreed linehaul for an accepted negotiation on this load, or null.
   * Settlement (the linehaul take-rate input) consults this so the carrier
   * payout uses the negotiated rate. The Load row itself is never changed.
   */
  static async agreedLinehaulCentsFor(loadId: string): Promise<number | null> {
    const neg = await this.latestForLoad(loadId);
    return neg && neg.status === 'ACCEPTED' && neg.agreedLinehaulCents != null ? neg.agreedLinehaulCents : null;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private static async finishAccepted(
    neg: LoadNegotiation,
    action: NegotiationAction,
    party: NegotiationParty,
    expectStatus: NegotiationStatus,
    agreedRatePerMileCents: number | null,
    agreedLinehaulCents: number
  ): Promise<LoadNegotiation> {
    assertIntegerCents(agreedLinehaulCents, 'agreed linehaul');

    // 1. Terminal transition first (conditional): the single winner proceeds
    //    to assignment; a concurrent duplicate fails the condition and falls
    //    into the idempotent read below.
    try {
      await this.transition(neg, {
        expectStatus,
        set: {
          status: 'ACCEPTED',
          outcome: action,
          agreedRatePerMileCents,
          agreedLinehaulCents,
        },
      });
    } catch (err) {
      const current = await this.getById(neg.negotiationId);
      if (current?.status === 'ACCEPTED') return current; // idempotent repeat
      throw err;
    }

    await this.appendOffer(neg, party, action, agreedRatePerMileCents ?? undefined);

    // 2. Assignment through the existing path. Idempotent: if the load is
    //    already assigned to this hauler's driver, that IS our assignment.
    const load = await LoadService.getLoadById(neg.loadId);
    if (load?.assignedDriverId && load.assignedDriverId !== neg.haulerDriverId) {
      // Should be impossible while we hold the lock; surface loudly.
      throw new AppError('Load was assigned to another driver during negotiation', 409);
    }
    if (!load?.assignedDriverId) {
      await LoadService.assignDriver(neg.loadId, neg.haulerDriverId);
    }
    await this.releaseLock(neg.loadId, neg.negotiationId);
    return (await this.getById(neg.negotiationId))!;
  }

  private static validateRate(ratePerMileCents: number): void {
    if (!Number.isInteger(ratePerMileCents) || ratePerMileCents < NEGOTIATION_POLICY.minRatePerMileCents) {
      throw new AppError(`Rate per mile must be an integer of at least ${NEGOTIATION_POLICY.minRatePerMileCents} cents`, 400);
    }
  }

  private static async requireNeg(negotiationId: string): Promise<LoadNegotiation> {
    const neg = await this.getById(negotiationId);
    if (!neg) throw new AppError('Negotiation not found', 404);
    return neg;
  }

  private static requireHauler(neg: LoadNegotiation, driverId: string): void {
    if (neg.haulerDriverId !== driverId) throw new AppError('Only the engaged hauler may act on this negotiation', 403);
  }

  private static requireActor(neg: LoadNegotiation, actor: { party: NegotiationParty; driverId?: string; shipperId?: string }): void {
    if (actor.party === 'HAULER') this.requireHauler(neg, actor.driverId ?? '');
    else if (neg.shipperId !== actor.shipperId) throw new AppError('Only the load shipper may act on this negotiation', 403);
  }

  /**
   * Conditional session update: applies `set` only when the row still has the
   * expected status (and, when given, the expected currentOfferParty). A
   * failed condition means a concurrent action won; callers surface a clear
   * turn/state error or fall into their idempotent read.
   */
  private static async transition(
    neg: LoadNegotiation,
    opts: { expectStatus: NegotiationStatus; expectParty?: NegotiationParty | null; set: Partial<LoadNegotiation> }
  ): Promise<void> {
    const set = { ...opts.set, updatedAt: Helpers.getCurrentTimestamp() };
    const names: Record<string, string> = { '#status': 'status' };
    const values: Record<string, any> = { ':expectStatus': opts.expectStatus };
    let condition = '#status = :expectStatus';
    if (opts.expectParty !== undefined) {
      names['#cop'] = 'currentOfferParty';
      values[':expectParty'] = opts.expectParty;
      condition += ' AND #cop = :expectParty';
    }
    const sets: string[] = [];
    Object.entries(set).forEach(([k, v], i) => {
      names[`#s${i}`] = k;
      values[`:v${i}`] = v;
      sets.push(`#s${i} = :v${i}`);
    });
    try {
      await docClient.send(new UpdateCommand({
        TableName: T().neg,
        Key: { negotiationId: neg.negotiationId },
        UpdateExpression: 'SET ' + sets.join(', '),
        ConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
    } catch (err) {
      if (isConditionFailure(err)) {
        throw new AppError('The negotiation changed before your action applied; refresh and try again', 409);
      }
      throw err;
    }
  }

  /** Append-only offer row. Never updated, never deleted. */
  private static async appendOffer(
    neg: LoadNegotiation,
    party: NegotiationParty,
    action: NegotiationAction,
    ratePerMileCents?: number
  ): Promise<NegotiationOffer> {
    const row: NegotiationOffer = {
      negOfferId: Helpers.generateId('negoffer'),
      negotiationId: neg.negotiationId,
      loadId: neg.loadId,
      party,
      action,
      ...(ratePerMileCents != null ? { ratePerMileCents } : {}),
      createdAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(T().offers, row);
    return row;
  }

  private static async scanNegs(): Promise<LoadNegotiation[]> {
    try {
      return await Database.scan<LoadNegotiation>(T().neg);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
  }
}
