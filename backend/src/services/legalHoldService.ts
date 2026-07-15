/**
 * Legal hold registry (append-only place/release events) and the delete guard.
 *
 * A hold is placed on an entity (a load, invoice, carrier, shipper, or a specific
 * record) with a reason and an authority reference. Place and release are
 * append-only events; the current state is the newest event for the entity. Under
 * hold, deletion is blocked at the data layer for EVERYONE, including admins:
 * assertDeletable throws, and any retention/purge job must consult isOnHold and
 * skip held entities.
 *
 * Every place and release is audited first (fail closed).
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AdminAuditService } from './adminAuditService';
import { ComplianceRole } from '../types/complianceRole';
import { queryIndexOrScan } from '../utils/indexQuery';

export type HoldEventType = 'PLACE' | 'RELEASE';

// Process-monotonic sequence. Breaks ties when a place and a release land in the
// same millisecond (same-process only). Across processes `at` dominates, and a
// human place-then-release is always many seconds apart, so this only disambiguates
// the same-instant case deterministically.
let holdSeq = 0;

export interface LegalHoldEvent {
  holdId: string; // 'hold_...'
  entityType: string; // LOAD | INVOICE | CARRIER | SHIPPER | RECORD
  entityId: string;
  eventType: HoldEventType;
  reason: string;
  authorityRef?: string;
  actorId: string;
  at: number;
  seq: number; // monotonic tiebreaker for same-millisecond events
}

export class LegalHoldError extends Error {
  // 423 Locked - a controlled 4xx so the errorHandler returns the informative
  // message (not a masked 500). SEC-5: the guard is now enforced at delete time.
  readonly statusCode = 423;
  constructor(entityType: string, entityId: string) {
    super(`LEGAL_HOLD: ${entityType} ${entityId} is under legal hold and cannot be deleted`);
    this.name = 'LegalHoldError';
  }
}

export interface PlaceHoldInput {
  entityType: string;
  entityId: string;
  reason: string;
  authorityRef?: string;
  actorId: string;
}

export class LegalHoldService {
  static async placeHold(input: PlaceHoldInput): Promise<LegalHoldEvent> {
    return this.recordEvent('PLACE', input);
  }

  static async releaseHold(input: PlaceHoldInput): Promise<LegalHoldEvent> {
    return this.recordEvent('RELEASE', input);
  }

  /** The newest event for an entity decides; a PLACE not followed by a RELEASE = held. */
  static async isOnHold(entityType: string, entityId: string): Promise<boolean> {
    // COA-3 phase 2: isOnHold runs on EVERY delete/purge, so it queries
    // entityId-index instead of scanning the whole hold log. The guarded scan
    // fallback keeps the delete guard correct if the index is ever unavailable
    // (fail-closed remains the caller's job via assertDeletable).
    const events = (await queryIndexOrScan<LegalHoldEvent>(
      config.dynamodb.legalHoldsTable,
      'entityId-index',
      'entityId',
      entityId,
      async () => (await this.scanAll()).filter((e) => e.entityId === entityId),
      'LegalHoldService.isOnHold',
    ))
      .filter((e) => e.entityType === entityType && e.entityId === entityId)
      .sort((a, b) => b.at - a.at || (b.seq ?? 0) - (a.seq ?? 0));
    return events.length > 0 && events[0].eventType === 'PLACE';
  }

  /** Throws if the entity is under hold. Call before ANY delete or purge. */
  static async assertDeletable(entityType: string, entityId: string): Promise<void> {
    if (await this.isOnHold(entityType, entityId)) {
      throw new LegalHoldError(entityType, entityId);
    }
  }

  static async listHolds(filter?: { entityType?: string; entityId?: string }): Promise<LegalHoldEvent[]> {
    let rows = await this.scanAll();
    if (filter?.entityType) rows = rows.filter((e) => e.entityType === filter.entityType);
    if (filter?.entityId) rows = rows.filter((e) => e.entityId === filter.entityId);
    return rows.sort((a, b) => b.at - a.at || (b.seq ?? 0) - (a.seq ?? 0));
  }

  private static async recordEvent(eventType: HoldEventType, input: PlaceHoldInput): Promise<LegalHoldEvent> {
    if (!input.entityType || !input.entityId) throw new Error('legalHold: entityType and entityId are required');
    if (!input.reason) throw new Error('legalHold: reason is required');
    if (!input.actorId) throw new Error('legalHold: actorId is required');

    // Audit first: fail closed.
    await AdminAuditService.record({
      actorId: input.actorId,
      actorRole: ComplianceRole.LEGAL_ADMIN,
      action: eventType === 'PLACE' ? 'PLACE_LEGAL_HOLD' : 'RELEASE_LEGAL_HOLD',
      targetRefs: [`${input.entityType}:${input.entityId}`],
      reason: input.reason,
      authorityRef: input.authorityRef,
    });

    const event: LegalHoldEvent = {
      holdId: Helpers.generateId('hold'),
      entityType: input.entityType,
      entityId: input.entityId,
      eventType,
      reason: input.reason,
      ...(input.authorityRef ? { authorityRef: input.authorityRef } : {}),
      actorId: input.actorId,
      at: Helpers.getCurrentTimestamp(),
      seq: ++holdSeq,
    };
    await Database.putItem(config.dynamodb.legalHoldsTable, event);
    return event;
  }

  private static async scanAll(): Promise<LegalHoldEvent[]> {
    try {
      return await Database.scan<LegalHoldEvent>(config.dynamodb.legalHoldsTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
  }
}

/**
 * Retention/purge that respects legal holds. Any purge candidate under hold is
 * skipped (never deleted). This is the seam a real retention job would call; the
 * actual delete is left to the caller (which must also pass assertDeletable).
 */
export class RetentionService {
  static async purge(
    candidates: { entityType: string; entityId: string }[],
    deleteFn?: (c: { entityType: string; entityId: string }) => Promise<void>
  ): Promise<{ purged: { entityType: string; entityId: string }[]; skipped: { entityType: string; entityId: string }[] }> {
    const purged: { entityType: string; entityId: string }[] = [];
    const skipped: { entityType: string; entityId: string }[] = [];
    for (const c of candidates) {
      if (await LegalHoldService.isOnHold(c.entityType, c.entityId)) {
        skipped.push(c);
        continue;
      }
      if (deleteFn) await deleteFn(c);
      purged.push(c);
    }
    return { purged, skipped };
  }
}
