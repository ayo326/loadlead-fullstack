// services/carrierOfRecord.ts
//
// Single source of truth for "who is the carrier of record for this driver".
// A driver MUST belong to a carrier parent to HAUL - either an Owner Operator
// fleet or a Carrier-capable organization. A driver with no parent is
// unaffiliated: allowed to exist (self-signup stays open) but blocked at the
// acceptance gate. There is no solo HAULING.
//
// Note on Owner Operators: every OO has a "self" Driver record whose
// ownedByOperatorId points at the OO's own operatorId, so an OO personally
// picking up a load resolves through step 1 like any fleet driver.
//
// Precedence:
//   1. Owner Operator fleet   (driver.ownedByOperatorId set; includes OO self-driver)
//   2. Carrier organization   (active membership in an org whose capabilities include CARRIER)
//   3. Unaffiliated           (neither) -> returns null, acceptance denied

import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/aws';
import config from '../config/environment';
import {
  Driver,
  Organization,
  OrgMembership,
  OrgCapability,
  OwnerOperator,
  VerificationEntityType,
  CarrierOfRecord,
} from '../types';
// Type-only import - erased at compile time, so this does not create a
// runtime circular dependency with verification.ts (which imports from here).
import type { Verification, VerificationStatus } from './verification';

const VERIFICATIONS_TABLE = process.env.DYNAMODB_VERIFICATIONS_TABLE || 'LoadLead_Verifications';
// Read directly (not via OwnerOperatorService) to keep this module free of
// runtime service imports - same reason as the type-only verification import.
const OWNER_OPERATORS_TABLE = process.env.DYNAMODB_OWNER_OPERATORS_TABLE || 'LoadLead_OwnerOperators';

/**
 * Audit v7 N1: is the driver's claimed operator link actually CLAIMED by that
 * operator? `driver.ownedByOperatorId` alone is only the driver row's assertion;
 * trusting it let a driver self-declare into any VERIFIED carrier and inherit its
 * FMCSA authority + insurance. The link counts only when the operator side
 * corroborates it, by one of two server-owned facts:
 *   - the driver is in the operator's `fleetDriverIds` (set by the consented
 *     fleet-invite accept), or
 *   - the driver row belongs to the operator's own user (the OO self-driver,
 *     which is deliberately NOT in fleetDriverIds - see the fleet-remove guard).
 * `driver.isSelf` is deliberately NOT consulted: it lives on the driver row and
 * would be forgeable by the same vector this closes.
 */
async function operatorClaimsDriver(driver: Driver, operatorId: string): Promise<boolean> {
  const res = await docClient.send(new GetCommand({
    TableName: OWNER_OPERATORS_TABLE,
    Key: { operatorId },
  }));
  const operator = res.Item as OwnerOperator | undefined;
  if (!operator) return false;
  if ((operator.fleetDriverIds ?? []).includes(driver.driverId)) return true;
  return operator.userId === driver.userId;
}

/**
 * Resolve the carrier of record for a driver.
 * Returns null when the driver belongs to no carrier parent (unaffiliated).
 */
export async function resolveCarrierOfRecord(driver: Driver): Promise<CarrierOfRecord | null> {
  // 1. Owner Operator fleet - explicit fleet assignment wins. An OO's self-driver
  //    carries ownedByOperatorId === its own operatorId, so OO self-haul lands here.
  //    Audit v7 N1: the operator must corroborate the link (see operatorClaimsDriver).
  //    An unclaimed link is ignored and we fall through, so a legitimate org driver
  //    carrying a stale or forged field still resolves their real carrier below,
  //    while a self-declared link grants nothing.
  if (driver.ownedByOperatorId && (await operatorClaimsDriver(driver, driver.ownedByOperatorId))) {
    return {
      entityType: VerificationEntityType.OWNER_OPERATOR,
      entityId: driver.ownedByOperatorId,
    };
  }

  // 2. Carrier organization - first ACTIVE membership in an org whose
  //    capabilities array includes CARRIER.
  const memberships = await docClient.send(
    new QueryCommand({
      TableName: config.dynamodb.membershipsTable,
      IndexName: 'userId-index',
      KeyConditionExpression: '#u = :u',
      ExpressionAttributeNames: { '#u': 'userId' },
      ExpressionAttributeValues: { ':u': driver.userId },
    })
  );

  for (const m of (memberships.Items ?? []) as OrgMembership[]) {
    if (m.status !== 'ACTIVE') continue;

    const orgRes = await docClient.send(
      new GetCommand({ TableName: config.dynamodb.orgsTable, Key: { orgId: m.orgId } })
    );
    const org = orgRes.Item as Organization | undefined;

    if (org?.capabilities?.includes(OrgCapability.CARRIER)) {
      return {
        entityType: VerificationEntityType.CARRIER_ORG,
        entityId: org.orgId,
        displayName: org.legalName,
      };
    }
  }

  // 3. Unaffiliated - no carrier parent. Not permitted to accept loads.
  return null;
}

/**
 * True when the driver's carrier of record is a fleet-carrier ORGANIZATION
 * (a CARRIER-capability org), i.e. the driver hauls under the fleet-carrier
 * persona. Owner-operator drivers (including an OO's own self-driver and any
 * driver in an OO fleet) resolve to OWNER_OPERATOR and return false here, as
 * do unaffiliated drivers. Pure resolution - the persona flag is applied by
 * the caller so this stays independently testable.
 */
export async function isFleetCarrierDriver(driver: Driver): Promise<boolean> {
  // Audit v7 N1: resolve through the one corroborated path instead of
  // short-circuiting on the raw ownedByOperatorId field. That shortcut saved a
  // read but trusted an assertion the operator may not claim, so a stale or
  // forged link would answer "not a fleet carrier" here while
  // resolveCarrierOfRecord resolved the driver's real CARRIER_ORG - two paths
  // disagreeing about the same driver. One resolver, one answer.
  const carrier = await resolveCarrierOfRecord(driver);
  return carrier?.entityType === VerificationEntityType.CARRIER_ORG;
}

/**
 * Gate 1 - carrier AUTHORITY. True only when the resolved carrier of record
 * (OO or Carrier org) is currently VERIFIED (FMCSA active + KYB + AML).
 * Gate 2 - driver IDENTITY - is checked separately in requireVerifiedCarrier()
 * against the USER record's idvStatus, since identity is per-person.
 */
export async function isCarrierVerified(driver: Driver): Promise<{
  verified: boolean;
  carrier: CarrierOfRecord | null;
  status: VerificationStatus | 'UNAFFILIATED';
}> {
  const carrier = await resolveCarrierOfRecord(driver);
  if (!carrier) return { verified: false, carrier: null, status: 'UNAFFILIATED' };

  const res = await docClient.send(
    new GetCommand({ TableName: VERIFICATIONS_TABLE, Key: { entityId: carrier.entityId } })
  );
  const v = res.Item as Verification | undefined;
  const status = (v?.verificationStatus ?? 'UNVERIFIED') as VerificationStatus;

  return { verified: status === 'VERIFIED', carrier, status };
}
