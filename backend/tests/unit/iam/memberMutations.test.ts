// IAM-6 server-side guards for member mutations.
// Real-world incident: a MANAGER opened /carrier/members and was able to
// remove themselves (UI hides the Remove button for self, but the API
// did not enforce). They lost their membership and saw 'No organisation
// associated with this account.' This suite locks the gate at the
// service layer where the real enforcement lives.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMock = vi.hoisted(() => ({
  updateItem: vi.fn(async () => undefined),
  getItem: vi.fn(),
}));
const docClientMock = vi.hoisted(() => ({ send: vi.fn(async () => undefined) }));
const auditMock = vi.hoisted(() => ({ log: vi.fn(async () => undefined) }));

vi.mock('../../../src/config/database', () => ({ Database: dbMock }));
vi.mock('../../../src/config/aws', () => ({ docClient: docClientMock }));
vi.mock('../../../src/config/environment', () => ({
  default: { dynamodb: { membershipsTable: 'LoadLead_Memberships' } },
}));

import { OrgMembershipService, OrgAuditService } from '../../../src/services/orgService';
import { OrgRole, UserRole } from '../../../src/types';

(OrgAuditService as any).log = auditMock.log;

const owner   = { membershipId: 'm-owner',   userId: 'u-owner',   orgId: 'org-1', orgRole: OrgRole.OWNER,      status: 'ACTIVE' };
const owner2  = { membershipId: 'm-owner2',  userId: 'u-owner2',  orgId: 'org-1', orgRole: OrgRole.OWNER,      status: 'ACTIVE' };
const manager = { membershipId: 'm-manager', userId: 'u-manager', orgId: 'org-1', orgRole: OrgRole.MANAGER,    status: 'ACTIVE' };
const driver  = { membershipId: 'm-driver',  userId: 'u-driver',  orgId: 'org-1', orgRole: OrgRole.ORG_DRIVER, status: 'ACTIVE' };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: getMembersOfOrg returns [owner, manager, driver]
  vi.spyOn(OrgMembershipService, 'getMembersOfOrg')
    .mockImplementation(async () => [owner, manager, driver] as any);
});

describe('OrgMembershipService.removeMember guards', () => {
  it('refuses self-removal (MANAGER removing themselves)', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(manager as any);
    await expect(
      OrgMembershipService.removeMember(manager.membershipId, manager.userId, OrgRole.MANAGER)
    ).rejects.toMatchObject({ message: expect.stringContaining('cannot remove yourself') });
  });

  it('refuses MANAGER trying to remove an OWNER', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(owner as any);
    await expect(
      OrgMembershipService.removeMember(owner.membershipId, manager.userId, OrgRole.MANAGER)
    ).rejects.toMatchObject({ message: expect.stringContaining('Only an Owner can remove') });
  });

  it('allows OWNER to remove another OWNER (when more than one)', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(owner as any);
    vi.spyOn(OrgMembershipService, 'getMembersOfOrg').mockResolvedValueOnce([owner, owner2] as any);
    await expect(
      OrgMembershipService.removeMember(owner.membershipId, owner2.userId, OrgRole.OWNER)
    ).resolves.toBeUndefined();
  });

  it('refuses removing the last OWNER (platform ADMIN trying it)', async () => {
    // Use platform ADMIN as actor so we skip the self-guard and the
    // owner-protection guard, isolating the last-owner check.
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(owner as any);
    vi.spyOn(OrgMembershipService, 'getMembersOfOrg').mockResolvedValueOnce([owner] as any);
    await expect(
      OrgMembershipService.removeMember(owner.membershipId, 'admin-1', UserRole.ADMIN)
    ).rejects.toMatchObject({ message: expect.stringContaining('last Owner') });
  });

  it('allows MANAGER to remove a DRIVER (normal path)', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(driver as any);
    await expect(
      OrgMembershipService.removeMember(driver.membershipId, manager.userId, OrgRole.MANAGER)
    ).resolves.toBeUndefined();
  });
});

describe('OrgMembershipService.updateMemberRole guards', () => {
  it('refuses self role change (MANAGER changing themselves)', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(manager as any);
    await expect(
      OrgMembershipService.updateMemberRole(
        manager.membershipId, OrgRole.OWNER, manager.userId, OrgRole.MANAGER, OrgRole.MANAGER)
    ).rejects.toMatchObject({ message: expect.stringContaining('cannot change your own role') });
  });

  it('refuses MANAGER promoting someone to OWNER', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(driver as any);
    await expect(
      OrgMembershipService.updateMemberRole(
        driver.membershipId, OrgRole.OWNER, manager.userId, OrgRole.MANAGER, OrgRole.ORG_DRIVER)
    ).rejects.toMatchObject({ message: expect.stringContaining('Only an Owner') });
  });

  it('refuses MANAGER demoting an OWNER', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(owner as any);
    await expect(
      OrgMembershipService.updateMemberRole(
        owner.membershipId, OrgRole.MANAGER, manager.userId, OrgRole.MANAGER, OrgRole.OWNER)
    ).rejects.toMatchObject({ message: expect.stringContaining('Only an Owner') });
  });

  it('allows OWNER to transfer ownership (promote another, sole-owner protected by separate guard)', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(manager as any);
    await expect(
      OrgMembershipService.updateMemberRole(
        manager.membershipId, OrgRole.OWNER, owner.userId, OrgRole.OWNER, OrgRole.MANAGER)
    ).resolves.toBeUndefined();
  });

  it('refuses demoting the last OWNER (platform ADMIN trying it)', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(owner as any);
    vi.spyOn(OrgMembershipService, 'getMembersOfOrg').mockResolvedValueOnce([owner] as any);
    await expect(
      OrgMembershipService.updateMemberRole(
        owner.membershipId, OrgRole.MANAGER, 'admin-1', UserRole.ADMIN, OrgRole.OWNER)
    ).rejects.toMatchObject({ message: expect.stringContaining('last Owner') });
  });
});

// SEC-C2 (audit v6): cross-tenant membership isolation. The routes bind
// :membershipId to the path :orgId and pass it as expectedOrgId; without it a
// caller who is OWNER of their OWN org could mutate another org's membership
// (promote a colluder to OWNER, or remove the victim org's owner). The tenant
// check runs immediately after the fetch, before any role/last-owner guard, so
// it fires regardless of the actor's role.
describe('SEC-C2: expectedOrgId tenant isolation', () => {
  // `driver` lives in org-1; the attacker supplies expectedOrgId 'org-2'.
  it('removeMember 404s when the target belongs to a different org', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(driver as any);
    await expect(
      OrgMembershipService.removeMember(driver.membershipId, 'attacker', OrgRole.OWNER, 'org-2')
    ).rejects.toMatchObject({ message: expect.stringContaining('not found') });
  });

  it('updateMemberRole 404s when the target belongs to a different org', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(driver as any);
    await expect(
      OrgMembershipService.updateMemberRole(
        driver.membershipId, OrgRole.OWNER, 'attacker', OrgRole.OWNER, OrgRole.ORG_DRIVER, 'org-2')
    ).rejects.toMatchObject({ message: expect.stringContaining('not found') });
  });

  it('suspendMember 404s when the target belongs to a different org', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(driver as any);
    await expect(
      OrgMembershipService.suspendMember(driver.membershipId, 'attacker', OrgRole.OWNER, 'org-2')
    ).rejects.toMatchObject({ message: expect.stringContaining('not found') });
  });

  it('reinstateMember 404s when the target belongs to a different org', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(driver as any);
    await expect(
      OrgMembershipService.reinstateMember(driver.membershipId, 'attacker', OrgRole.OWNER, 'org-2')
    ).rejects.toMatchObject({ message: expect.stringContaining('not found') });
  });

  it('still allows the operation when expectedOrgId matches the target org', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(driver as any);
    await expect(
      OrgMembershipService.removeMember(driver.membershipId, manager.userId, OrgRole.MANAGER, 'org-1')
    ).resolves.toBeUndefined();
  });

  it('is backward-compatible: no expectedOrgId skips the tenant check (internal callers)', async () => {
    vi.spyOn(OrgMembershipService, 'getMembershipById').mockResolvedValueOnce(driver as any);
    await expect(
      OrgMembershipService.removeMember(driver.membershipId, manager.userId, OrgRole.MANAGER)
    ).resolves.toBeUndefined();
  });
});
