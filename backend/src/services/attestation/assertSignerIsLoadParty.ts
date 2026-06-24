// assertSignerIsLoadParty — resolver-based signer check.
//
// The authenticated user MUST resolve as the right party for THIS load
// AT SIGNING TIME. NO denormalized signer field on Load. The mapping is
// computed live every call so reassignments (driver swap, membership
// change, ownership transfer) are honored immediately.
//
// Org-side parties (shipper org, carrier org): any member with signing
// authority (ADMIN_ORG_ROLES = OWNER | MANAGER) may sign on behalf of
// the org. The exact user who signed is recorded as signerUserId.
//
// Reuses:
//   - resolveCarrierOfRecord(driver) — services/carrierOfRecord.ts
//   - OrgMembership table + ADMIN_ORG_ROLES
//   - DriverService + ShipperService + ReceiverService for entity → userId

import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../config/aws';
import config from '../../config/environment';
import { AppError } from '../../middleware/errorHandler';
import {
  ADMIN_ORG_ROLES,
  Load,
  OrgMembership,
  VerificationEntityType,
} from '../../types';
import type { AttestationAction, SignerRole } from '../../types/signatures';
import { DriverService } from '../driverService';
import { ShipperService } from '../shipperService';
import { ReceiverService } from '../receiverService';
import { OwnerOperatorService } from '../ownerOperatorService';
import { resolveCarrierOfRecord } from '../carrierOfRecord';
import { normalizeOrgRole } from '../../types';

export interface SignerResolution {
  /** All userIds permitted to sign this action for this load. */
  allowedUserIds: Set<string>;
  /** Role to record on the signature when authUserId matches. */
  signerRole:     SignerRole;
  /** For org-side actions: which org the signer represents. */
  signerOrgId?:   string;
  /** For carrier acceptance: the resolved carrier of record. */
  carrierOfRecordEntityType?: string;
  carrierOfRecordEntityId?:   string;
}

/** Org members with signing authority (OWNER + MANAGER). */
async function orgSigningMembers(orgId: string): Promise<string[]> {
  const res = await docClient.send(new QueryCommand({
    TableName: config.dynamodb.membershipsTable,
    IndexName: 'orgId-index',
    KeyConditionExpression: 'orgId = :o',
    ExpressionAttributeValues: { ':o': orgId },
  }));
  const members = (res.Items ?? []) as OrgMembership[];
  return members
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ userId: m.userId, role: normalizeOrgRole(m.orgRole) }))
    .filter((m) => !!m.role && ADMIN_ORG_ROLES.includes(m.role!))
    .map((m) => m.userId);
}

/** Convenience: tries first the user that matches authUserId, then any. */
function pick(set: Set<string>, authUserId: string): boolean {
  return set.has(authUserId);
}

async function resolveBolSubmit(load: Load): Promise<SignerResolution> {
  // The shipper user (single-account case) is always allowed; if their
  // account is also linked to a shipper-side org, any OWNER/MANAGER of
  // that org may sign too.
  const allowed = new Set<string>();
  let signerOrgId: string | undefined;

  if (load.shipperId) {
    const shipper = await ShipperService.getProfileById(load.shipperId);
    if (shipper?.userId) allowed.add(shipper.userId);
    if (shipper?.orgId) {
      signerOrgId = shipper.orgId;
      for (const uid of await orgSigningMembers(shipper.orgId)) allowed.add(uid);
    }
  }

  if (allowed.size === 0) {
    throw new AppError(`No shipper-side signers resolvable for load ${load.loadId}`, 500);
  }
  return { allowedUserIds: allowed, signerRole: 'SHIPPER', signerOrgId };
}

async function resolveCarrierAccept(load: Load, assignedDriverId: string): Promise<SignerResolution> {
  // The accepting driver is the one being assigned. Resolve their carrier
  // of record via the existing service so OO self-haul, OO fleet, and
  // carrier-org acceptance all flow through one resolver.
  const driver = await DriverService.getProfileById(assignedDriverId);
  if (!driver) throw new AppError(`Driver ${assignedDriverId} not found`, 404);

  const cor = await resolveCarrierOfRecord(driver);
  if (!cor) {
    throw new AppError(`Driver ${assignedDriverId} has no carrier of record (unaffiliated)`, 403);
  }

  const allowed = new Set<string>();
  let signerRole: SignerRole = 'CARRIER_ADMIN';
  let signerOrgId: string | undefined;

  if (cor.entityType === VerificationEntityType.OWNER_OPERATOR) {
    // OO: the operator themselves signs (no membership fan-out).
    const oo = await OwnerOperatorService.getById(cor.entityId);
    if (oo?.userId) allowed.add(oo.userId);
    signerRole = 'OWNER_OPERATOR';
  } else if (cor.entityType === VerificationEntityType.CARRIER_ORG) {
    for (const uid of await orgSigningMembers(cor.entityId)) allowed.add(uid);
    signerOrgId = cor.entityId;
    signerRole = 'CARRIER_ADMIN';
  }

  if (allowed.size === 0) {
    throw new AppError(`No carrier-side signers with signing authority on load ${load.loadId}`, 403);
  }
  return {
    allowedUserIds: allowed,
    signerRole,
    signerOrgId,
    carrierOfRecordEntityType: cor.entityType,
    carrierOfRecordEntityId:   cor.entityId,
  };
}

async function resolveDriverAction(load: Load): Promise<SignerResolution> {
  if (!load.assignedDriverId) {
    throw new AppError(`Load ${load.loadId} has no assigned driver`, 409);
  }
  const driver = await DriverService.getProfileById(load.assignedDriverId);
  if (!driver) throw new AppError(`Driver ${load.assignedDriverId} not found`, 404);
  return { allowedUserIds: new Set([driver.userId]), signerRole: 'DRIVER' };
}

async function resolveReceiverConfirm(load: Load): Promise<SignerResolution> {
  if (!load.receiverId) {
    throw new AppError(`Load ${load.loadId} has no receiver assigned`, 409);
  }
  const receiver = await ReceiverService.getProfileById(load.receiverId);
  if (!receiver?.userId) throw new AppError(`Receiver ${load.receiverId} not found`, 404);
  return { allowedUserIds: new Set([receiver.userId]), signerRole: 'RECEIVER' };
}

/** Resolve the signer set for the action+load without authorizing yet. */
export async function resolveSigners(
  load: Load,
  action: AttestationAction,
  ctx?: { assignedDriverId?: string },
): Promise<SignerResolution> {
  switch (action) {
    case 'BOL_SUBMIT':
      return resolveBolSubmit(load);
    case 'CARRIER_ACCEPT': {
      const id = ctx?.assignedDriverId ?? load.assignedDriverId;
      if (!id) throw new AppError(`assignedDriverId required to resolve CARRIER_ACCEPT`, 400);
      return resolveCarrierAccept(load, id);
    }
    case 'DRIVER_PICKUP':
    case 'DRIVER_DELIVER':
      return resolveDriverAction(load);
    case 'RECEIVER_CONFIRM':
      return resolveReceiverConfirm(load);
  }
}

/**
 * Authorize. Throws AppError 403 with a structured code if authUserId
 * is not in the resolved set; otherwise returns the resolution so the
 * caller can record the signerRole on the Signature row.
 */
export async function assertSignerIsLoadParty(
  load: Load,
  action: AttestationAction,
  authUserId: string,
  ctx?: { assignedDriverId?: string },
): Promise<SignerResolution> {
  const resolution = await resolveSigners(load, action, ctx);
  if (!pick(resolution.allowedUserIds, authUserId)) {
    throw new AppError(
      `WRONG_SIGNER: user ${authUserId} is not a permitted signer for action=${action} loadId=${load.loadId}`,
      403,
    );
  }
  return resolution;
}
