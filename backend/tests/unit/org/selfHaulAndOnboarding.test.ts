import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aDriver, anOoSelfDriver, aFleetDriver, anOwnerOperator, aMembership, anOrg } from '../../fixtures/factories';
import { OrgCapability, OrgRole, UserRole } from '../../../src/types';

const dbGetItemMock = vi.hoisted(() => vi.fn());
const dbPutItemMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const dbUpdateItemMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const dbQueryMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const sendMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config/aws', () => ({
  docClient: { send: sendMock },
}));

vi.mock('../../../src/config/database', () => ({
  Database: {
    getItem: dbGetItemMock,
    putItem: dbPutItemMock,
    updateItem: dbUpdateItemMock,
    query: dbQueryMock,
  },
}));

vi.mock('../../../src/config/environment', () => ({
  default: {
    dynamodb: {
      usersTable: 'Users',
      driversTable: 'Drivers',
      orgsTable: 'Organizations',
      membershipsTable: 'Memberships',
      invitationsTable: 'Invitations',
    },
  },
}));

vi.mock('../../../src/services/emailService', () => ({
  EmailService: {
    welcome: vi.fn().mockResolvedValue(undefined),
    sendOrgInvitation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../src/utils/helpers', () => ({
  Helpers: {
    generateId: vi.fn((prefix: string) => `${prefix}_FIXED`),
    getCurrentTimestamp: vi.fn(() => 1000000),
    hashPassword: vi.fn().mockResolvedValue('$2a$10$hash'),
  },
}));

import { OwnerOperatorService } from '../../../src/services/ownerOperatorService';
import { DriverService } from '../../../src/services/driverService';

vi.mock('../../../src/services/driverService', () => ({
  DriverService: {
    getProfileByUserId: vi.fn(),
    getProfileById: vi.fn(),
    createProfile: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockReset();
  dbGetItemMock.mockReset();
  dbQueryMock.mockReset().mockResolvedValue([]);
});

describe('Owner Operator self-driver', () => {
  it('[D1] ensureSelfDriver creates self-driver with isSelf=true', async () => {
    const oo = anOwnerOperator({ operatorId: 'OP1', userId: 'U1' });
    const selfDriver = anOoSelfDriver('OP1', 'U1');

    vi.mocked(DriverService.getProfileByUserId).mockResolvedValueOnce(null);
    vi.mocked(DriverService.createProfile).mockResolvedValueOnce(selfDriver);

    const result = await OwnerOperatorService.ensureSelfDriver(oo);
    expect(result.isSelf).toBe(true);
    expect(result.ownedByOperatorId).toBe('OP1');
    expect(result.userId).toBe('U1');
    expect(DriverService.createProfile).toHaveBeenCalledWith('U1', expect.objectContaining({
      ownedByOperatorId: 'OP1',
      isSelf: true,
    }));
  });

  it('[D2] ensureSelfDriver is idempotent — returns existing on second call', async () => {
    const oo = anOwnerOperator({ operatorId: 'OP2', userId: 'U2' });
    const existing = anOoSelfDriver('OP2', 'U2');

    vi.mocked(DriverService.getProfileByUserId).mockResolvedValueOnce(existing);

    const result = await OwnerOperatorService.ensureSelfDriver(oo);
    expect(result).toBe(existing);
    expect(DriverService.createProfile).not.toHaveBeenCalled();
  });

  it('[D6] self-driver is identifiable by isSelf flag', () => {
    const self = anOoSelfDriver('OP3', 'U3');
    const fleet = aFleetDriver('OP3');
    expect(self.isSelf).toBe(true);
    expect(fleet.isSelf).toBe(false);
  });
});

describe('One-parent invariant', () => {
  it('[E5] clearActiveCarrierMembership removes ACTIVE carrier-org membership', async () => {
    const { OrgMembershipService, OrgService } = await import('../../../src/services/orgService');

    const carrierOrg = anOrg([OrgCapability.CARRIER], { orgId: 'ORG_CAR' });
    const membership = aMembership('ORG_CAR', 'U_DRIVER', { status: 'ACTIVE', membershipId: 'MBR1' });

    dbQueryMock.mockResolvedValueOnce([membership]); // getMembershipsForUser
    dbGetItemMock
      .mockResolvedValueOnce(carrierOrg)  // getOrgById
      .mockResolvedValueOnce(membership); // getMembershipById (in removeMember)

    // removeMember needs getMembersOfOrg for last-owner check
    dbQueryMock.mockResolvedValueOnce([membership, aMembership('ORG_CAR', 'OTHER', { orgRole: OrgRole.OWNER })]); // getMembersOfOrg

    sendMock.mockResolvedValueOnce({}); // DeleteCommand

    await OrgMembershipService.clearActiveCarrierMembership('U_DRIVER');

    expect(sendMock).toHaveBeenCalled();
  });

  it('[E7] fleet driver (ownedByOperatorId set) and active carrier membership cannot coexist — enforced by one-parent logic', async () => {
    const driver = aDriver({ ownedByOperatorId: 'OP5', userId: 'U7' });
    expect(driver.ownedByOperatorId).toBeDefined();

    const { OrgMembershipService } = await import('../../../src/services/orgService');
    const carrierOrg = anOrg([OrgCapability.CARRIER], { orgId: 'ORG5' });
    const membership = aMembership('ORG5', 'U7', { status: 'ACTIVE', membershipId: 'MBR5' });

    dbQueryMock.mockResolvedValueOnce([membership]); // getMembershipsForUser
    dbGetItemMock
      .mockResolvedValueOnce(carrierOrg)
      .mockResolvedValueOnce(membership);
    dbQueryMock.mockResolvedValueOnce([membership, aMembership('ORG5', 'X', { orgRole: OrgRole.OWNER })]);
    sendMock.mockResolvedValueOnce({});

    await OrgMembershipService.clearActiveCarrierMembership('U7');
    expect(sendMock).toHaveBeenCalled();
  });

  it('[E4] ORG_DRIVER invite from non-CARRIER org is caught in acceptInvitation', async () => {
    const { OrgInvitationService } = await import('../../../src/services/orgService');
    const shipperOrg = anOrg([OrgCapability.SHIPPER], { orgId: 'ORG_SHIP' });

    dbGetItemMock.mockResolvedValueOnce({
      token: 'tok1', orgId: 'ORG_SHIP', email: 'test@test.com',
      orgRole: OrgRole.ORG_DRIVER, userRole: UserRole.DRIVER,
      invitedBy: 'admin', expiresAt: Date.now() + 100000, createdAt: Date.now(),
    });
    dbGetItemMock.mockResolvedValueOnce(shipperOrg);

    await expect(OrgInvitationService.acceptInvitation('tok1', 'U_NEW'))
      .rejects.toThrow(/CARRIER capability/i);
  });
});
