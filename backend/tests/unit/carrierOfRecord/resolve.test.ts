import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aDriver, anOoSelfDriver, anOwnerOperator, aMembership, anOrg } from '../../fixtures/factories';
import { OrgCapability, VerificationEntityType } from '../../../src/types';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config/aws', () => ({
  docClient: { send: sendMock },
}));

vi.mock('../../../src/config/environment', () => ({
  default: {
    dynamodb: {
      membershipsTable: 'Memberships',
      orgsTable: 'Organizations',
    },
  },
}));

import { resolveCarrierOfRecord } from '../../../src/services/carrierOfRecord';

beforeEach(() => {
  sendMock.mockReset();
});

// Audit v7 N1: an OO link is only real when the OPERATOR corroborates it, so the
// OO path now costs one GetCommand on the operator. These helpers mock that read.
const operatorClaiming = (operatorId: string, driverId: string) =>
  ({ Item: anOwnerOperator({ operatorId, fleetDriverIds: [driverId] }) });
const operatorNotClaiming = (operatorId: string) =>
  ({ Item: anOwnerOperator({ operatorId, fleetDriverIds: [] }) });

describe('resolveCarrierOfRecord', () => {
  it('[A1] fleet driver resolves to OWNER_OPERATOR', async () => {
    const driver = aDriver({ ownedByOperatorId: 'OP1' });
    sendMock.mockResolvedValueOnce(operatorClaiming('OP1', driver.driverId));

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toEqual({
      entityType: VerificationEntityType.OWNER_OPERATOR,
      entityId: 'OP1',
    });
    // exactly one read: the operator corroboration, then short-circuit
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('[A2] OO self-driver resolves to OWNER_OPERATOR (not in fleetDriverIds by design)', async () => {
    const driver = anOoSelfDriver('OP1', 'U1');
    // the self-driver is deliberately absent from fleetDriverIds; the operator
    // owns the same userId, which is what makes the link real
    sendMock.mockResolvedValueOnce({
      Item: anOwnerOperator({ operatorId: 'OP1', userId: 'U1', fleetDriverIds: [] }),
    });

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toEqual({
      entityType: VerificationEntityType.OWNER_OPERATOR,
      entityId: 'OP1',
    });
  });

  it('[A3] carrier-org member resolves to CARRIER_ORG', async () => {
    const org = anOrg([OrgCapability.CARRIER], { orgId: 'ORG1', legalName: 'Acme Freight' });
    const membership = aMembership('ORG1', 'U1', { status: 'ACTIVE' });
    const driver = aDriver({ userId: 'U1', ownedByOperatorId: undefined });

    sendMock
      .mockResolvedValueOnce({ Items: [membership] })
      .mockResolvedValueOnce({ Item: org });

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toEqual({
      entityType: VerificationEntityType.CARRIER_ORG,
      entityId: 'ORG1',
      displayName: 'Acme Freight',
    });
  });

  it('[A4] member of non-carrier org only → null', async () => {
    const org = anOrg([OrgCapability.SHIPPER], { orgId: 'ORG2' });
    const membership = aMembership('ORG2', 'U2', { status: 'ACTIVE' });
    const driver = aDriver({ userId: 'U2', ownedByOperatorId: undefined });

    sendMock
      .mockResolvedValueOnce({ Items: [membership] })
      .mockResolvedValueOnce({ Item: org });

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toBeNull();
  });

  it('[A5] unaffiliated driver → null', async () => {
    const driver = aDriver({ userId: 'U3', ownedByOperatorId: undefined });
    sendMock.mockResolvedValueOnce({ Items: [] });

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toBeNull();
  });

  it('[A6] both parents → OWNER_OPERATOR wins (precedence)', async () => {
    const driver = aDriver({ userId: 'U4', ownedByOperatorId: 'OP2' });
    sendMock.mockResolvedValueOnce(operatorClaiming('OP2', driver.driverId));

    const result = await resolveCarrierOfRecord(driver);
    expect(result!.entityType).toBe(VerificationEntityType.OWNER_OPERATOR);
    expect(result!.entityId).toBe('OP2');
    // the org path is never consulted once the OO link is corroborated
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('[A7] inactive membership ignored → null', async () => {
    const membership = aMembership('ORG3', 'U5', { status: 'SUSPENDED' as any });
    const driver = aDriver({ userId: 'U5', ownedByOperatorId: undefined });

    sendMock.mockResolvedValueOnce({ Items: [membership] });

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toBeNull();
  });

  it('[A8] mixed memberships → the carrier org', async () => {
    const shipperMbr = aMembership('ORG_SHIP', 'U6', { status: 'SUSPENDED' as any });
    const carrierMbr = aMembership('ORG_CAR', 'U6', { status: 'ACTIVE' });
    const carrierOrg = anOrg([OrgCapability.CARRIER], { orgId: 'ORG_CAR', legalName: 'Carrier Co' });
    const driver = aDriver({ userId: 'U6', ownedByOperatorId: undefined });

    sendMock
      .mockResolvedValueOnce({ Items: [shipperMbr, carrierMbr] })
      .mockResolvedValueOnce({ Item: carrierOrg });

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toEqual({
      entityType: VerificationEntityType.CARRIER_ORG,
      entityId: 'ORG_CAR',
      displayName: 'Carrier Co',
    });
  });
});

// Audit v7 N1: a driver row could assert ownedByOperatorId pointing at any
// VERIFIED operator and inherit that carrier's FMCSA authority + insurance. The
// resolver now requires the operator to corroborate the link.
describe('resolveCarrierOfRecord - self-declared affiliation is refused (audit v7 N1)', () => {
  it('[N1-a] a self-declared link the operator does not claim grants no carrier', async () => {
    const driver = aDriver({ userId: 'ATTACKER', ownedByOperatorId: 'OP_VICTIM' });
    sendMock
      .mockResolvedValueOnce(operatorNotClaiming('OP_VICTIM')) // victim's fleet excludes them
      .mockResolvedValueOnce({ Items: [] });                   // and no org membership

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toBeNull();
  });

  it('[N1-b] a forged isSelf does not fake the self-driver path', async () => {
    // isSelf lives on the driver row, so it is forgeable by the same vector;
    // only the operator's own userId proves a self-driver.
    const driver = aDriver({ userId: 'ATTACKER', ownedByOperatorId: 'OP_VICTIM', isSelf: true });
    sendMock
      .mockResolvedValueOnce({
        Item: anOwnerOperator({ operatorId: 'OP_VICTIM', userId: 'VICTIM_USER', fleetDriverIds: [] }),
      })
      .mockResolvedValueOnce({ Items: [] });

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toBeNull();
  });

  it('[N1-c] a nonexistent operator grants no carrier', async () => {
    const driver = aDriver({ userId: 'ATTACKER', ownedByOperatorId: 'OP_DOES_NOT_EXIST' });
    sendMock
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [] });

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toBeNull();
  });

  it('[N1-d] an unclaimed link still falls through to the driver\'s real org', async () => {
    // a legitimate org driver carrying a stale/forged field must not be locked out
    const org = anOrg([OrgCapability.CARRIER], { orgId: 'ORG_REAL', legalName: 'Real Carrier' });
    const membership = aMembership('ORG_REAL', 'U9', { status: 'ACTIVE' });
    const driver = aDriver({ userId: 'U9', ownedByOperatorId: 'OP_STALE' });

    sendMock
      .mockResolvedValueOnce(operatorNotClaiming('OP_STALE'))
      .mockResolvedValueOnce({ Items: [membership] })
      .mockResolvedValueOnce({ Item: org });

    const result = await resolveCarrierOfRecord(driver);
    expect(result).toEqual({
      entityType: VerificationEntityType.CARRIER_ORG,
      entityId: 'ORG_REAL',
      displayName: 'Real Carrier',
    });
  });
});
