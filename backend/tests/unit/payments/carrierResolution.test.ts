/**
 * Fleet-carrier payee extension: resolveCarrierIdForUser (routes/factoring.ts)
 * resolves the carrier the authenticated user acts for, mirroring
 * carrier-of-record precedence: OO profile first, then an ACTIVE management
 * membership in a CARRIER-capability org. Dispatchers and org drivers cannot
 * act for the fleet (factoring binds the organization); suspended memberships
 * and non-carrier orgs never resolve.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getByUserId, getMembershipsForUser, getOrgById } = vi.hoisted(() => ({
  getByUserId: vi.fn(async (): Promise<any> => null),
  getMembershipsForUser: vi.fn(async (): Promise<any[]> => []),
  getOrgById: vi.fn(async (): Promise<any> => null),
}));

vi.mock('../../../src/services/ownerOperatorService', () => ({
  OwnerOperatorService: { getByUserId },
}));
vi.mock('../../../src/services/orgService', () => ({
  OrgService: { getOrgById },
  OrgMembershipService: { getMembershipsForUser },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { resolveCarrierIdForUser } from '../../../src/routes/factoring';
import { OrgRole, OrgCapability } from '../../../src/types';

const membership = (orgRole: OrgRole, status = 'ACTIVE', orgId = 'org-1') => ({
  membershipId: 'm1', orgId, userId: 'u1', orgRole, userRole: 'DRIVER', status, joinedAt: 1,
});
const carrierOrg = { orgId: 'org-1', legalName: 'Fleet LLC', capabilities: [OrgCapability.CARRIER] };

beforeEach(() => {
  getByUserId.mockReset().mockResolvedValue(null);
  getMembershipsForUser.mockReset().mockResolvedValue([]);
  getOrgById.mockReset().mockResolvedValue(null);
});

describe('resolveCarrierIdForUser', () => {
  it('resolves an owner operator to their operatorId', async () => {
    getByUserId.mockResolvedValue({ operatorId: 'oo-9' });
    await expect(resolveCarrierIdForUser('u1')).resolves.toBe('oo-9');
    expect(getMembershipsForUser).not.toHaveBeenCalled(); // OO wins without org lookup
  });

  it('resolves a MANAGER of a CARRIER org to the orgId', async () => {
    getMembershipsForUser.mockResolvedValue([membership(OrgRole.MANAGER)]);
    getOrgById.mockResolvedValue(carrierOrg);
    await expect(resolveCarrierIdForUser('u1')).resolves.toBe('org-1');
  });

  it('resolves an OWNER of a CARRIER org to the orgId', async () => {
    getMembershipsForUser.mockResolvedValue([membership(OrgRole.OWNER)]);
    getOrgById.mockResolvedValue(carrierOrg);
    await expect(resolveCarrierIdForUser('u1')).resolves.toBe('org-1');
  });

  it('OO profile takes precedence over an org membership', async () => {
    getByUserId.mockResolvedValue({ operatorId: 'oo-9' });
    getMembershipsForUser.mockResolvedValue([membership(OrgRole.OWNER)]);
    getOrgById.mockResolvedValue(carrierOrg);
    await expect(resolveCarrierIdForUser('u1')).resolves.toBe('oo-9');
  });

  it('an ORG_DRIVER cannot act for the fleet (404)', async () => {
    getMembershipsForUser.mockResolvedValue([membership(OrgRole.ORG_DRIVER)]);
    getOrgById.mockResolvedValue(carrierOrg);
    await expect(resolveCarrierIdForUser('u1')).rejects.toThrow(/No carrier profile/);
  });

  it('a DISPATCHER cannot act for the fleet (404)', async () => {
    getMembershipsForUser.mockResolvedValue([membership(OrgRole.DISPATCHER)]);
    getOrgById.mockResolvedValue(carrierOrg);
    await expect(resolveCarrierIdForUser('u1')).rejects.toThrow(/No carrier profile/);
  });

  it('a SUSPENDED manager membership never resolves (404)', async () => {
    getMembershipsForUser.mockResolvedValue([membership(OrgRole.MANAGER, 'SUSPENDED')]);
    getOrgById.mockResolvedValue(carrierOrg);
    await expect(resolveCarrierIdForUser('u1')).rejects.toThrow(/No carrier profile/);
  });

  it('a manager of a NON-carrier org never resolves (404)', async () => {
    getMembershipsForUser.mockResolvedValue([membership(OrgRole.MANAGER)]);
    getOrgById.mockResolvedValue({ orgId: 'org-1', capabilities: ['SHIPPER'] });
    await expect(resolveCarrierIdForUser('u1')).rejects.toThrow(/No carrier profile/);
  });

  it('skips non-qualifying memberships and resolves via a later carrier-org management one', async () => {
    getMembershipsForUser.mockResolvedValue([
      membership(OrgRole.ORG_DRIVER, 'ACTIVE', 'org-0'),
      membership(OrgRole.MANAGER, 'ACTIVE', 'org-2'),
    ]);
    getOrgById.mockImplementation(async (orgId: string) =>
      orgId === 'org-2' ? { orgId: 'org-2', capabilities: [OrgCapability.CARRIER] } : null
    );
    await expect(resolveCarrierIdForUser('u1')).resolves.toBe('org-2');
  });

  it('unaffiliated user gets a 404', async () => {
    await expect(resolveCarrierIdForUser('u1')).rejects.toThrow(/No carrier profile/);
  });

  it('deprecated ORG_ADMIN alias still resolves as management', async () => {
    getMembershipsForUser.mockResolvedValue([membership(OrgRole.ORG_ADMIN)]);
    getOrgById.mockResolvedValue(carrierOrg);
    await expect(resolveCarrierIdForUser('u1')).resolves.toBe('org-1');
  });
});
