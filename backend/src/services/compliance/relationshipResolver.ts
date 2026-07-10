/**
 * The single relationship resolver.
 *
 * Any shipper may see a hauler's compliance BADGES (document on file,
 * verification state, expiry). The full documents (the W9 especially) open only
 * for a shipper with an active relationship with that hauler: an active
 * negotiation, an assigned load, or a completed load within the window.
 *
 * This rule lives in exactly one place. Every full-document/packet access path
 * calls resolveShipperHaulerRelationship; nothing re-implements the check.
 *
 * The decision (decideRelationship) is a pure function of a small facts object
 * so it is exhaustively testable; fact-gathering (gatherFacts) is the only part
 * that touches the load store.
 */

import { Database } from '../../config/database';
import config from '../../config/environment';
import { Helpers } from '../../utils/helpers';
import { queryIndexOrScan } from '../../utils/indexQuery';
import { OwnerOperatorService } from '../ownerOperatorService';
import { DriverService } from '../driverService';

/** The look-back window for a completed load to still grant access (days). */
export const COMPLETED_WINDOW_DAYS = 90;

export interface RelationshipFacts {
  hasActiveNegotiation: boolean;
  hasAssignedLoad: boolean;
  /** Epoch ms of the most recent completed load between the parties, or null. */
  mostRecentCompletedAt: number | null;
}

export interface RelationshipDecision {
  allowed: boolean;
  /** Machine-readable basis written to the W9 access log; null when denied. */
  basis: string | null;
}

/** Pure decision: does this facts set grant full-document access, and why. */
export function decideRelationship(
  facts: RelationshipFacts,
  now: number = Helpers.getCurrentTimestamp(),
): RelationshipDecision {
  if (facts.hasActiveNegotiation) return { allowed: true, basis: 'ACTIVE_NEGOTIATION' };
  if (facts.hasAssignedLoad) return { allowed: true, basis: 'ASSIGNED_LOAD' };
  if (facts.mostRecentCompletedAt != null) {
    const windowMs = COMPLETED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (now - facts.mostRecentCompletedAt <= windowMs) {
      return { allowed: true, basis: `COMPLETED_LOAD_WITHIN_${COMPLETED_WINDOW_DAYS}D` };
    }
  }
  return { allowed: false, basis: null };
}

/** The hauler's driver ids (self-driver + fleet), used to link loads to the hauler. */
async function haulerDriverIds(operatorId: string): Promise<string[]> {
  const op = await OwnerOperatorService.getById(operatorId);
  if (!op) return [];
  const self = await DriverService.getProfileByUserId(op.userId).catch(() => null);
  return [...(self ? [self.driverId] : []), ...((op.fleetDriverIds as string[]) ?? [])];
}

/** Gather relationship facts between a shipper and a hauler from the load store. */
export async function gatherFacts(shipperId: string, operatorId: string): Promise<RelationshipFacts> {
  const driverIds = new Set(await haulerDriverIds(operatorId));
  if (driverIds.size === 0) {
    return { hasActiveNegotiation: false, hasAssignedLoad: false, mostRecentCompletedAt: null };
  }

  // Audit v4 H3a: this ran a FULL loads-table scan on every packet/document
  // open. shipperId-index (already live in staging and prod) scopes the read
  // to the one shipper's loads; the filtering below then works on a bounded
  // set. Guarded fallback keeps correctness if the index is ever missing in
  // an environment - loudly (see indexQuery.ts).
  const loads = await queryIndexOrScan<any>(
    config.dynamodb.loadsTable,
    'shipperId-index',
    'shipperId',
    shipperId,
    () => Database.scan<any>(config.dynamodb.loadsTable),
    'relationshipResolver.gatherFacts',
  );
  let hasActiveNegotiation = false;
  let hasAssignedLoad = false;
  let mostRecentCompletedAt: number | null = null;

  for (const load of loads) {
    if (load.shipperId !== shipperId) continue;
    const linked = driverIds.has(load.assignedDriverId);
    const negotiating = load.status === 'OFFERED' || load.status === 'OPEN';

    // An in-flight assignment to one of the hauler's drivers.
    if (linked && (load.status === 'BOOKED' || load.status === 'IN_TRANSIT')) {
      hasAssignedLoad = true;
    }
    // A live negotiation surface with this hauler's drivers.
    if (linked && negotiating) hasActiveNegotiation = true;

    // A completed haul by one of the hauler's drivers.
    if (linked && load.status === 'DELIVERED') {
      const at = load.deliveredAt ?? load.updatedAt ?? load.createdAt ?? null;
      if (at != null && (mostRecentCompletedAt == null || at > mostRecentCompletedAt)) {
        mostRecentCompletedAt = at;
      }
    }
  }

  return { hasActiveNegotiation, hasAssignedLoad, mostRecentCompletedAt };
}

/**
 * Resolve whether a shipper may open a hauler's full compliance documents.
 * The one enforcement point; callers must consult it before any full view.
 */
export async function resolveShipperHaulerRelationship(
  shipperId: string,
  operatorId: string,
): Promise<RelationshipDecision> {
  const facts = await gatherFacts(shipperId, operatorId);
  return decideRelationship(facts);
}
