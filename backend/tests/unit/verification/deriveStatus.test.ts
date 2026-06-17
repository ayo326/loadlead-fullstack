import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationStatus, EntityType } from '../../../src/services/verification';

const sendMock = vi.hoisted(() => vi.fn());
const dbUpdateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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
    updateItem: dbUpdateMock,
    query: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../src/services/integrations/fmcsa', () => ({
  checkCarrierAuthority: vi.fn(),
}));

vi.mock('../../../src/services/integrations/didit', () => ({
  createDiditSession: vi.fn(),
  checkAml: vi.fn(),
}));

vi.mock('../../../src/services/driverService', () => ({
  DriverService: {
    getProfileById: vi.fn(),
    getProfileByUserId: vi.fn(),
    createProfile: vi.fn(),
  },
}));

vi.mock('../../../src/services/ownerOperatorService', () => ({
  OwnerOperatorService: {
    getByUserId: vi.fn(),
  },
}));

import { recomputeAndPersist } from '../../../src/services/verification';

beforeEach(() => {
  sendMock.mockReset();
  dbUpdateMock.mockReset().mockResolvedValue(undefined);
});

describe('recomputeAndPersist + deriveStatus', () => {
  it('[B9] mirrors driver IDV result onto User.idvStatus', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: {
        entityId: 'U1', entityType: EntityType.DRIVER,
        docsSubmittedAt: new Date().toISOString(),
        idvStatus: 'pending', updatedAt: new Date().toISOString(),
      }})
      .mockResolvedValueOnce({}); // PutCommand

    await recomputeAndPersist('U1', { idvStatus: 'pass' });

    expect(dbUpdateMock).toHaveBeenCalledWith(
      'Users',
      { userId: 'U1' },
      expect.objectContaining({ idvStatus: expect.any(String) }),
    );
  });

  it('[B9b] does NOT mirror onto User for carrier-entity (non-DRIVER) records', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: {
        entityId: 'OP1', entityType: EntityType.OWNER_OPERATOR,
        docsSubmittedAt: new Date().toISOString(),
        fmcsaAuthorityActive: true, kybStatus: 'pass',
        updatedAt: new Date().toISOString(),
      }})
      .mockResolvedValueOnce({});

    await recomputeAndPersist('OP1', { amlStatus: 'pass' });

    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('[B10] deriveStatus: carrier entity ignores idvStatus', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: {
        entityId: 'OP2', entityType: EntityType.OWNER_OPERATOR,
        docsSubmittedAt: new Date().toISOString(),
        fmcsaAuthorityActive: true, kybStatus: 'pass', amlStatus: 'pass',
        updatedAt: new Date().toISOString(),
      }})
      .mockResolvedValueOnce({});

    const result = await recomputeAndPersist('OP2', {});
    expect(result.verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('[B11] deriveStatus: DRIVER entity requires idvStatus pass', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: {
        entityId: 'U2', entityType: EntityType.DRIVER,
        docsSubmittedAt: new Date().toISOString(),
        idvStatus: 'pending',
        updatedAt: new Date().toISOString(),
      }})
      .mockResolvedValueOnce({});

    const result = await recomputeAndPersist('U2', {});
    expect(result.verificationStatus).toBe(VerificationStatus.PENDING);
  });

  it('deriveStatus: FMCSA authority false → REJECTED', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: {
        entityId: 'OP3', entityType: EntityType.OWNER_OPERATOR,
        docsSubmittedAt: new Date().toISOString(),
        fmcsaAuthorityActive: false,
        updatedAt: new Date().toISOString(),
      }})
      .mockResolvedValueOnce({});

    const result = await recomputeAndPersist('OP3', {});
    expect(result.verificationStatus).toBe(VerificationStatus.REJECTED);
  });

  it('deriveStatus: KYB fail → REJECTED', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: {
        entityId: 'OP4', entityType: EntityType.OWNER_OPERATOR,
        docsSubmittedAt: new Date().toISOString(),
        fmcsaAuthorityActive: true, kybStatus: 'fail',
        updatedAt: new Date().toISOString(),
      }})
      .mockResolvedValueOnce({});

    const result = await recomputeAndPersist('OP4', {});
    expect(result.verificationStatus).toBe(VerificationStatus.REJECTED);
  });

  it('deriveStatus: no docsSubmittedAt → UNVERIFIED', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    const result = await recomputeAndPersist('NEW', {
      entityType: EntityType.OWNER_OPERATOR,
    });
    expect(result.verificationStatus).toBe(VerificationStatus.UNVERIFIED);
  });
});
