/**
 * Hauler on-board capacity - append-only event log + the single derived resolver.
 *
 * Rated capacity is a fact on the equipment profile (Driver.maxCapacityLbs).
 * On-board state is NEVER a mutable field: it is folded from the append-only
 * capacity_state_events log. remaining = rated - platform-known active weight -
 * declared external weight, floored at zero. The fold lives in exactly one place
 * (foldSnapshot) so every surface and matching read identical numbers.
 *
 * Append-only: rows are never updated or deleted (mirrors stopEventService and
 * the trust-events store). A correction is a NEW event. The Load model is never
 * touched; load weight is read from where it already lives (Load.totalWeightLbs).
 *
 * Whole pounds only (integers). A declared weight above rated is rejected.
 */

import {
  CapacityStateEvent,
  CapacityEventType,
  CapacityEventSource,
  CapacitySnapshot,
  CapacityDeclState,
} from '../types';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { CAPACITY_POLICY } from '../config/capacityPolicy';

const STALE_MS = CAPACITY_POLICY.staleAfterHours * 60 * 60 * 1000;

function assertWholePounds(weightLbs: number, label: string): void {
  if (!Number.isInteger(weightLbs) || weightLbs < 0) {
    throw new AppError(`${label} must be a whole number of pounds (0 or more).`, 400);
  }
}

/**
 * Pure fold: given the equipment's events and its rated capacity, compute the
 * current snapshot. No I/O, so it is fully unit-testable with synthetic events.
 * `nowMs` is injectable for deterministic staleness tests.
 */
export function foldSnapshot(
  equipmentId: string,
  ratedWeightLbs: number,
  events: CapacityStateEvent[],
  nowMs: number,
  carrierId?: string,
): CapacitySnapshot {
  const ordered = [...events].sort((a, b) => a.createdAt - b.createdAt);

  // Latest declared external state wins (EMPTY zeroes the external component).
  let declaredExternalWeightLbs = 0;
  let declaredAt: number | undefined;
  let declState: CapacityDeclState = 'UNKNOWN';

  // Platform-known loads: net of DEDUCT/RESTORE per loadId, idempotent (set, not add).
  const activeLoadWeights = new Map<string, number>();

  for (const e of ordered) {
    switch (e.eventType) {
      case 'DECLARED_EMPTY':
        declaredExternalWeightLbs = 0;
        declState = 'EMPTY';
        declaredAt = e.createdAt;
        break;
      case 'DECLARED_LOADED':
        declaredExternalWeightLbs = Math.max(0, e.weightLbs ?? 0);
        declState = 'LOADED';
        declaredAt = e.createdAt;
        break;
      case 'PLATFORM_DEDUCT':
        if (e.loadId) activeLoadWeights.set(e.loadId, Math.max(0, e.weightLbs ?? 0));
        break;
      case 'PLATFORM_RESTORE':
        if (e.loadId) activeLoadWeights.delete(e.loadId);
        break;
      case 'RATED_CHANGED':
        // Rated lives on the Driver profile; these rows are the audit trail only.
        break;
    }
  }

  let platformActiveWeightLbs = 0;
  for (const w of activeLoadWeights.values()) platformActiveWeightLbs += w;

  const hasActivePlatformLoad = activeLoadWeights.size > 0;
  const onboardWeightLbs = platformActiveWeightLbs + declaredExternalWeightLbs;
  const remainingWeightLbs = Math.max(0, ratedWeightLbs - onboardWeightLbs);

  // Stale = the hauler-declared state is older than the policy window AND there is
  // no active platform load (an active load makes the state platform-known, so the
  // login prompt does not fire and the chip is authoritative).
  const stale =
    !hasActivePlatformLoad &&
    declaredAt !== undefined &&
    nowMs - declaredAt > STALE_MS;

  return {
    equipmentId,
    carrierId,
    ratedWeightLbs,
    platformActiveWeightLbs,
    declaredExternalWeightLbs,
    onboardWeightLbs,
    remainingWeightLbs,
    declState,
    declaredAt,
    hasActivePlatformLoad,
    stale,
  };
}

/** Does the login flow need to prompt this hauler to confirm capacity? */
export function needsCapacityPrompt(snap: CapacitySnapshot): boolean {
  if (snap.hasActivePlatformLoad) return false; // platform-known, never prompt
  return snap.declState === 'UNKNOWN' || snap.stale;
}

export class HaulerCapacityService {
  private static table(): string {
    return config.dynamodb.capacityStateEventsTable;
  }

  /** All events for one equipment (driver), oldest first. Resilient if the table is absent. */
  static async getEventsForEquipment(equipmentId: string): Promise<CapacityStateEvent[]> {
    try {
      const rows = await Database.query<CapacityStateEvent>(
        this.table(),
        'equipmentId-index',
        '#e = :e',
        { '#e': 'equipmentId' },
        { ':e': equipmentId },
      );
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(`CapacityStateEvents table ${this.table()} not found; treating capacity as unknown.`);
        return [];
      }
      throw err;
    }
  }

  /**
   * The one resolver every surface and matching uses. Rated is passed by the
   * caller (who holds the Driver), so this stays a pure fold over the event log.
   */
  static async getCapacity(
    equipmentId: string,
    ratedWeightLbs: number,
    carrierId?: string,
  ): Promise<CapacitySnapshot> {
    const events = await this.getEventsForEquipment(equipmentId);
    return foldSnapshot(equipmentId, ratedWeightLbs, events, Helpers.getCurrentTimestamp(), carrierId);
  }

  private static async append(
    equipmentId: string,
    carrierId: string,
    eventType: CapacityEventType,
    source: CapacityEventSource,
    extra: { weightLbs?: number; loadId?: string; note?: string } = {},
  ): Promise<CapacityStateEvent> {
    const event: CapacityStateEvent = {
      eventId: Helpers.generateId('capevt'),
      carrierId,
      equipmentId,
      eventType,
      source,
      createdAt: Helpers.getCurrentTimestamp(),
      ...(extra.weightLbs !== undefined ? { weightLbs: extra.weightLbs } : {}),
      ...(extra.loadId ? { loadId: extra.loadId } : {}),
      ...(extra.note ? { note: extra.note } : {}),
    };
    await Database.putItem(this.table(), event);
    return event;
  }

  // ── Hauler declarations ─────────────────────────────────────────────────────

  static declareEmpty(
    equipmentId: string,
    carrierId: string,
    source: CapacityEventSource,
  ): Promise<CapacityStateEvent> {
    // Declaring empty clears only the external component; any active LoadLead load
    // stands (a hauler cannot declare away a platform-known load) - the fold keeps
    // the platform component, which comes from PLATFORM_DEDUCT rows.
    return this.append(equipmentId, carrierId, 'DECLARED_EMPTY', source);
  }

  static declareLoaded(
    equipmentId: string,
    carrierId: string,
    weightLbs: number,
    ratedWeightLbs: number,
    source: CapacityEventSource,
  ): Promise<CapacityStateEvent> {
    assertWholePounds(weightLbs, 'On-board weight');
    if (weightLbs > ratedWeightLbs) {
      throw new AppError(
        `On-board weight (${weightLbs.toLocaleString()} lbs) cannot exceed your rated capacity ` +
          `(${ratedWeightLbs.toLocaleString()} lbs).`,
        400,
      );
    }
    return this.append(equipmentId, carrierId, 'DECLARED_LOADED', source, { weightLbs });
  }

  /** Record a rated-capacity change for the audit trail (rated itself lives on the Driver). */
  static recordRatedChange(
    equipmentId: string,
    carrierId: string,
    newRatedLbs: number,
    source: CapacityEventSource,
  ): Promise<CapacityStateEvent> {
    assertWholePounds(newRatedLbs, 'Rated capacity');
    return this.append(equipmentId, carrierId, 'RATED_CHANGED', source, { weightLbs: newRatedLbs });
  }

  // ── Platform-known adjustments (idempotent per loadId) ───────────────────────

  /** A LoadLead load was assigned: put its weight on board. No-op if already deducted. */
  static async platformDeduct(
    equipmentId: string,
    carrierId: string,
    loadId: string,
    weightLbs: number,
  ): Promise<CapacityStateEvent | null> {
    assertWholePounds(weightLbs, 'Load weight');
    const events = await this.getEventsForEquipment(equipmentId);
    if (this.activeLoadIds(events).has(loadId)) {
      return null; // already on board - idempotent, never deduct twice
    }
    return this.append(equipmentId, carrierId, 'PLATFORM_DEDUCT', 'SYSTEM', { weightLbs, loadId });
  }

  /** A LoadLead load was delivered (POD): take its weight off. No-op+warn if not on board. */
  static async platformRestore(
    equipmentId: string,
    carrierId: string,
    loadId: string,
  ): Promise<CapacityStateEvent | null> {
    const events = await this.getEventsForEquipment(equipmentId);
    if (!this.activeLoadIds(events).has(loadId)) {
      Logger.warn(`Capacity restore for load ${loadId} on equipment ${equipmentId} has no matching deduct; no-op.`);
      return null;
    }
    return this.append(equipmentId, carrierId, 'PLATFORM_RESTORE', 'SYSTEM', { loadId });
  }

  /** loadIds currently deducted and not yet restored. */
  private static activeLoadIds(events: CapacityStateEvent[]): Set<string> {
    const active = new Set<string>();
    for (const e of [...events].sort((a, b) => a.createdAt - b.createdAt)) {
      if (e.eventType === 'PLATFORM_DEDUCT' && e.loadId) active.add(e.loadId);
      if (e.eventType === 'PLATFORM_RESTORE' && e.loadId) active.delete(e.loadId);
    }
    return active;
  }
}
