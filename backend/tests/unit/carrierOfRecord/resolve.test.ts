import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aDriver, anOoSelfDriver, aMembership, anOrg } from '../../fixtures/factories';
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

describe('resolveCarrierOfRecord', () => {
  it('[A1] fleet driver resolves to OWNER_OPERATOR', async () => {
    const driver = aDriver({ ownedByOperatorId: 'OP1' });
    const result = await resolveCarrierOfRecord(driver);
    expect(result).toEqual({
      entityType: VerificationEntityType.OWNER_OPERATOR,
      entityId: 'OP1',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('[A2] OO self-driver resolves to OWNER_OPERATOR', async () => {
    const driver = anOoSelfDriver('OP1', 'U1');
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
    const result = await resolveCarrierOfRecord(driver);
    expect(result!.entityType).toBe(VerificationEntityType.OWNER_OPERATOR);
    expect(result!.entityId).toBe('OP2');
    expect(sendMock).not.toHaveBeenCalled();
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
    const shipperOrg = anOrg([OrgCapability.SHIPPER], { orgId: 'ORG_SHIP' });
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
