import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// ── Audit v6 M1: AML_REQUIRED gate ───────────────────────────────────────────
// With the flag OFF the gate is unchanged (undefined amlStatus passes). With it
// ON, a never-screened entity (undefined) no longer counts as AML-clear, for
// BOTH carriers and drivers (the chosen "all carriers + drivers" scope).
describe('deriveStatus AML_REQUIRED gate (audit v6 M1)', () => {
  const carrier = (extra: Record<string, unknown>) => ({
    entityId: 'OP', entityType: EntityType.OWNER_OPERATOR,
    docsSubmittedAt: new Date().toISOString(),
    fmcsaAuthorityActive: true, kybStatus: 'pass',
    updatedAt: new Date().toISOString(), ...extra,
  });
  const driver = (extra: Record<string, unknown>) => ({
    entityId: 'U', entityType: EntityType.DRIVER,
    docsSubmittedAt: new Date().toISOString(),
    idvStatus: 'pass', updatedAt: new Date().toISOString(), ...extra,
  });
  const derive = async (item: Record<string, unknown>) => {
    sendMock.mockResolvedValueOnce({ Item: item }).mockResolvedValueOnce({});
    return (await recomputeAndPersist(String(item.entityId), {})).verificationStatus;
  };

  afterEach(() => { delete process.env.AML_REQUIRED; });

  it('flag OFF: carrier with undefined amlStatus stays VERIFIED (current behavior)', async () => {
    delete process.env.AML_REQUIRED;
    expect(await derive(carrier({}))).toBe(VerificationStatus.VERIFIED);
  });

  it('flag OFF: driver with undefined amlStatus stays VERIFIED (current behavior)', async () => {
    delete process.env.AML_REQUIRED;
    expect(await derive(driver({}))).toBe(VerificationStatus.VERIFIED);
  });

  it('flag ON: carrier with undefined amlStatus → PENDING (no longer auto-passes)', async () => {
    process.env.AML_REQUIRED = 'true';
    expect(await derive(carrier({}))).toBe(VerificationStatus.PENDING);
  });

  it('flag ON: carrier with amlStatus pass → VERIFIED', async () => {
    process.env.AML_REQUIRED = 'true';
    expect(await derive(carrier({ amlStatus: 'pass' }))).toBe(VerificationStatus.VERIFIED);
  });

  it('flag ON: driver with undefined amlStatus → PENDING (AML now required for drivers too)', async () => {
    process.env.AML_REQUIRED = 'true';
    expect(await derive(driver({}))).toBe(VerificationStatus.PENDING);
  });

  it('flag ON: driver with amlStatus pass → VERIFIED', async () => {
    process.env.AML_REQUIRED = 'true';
    expect(await derive(driver({ amlStatus: 'pass' }))).toBe(VerificationStatus.VERIFIED);
  });

  it('flag ON: amlStatus fail → REJECTED regardless (was already true)', async () => {
    process.env.AML_REQUIRED = 'true';
    expect(await derive(carrier({ amlStatus: 'fail' }))).toBe(VerificationStatus.REJECTED);
  });
});
