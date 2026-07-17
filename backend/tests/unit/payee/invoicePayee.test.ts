import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aDriver, anOoSelfDriver, aFleetDriver, anOwnerOperator } from '../../fixtures/factories';
import { VerificationEntityType, OrgCapability } from '../../../src/types';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config/aws', () => ({
  docClient: { send: sendMock },
}));

vi.mock('../../../src/config/environment', () => ({
  default: {
    dynamodb: {
      membershipsTable: 'Memberships',
      orgsTable: 'Organizations',
      loadsTable: 'Loads',
      driversTable: 'Drivers',
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

vi.mock('../../../src/services/driverService', () => ({
  DriverService: {
    getProfileById: vi.fn(),
    getProfileByUserId: vi.fn(),
    createProfile: vi.fn(),
  },
}));

vi.mock('../../../src/services/loadService', () => ({
  LoadService: {
    getLoadById: vi.fn(),
  },
}));

import { resolveInvoicePayee } from '../../../src/services/factoring';
import { LoadService } from '../../../src/services/loadService';
import { DriverService } from '../../../src/services/driverService';

beforeEach(() => {
  sendMock.mockReset();
  vi.mocked(LoadService.getLoadById).mockReset();
  vi.mocked(DriverService.getProfileById).mockReset();
});

describe('resolveInvoicePayee', () => {
  it('[F1] fleet driver, no factoring → CARRIER payee (OWNER_OPERATOR)', async () => {
    const driver = aFleetDriver('OP1');
    // 1st send: getOptInByLoad (QueryCommand) → no factoring
    // 2nd send: audit v7 N1 - resolveCarrierOfRecord makes the operator corroborate
    //           the fleet link before it grants OWNER_OPERATOR
    sendMock
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Item: anOwnerOperator({ operatorId: 'OP1', fleetDriverIds: [driver.driverId] }) });
    vi.mocked(LoadService.getLoadById).mockResolvedValueOnce({ assignedDriverId: driver.driverId } as any);
    vi.mocked(DriverService.getProfileById).mockResolvedValueOnce(driver);

    const result = await resolveInvoicePayee('LOAD1');
    expect(result.payee).toBe('CARRIER');
    expect(result.carrier).toEqual({
      entityType: VerificationEntityType.OWNER_OPERATOR,
      entityId: 'OP1',
    });
  });

  it('[F2] carrier-org driver → CARRIER payee (CARRIER_ORG)', async () => {
    const driver = aDriver({ userId: 'U_ORG', ownedByOperatorId: undefined });
    // 1st send: getOptInByLoad → no factoring
    sendMock.mockResolvedValueOnce({ Items: [] });
    vi.mocked(LoadService.getLoadById).mockResolvedValueOnce({ assignedDriverId: driver.driverId } as any);
    vi.mocked(DriverService.getProfileById).mockResolvedValueOnce(driver);
    // resolveCarrierOfRecord: 2nd send = memberships query, 3rd send = org get
    sendMock
      .mockResolvedValueOnce({ Items: [{ membershipId: 'M1', orgId: 'ORG1', userId: 'U_ORG', status: 'ACTIVE' }] })
      .mockResolvedValueOnce({ Item: { orgId: 'ORG1', capabilities: [OrgCapability.CARRIER], legalName: 'Carrier LLC' } });

    const result = await resolveInvoicePayee('LOAD2');
    expect(result.payee).toBe('CARRIER');
    expect(result.carrier).toEqual({
      entityType: VerificationEntityType.CARRIER_ORG,
      entityId: 'ORG1',
      displayName: 'Carrier LLC',
    });
  });

  it('[F3] OO self-driver → CARRIER payee (OWNER_OPERATOR)', async () => {
    const driver = anOoSelfDriver('OP2', 'U_OO');
    sendMock
      .mockResolvedValueOnce({ Items: [] }) // getOptInByLoad
      // audit v7 N1: the self-driver is proven by the operator owning the same
      // userId, not by fleetDriverIds (which never contains it)
      .mockResolvedValueOnce({ Item: anOwnerOperator({ operatorId: 'OP2', userId: 'U_OO', fleetDriverIds: [] }) });
    vi.mocked(LoadService.getLoadById).mockResolvedValueOnce({ assignedDriverId: driver.driverId } as any);
    vi.mocked(DriverService.getProfileById).mockResolvedValueOnce(driver);

    const result = await resolveInvoicePayee('LOAD3');
    expect(result.payee).toBe('CARRIER');
    expect(result.carrier!.entityType).toBe(VerificationEntityType.OWNER_OPERATOR);
    expect(result.carrier!.entityId).toBe('OP2');
  });

  it('[F4] factoring opt-in SUBMITTED → FACTOR payee', async () => {
    sendMock.mockResolvedValueOnce({ Items: [{ loadId: 'LOAD4', status: 'SUBMITTED' }] });

    const result = await resolveInvoicePayee('LOAD4');
    expect(result.payee).toBe('FACTOR');
    expect(result.optIn).toBeDefined();
  });

  it('[F6] unassigned load → CARRIER payee with no carrier entity', async () => {
    sendMock.mockResolvedValueOnce({ Items: [] }); // getOptInByLoad
    vi.mocked(LoadService.getLoadById).mockResolvedValueOnce({ assignedDriverId: undefined } as any);

    const result = await resolveInvoicePayee('LOAD_UNASSIGNED');
    expect(result.payee).toBe('CARRIER');
    expect(result.carrier).toBeUndefined();
  });

  it('[F5] returns full CarrierOfRecord entity with displayName', async () => {
    const driver = aDriver({ userId: 'U_FULL', ownedByOperatorId: undefined });
    sendMock.mockResolvedValueOnce({ Items: [] }); // getOptInByLoad
    vi.mocked(LoadService.getLoadById).mockResolvedValueOnce({ assignedDriverId: driver.driverId } as any);
    vi.mocked(DriverService.getProfileById).mockResolvedValueOnce(driver);
    sendMock
      .mockResolvedValueOnce({ Items: [{ membershipId: 'M2', orgId: 'ORG2', userId: 'U_FULL', status: 'ACTIVE' }] })
      .mockResolvedValueOnce({ Item: { orgId: 'ORG2', capabilities: [OrgCapability.CARRIER], legalName: 'Full Entity Inc' } });

    const result = await resolveInvoicePayee('LOAD5');
    expect(result.carrier).toMatchObject({
      entityType: VerificationEntityType.CARRIER_ORG,
      entityId: 'ORG2',
      displayName: 'Full Entity Inc',
    });
  });
});
