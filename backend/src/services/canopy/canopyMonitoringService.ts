/**
 * Canopy monitoring and lifecycle (SCRUM-60, Phase 9).
 *
 * Monitoring is enabled on a connected pull so Canopy re-pulls the policy on a
 * cadence and notifies us of changes. On a monitoring re-pull we re-retrieve the
 * pull, create a NEW INSURER_POLICY version from the fresh data, apply a status
 * mapping (EXPIRED for a fatal change, PENDING for a review-worthy one, otherwise
 * re-run the decision), notify the hauler and any shipper with an in-flight load,
 * and re-run the COI cross-reference (a policy change can turn an ALIGNED
 * certificate stale). MONITORING_RECONNECT marks the connection DISCONNECTED and
 * requires reconnection or the fallback before the next renewal. Idempotent:
 * keyed on the monitoring pull id, so a replayed webhook writes nothing twice.
 *
 * The weekly FMCSA sweep continues for all haulers and the COI-expiry job
 * continues for fallback haulers; Canopy monitoring supersedes the COI-expiry
 * reminder for connected haulers, with the sweep as the safety net.
 */

import { Logger } from '../../utils/logger';
import { LoadStatus } from '../../types';
import { ComplianceDocumentService } from '../complianceDocumentService';
import { OwnerOperatorService } from '../ownerOperatorService';
import { DriverService } from '../driverService';
import { ShipperService } from '../shipperService';
import { LoadService } from '../loadService';
import { NotificationService } from '../notificationService';
import { CanopyClient } from './canopyClient';
import { CanopyConnectionStore } from './canopyConnectionStore';
import { CanopyPull } from './canopyTypes';
import { mapPullToInsuranceData } from './canopyMapper';
import { createInsurerPolicyDocument } from './insurerPolicyDocument';
import { decideCanopyInsurerPolicy, reevaluateCarrierInsurerPolicy } from './verificationDecision';
import { runCrossReferenceForCarrier } from './crossReferenceEngine';

/** Load statuses that mean a shipper has a live load with this carrier. */
const IN_FLIGHT_STATUSES: LoadStatus[] = [LoadStatus.BOOKED, LoadStatus.IN_TRANSIT];

export interface MonitoringResult {
  handled: boolean;
  reason?: string;
  carrierId?: string;
  documentId?: string;
  connectionId?: string;
  status?: 'VERIFIED' | 'PENDING' | 'EXPIRED';
  alreadyProcessed?: boolean;
}

/** Enable monitoring on a carrier's current connection. Best-effort, idempotent. */
export async function enableMonitoringForConnection(connectionId: string): Promise<void> {
  const conn = await CanopyConnectionStore.getByConnectionId(connectionId);
  if (!conn || conn.status !== 'CONNECTED') return;
  if (conn.monitoringId) return; // already enabled
  try {
    const { monitoringId } = await CanopyClient.enableMonitoring(conn.pullId);
    await CanopyConnectionStore.updateStatus(connectionId, { monitoringId });
    Logger.info(`[canopy] monitoring enabled on connection ${connectionId} (${monitoringId})`);
  } catch (e: any) {
    Logger.warn(`[canopy] enable monitoring failed for ${connectionId}: ${e?.message ?? e}`);
  }
}

/** Ingest a monitoring re-pull by id. Fetches the pull then delegates. */
export async function ingestMonitoringPull(pullId: string): Promise<MonitoringResult> {
  const pull = await CanopyClient.getPull(pullId);
  return ingestMonitoringPullObject(pull);
}

/**
 * Ingest an already-fetched monitoring re-pull. Resolves the carrier from the
 * parent connection (monitoring re-pulls are Canopy-initiated, so they carry no
 * hauler nonce), creates a new INSURER_POLICY version, and applies the status
 * mapping. Idempotent on the monitoring pull id.
 */
export async function ingestMonitoringPullObject(pull: CanopyPull): Promise<MonitoringResult> {
  const pullId = pull.pull_id;

  // Idempotency: this monitoring pull already processed?
  const existing = await CanopyConnectionStore.findByPullId(pullId);
  if (existing) {
    return { handled: true, alreadyProcessed: true, carrierId: existing.carrierId };
  }

  const parentPullId = pull.parent_pull_id ?? undefined;
  const parentConn = parentPullId ? await CanopyConnectionStore.findByPullId(parentPullId) : null;
  if (!parentConn) {
    Logger.warn(`[canopy] monitoring pull ${pullId} has no resolvable parent connection (parent=${parentPullId ?? 'none'})`);
    return { handled: false, reason: 'no parent connection' };
  }
  const carrierId = parentConn.carrierId;

  // Record the monitoring connection row (idempotency key for replays).
  const data = mapPullToInsuranceData(pull);
  const conn = await CanopyConnectionStore.record({
    carrierId,
    pullId,
    status: 'CONNECTED',
    sourceMode: parentConn.sourceMode,
    insurerName: data.insurerName,
    parentPullId,
    monitoringId: parentConn.monitoringId,
  });

  // New INSURER_POLICY version from the fresh data.
  const doc = await createInsurerPolicyDocument(carrierId, pullId, data);

  // Status mapping table.
  const fatal =
    !data.hasCommercialAuto ||
    data.autoStatus === 'CANCELLED' ||
    data.autoStatus === 'EXPIRED' ||
    data.autoStatus === 'RESCINDED';

  let status: 'VERIFIED' | 'PENDING' | 'EXPIRED';
  if (fatal) {
    await ComplianceDocumentService.setVerificationStatus(
      doc.documentId,
      'EXPIRED',
      'EXPIRED',
      'canopy',
      `monitoring: commercial auto ${data.hasCommercialAuto ? data.autoStatus : 'absent'}`,
    );
    status = 'EXPIRED';
  } else {
    // Review-worthy or clean: let the decision decide (handles below-minimum,
    // FMCSA, unresolved CRITICAL).
    const decision = await decideCanopyInsurerPolicy({ documentId: doc.documentId, carrierId, data, pull });
    status = decision.verified ? 'VERIFIED' : 'PENDING';
  }

  // Notify the hauler and any shipper with an in-flight load.
  await notifyMonitoringChange(carrierId, status).catch(() => undefined);

  // A policy change can turn a previously-aligned certificate stale.
  await runCrossReferenceForCarrier(carrierId).catch((e) =>
    Logger.warn(`[canopy] monitoring cross-reference failed for ${carrierId}: ${e?.message ?? e}`),
  );

  Logger.info(`[canopy] monitoring pull ${pullId} for ${carrierId}: ${status}`);
  return { handled: true, carrierId, documentId: doc.documentId, status, connectionId: conn.connectionId };
}

/**
 * MONITORING_RECONNECT: the connection needs re-authentication. Mark the
 * carrier's current connection DISCONNECTED, notify the hauler, and require
 * reconnection or the fallback before the next renewal. Idempotent.
 */
export async function markDisconnected(referencePullId: string, reason = 'reconnect required'): Promise<MonitoringResult> {
  const conn =
    (await CanopyConnectionStore.findByPullId(referencePullId)) ||
    null;
  if (!conn) {
    Logger.warn(`[canopy] MONITORING_RECONNECT for unknown pull ${referencePullId}`);
    return { handled: false, reason: 'unknown connection' };
  }
  if (conn.status === 'DISCONNECTED') {
    return { handled: true, alreadyProcessed: true, carrierId: conn.carrierId };
  }
  await CanopyConnectionStore.updateStatus(conn.connectionId, { status: 'DISCONNECTED', failureReason: reason });

  const op = await OwnerOperatorService.getById(conn.carrierId);
  if (op?.userId) {
    await NotificationService.record({
      userId: op.userId,
      kind: 'COMPLIANCE',
      title: 'Reconnect your insurance',
      body: 'Your insurance connection needs to be reconnected to keep your coverage monitored. Reconnect, or upload a current certificate, before your next renewal.',
    }).catch(() => undefined);
  }
  Logger.info(`[canopy] connection ${conn.connectionId} marked DISCONNECTED (${reason})`);
  return { handled: true, carrierId: conn.carrierId };
}

/**
 * Notify the hauler and any shipper with an in-flight load that the carrier's
 * insurance changed. Best-effort: never throws into the monitoring path.
 */
async function notifyMonitoringChange(carrierId: string, status: 'VERIFIED' | 'PENDING' | 'EXPIRED'): Promise<void> {
  const op = await OwnerOperatorService.getById(carrierId);
  if (op?.userId) {
    const body =
      status === 'EXPIRED'
        ? 'Your insurer reports your commercial auto policy is no longer active. Reconnect or upload a current certificate to stay eligible.'
        : status === 'PENDING'
          ? 'Your insurer reported a change to your policy that we are reviewing. We will let you know if anything is needed.'
          : 'Your insurance was refreshed from your insurer and remains verified.';
    await NotificationService.record({ userId: op.userId, kind: 'COMPLIANCE', title: 'Insurance updated', body }).catch(() => undefined);
  }

  if (status === 'VERIFIED') return; // shippers only need to know about a problem

  try {
    const shipperUserIds = await inFlightShipperUserIds(carrierId, op?.userId, op?.fleetDriverIds);
    for (const userId of shipperUserIds) {
      await NotificationService.record({
        userId,
        kind: 'COMPLIANCE',
        title: 'Carrier insurance changed',
        body: 'The insurance for a carrier on one of your active loads has changed and is being reviewed.',
      }).catch(() => undefined);
    }
  } catch (e: any) {
    Logger.warn(`[canopy] shipper notify (best-effort) failed for ${carrierId}: ${e?.message ?? e}`);
  }
}

/** Best-effort: resolve shipper user ids for a carrier's in-flight loads. */
async function inFlightShipperUserIds(
  carrierId: string,
  carrierUserId: string | undefined,
  fleetDriverIds: string[] | undefined,
): Promise<string[]> {
  const driverIds = new Set<string>(fleetDriverIds ?? []);
  // Owner-operator self-haul: the self-driver shares the carrier's user id.
  if (carrierUserId) {
    const selfDriver = await DriverService.getProfileByUserId(carrierUserId).catch(() => null);
    if (selfDriver?.driverId) driverIds.add(selfDriver.driverId);
  }

  const shipperIds = new Set<string>();
  for (const driverId of driverIds) {
    const loads = await LoadService.getLoadsByAssignedDriver(driverId).catch(() => []);
    for (const load of loads) {
      if (IN_FLIGHT_STATUSES.includes(load.status as LoadStatus) && load.shipperId) {
        shipperIds.add(load.shipperId);
      }
    }
  }

  const userIds = new Set<string>();
  for (const shipperId of shipperIds) {
    const shipper = await ShipperService.getProfileById(shipperId).catch(() => null);
    if (shipper?.userId) userIds.add(shipper.userId);
  }
  return [...userIds];
}

/** Re-evaluate a carrier's insurer policy (used by admin resolution + tests). */
export async function reevaluate(carrierId: string) {
  return reevaluateCarrierInsurerPolicy(carrierId);
}
