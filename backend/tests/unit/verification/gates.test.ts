import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aDriver, anOoSelfDriver, aVerification, anIdvVerification } from '../../fixtures/factories';
import { VerificationEntityType } from '../../../src/types';
import { VerificationStatus, EntityType } from '../../../src/services/verification';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config/aws', () => ({
  docClient: { send: sendMock },
}));

vi.mock('../../../src/config/environment', () => ({
  default: {
    dynamodb: {
      membershipsTable: 'Memberships',
      orgsTable: 'Organizations',
      usersTable: 'Users',
    },
  },
}));

vi.mock('../../../src/config/database', () => ({
  Database: {
    getItem: vi.fn(),
    putItem: vi.fn(),
    updateItem: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
  },
}));

import { isCarrierVerified } from '../../../src/services/carrierOfRecord';

beforeEach(() => {
  sendMock.mockReset();
});

describe('isCarrierVerified', () => {
  it('[B1] both gates pass → verified true', async () => {
    const driver = aDriver({ ownedByOperatorId: 'OP1' });
    const v = aVerification('OP1', VerificationStatus.VERIFIED);

    sendMock.mockResolvedValueOnce({ Item: v });

    const result = await isCarrierVerified(driver);
    expect(result.verified).toBe(true);
    expect(result.status).toBe('VERIFIED');
    expect(result.carrier).toEqual({
      entityType: VerificationEntityType.OWNER_OPERATOR,
      entityId: 'OP1',
    });
  });

  it('[B2] identity PENDING → carrier still resolves but verified still requires gate 2', async () => {
    const driver = aDriver({ ownedByOperatorId: 'OP_IDV' });
    const v = aVerification('OP_IDV', VerificationStatus.VERIFIED);
    sendMock.mockResolvedValueOnce({ Item: v });

    const result = await isCarrierVerified(driver);
    expect(result.verified).toBe(true);
    expect(result.carrier).not.toBeNull();
  });

  it('[B3] authority PENDING → verified false', async () => {
    const driver = aDriver({ ownedByOperatorId: 'OP2' });
    const v = aVerification('OP2', VerificationStatus.PENDING);

    sendMock.mockResolvedValueOnce({ Item: v });

    const result = await isCarrierVerified(driver);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('PENDING');
  });

  it('[B4] unaffiliated → status UNAFFILIATED', async () => {
    const driver = aDriver({ userId: 'U_NONE', ownedByOperatorId: undefined });
    sendMock.mockResolvedValueOnce({ Items: [] });

    const result = await isCarrierVerified(driver);
    expect(result.verified).toBe(false);
    expect(result.carrier).toBeNull();
    expect(result.status).toBe('UNAFFILIATED');
  });

  it('[B5] expired authority → verified false', async () => {
    const driver = aDriver({ ownedByOperatorId: 'OP3' });
    const v = aVerification('OP3', VerificationStatus.EXPIRED);

    sendMock.mockResolvedValueOnce({ Item: v });

    const result = await isCarrierVerified(driver);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('EXPIRED');
  });

  it('[B6] OO self-haul passes when authority VERIFIED', async () => {
    const driver = anOoSelfDriver('OP4', 'U_OO');
    const v = aVerification('OP4', VerificationStatus.VERIFIED);

    sendMock.mockResolvedValueOnce({ Item: v });

    const result = await isCarrierVerified(driver);
    expect(result.verified).toBe(true);
    expect(result.carrier!.entityType).toBe(VerificationEntityType.OWNER_OPERATOR);
  });

  it('[B7] isCarrierVerified status passthrough for each state', async () => {
    for (const status of [VerificationStatus.UNVERIFIED, VerificationStatus.PENDING, VerificationStatus.REJECTED]) {
      sendMock.mockReset();
      const driver = aDriver({ ownedByOperatorId: 'OP_X' });
      const v = aVerification('OP_X', status);
      sendMock.mockResolvedValueOnce({ Item: v });

      const result = await isCarrierVerified(driver);
      expect(result.status).toBe(status);
      expect(result.verified).toBe(false);
    }
  });

  it('[B8] regression: admin-reject fails carrier', async () => {
    const driver = aDriver({ ownedByOperatorId: 'OP_REJ' });
    const v = aVerification('OP_REJ', VerificationStatus.REJECTED);

    sendMock.mockResolvedValueOnce({ Item: v });

    const result = await isCarrierVerified(driver);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('REJECTED');
  });

  it('[B8b] no verification record → defaults to UNVERIFIED → not verified', async () => {
    const driver = aDriver({ ownedByOperatorId: 'OP_NORECORD' });
    sendMock.mockResolvedValueOnce({ Item: undefined });

    const result = await isCarrierVerified(driver);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('UNVERIFIED');
  });
});
