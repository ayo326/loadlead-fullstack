// LoadLead_Admin_Carrier_IAM_Spec.md — permissions matrix enforcement.
//
// Asserts the row-by-row matrix in services/orgPermissions.ts matches the
// spec verbatim. Specifically calls out the three guardrails the spec
// names explicitly:
//   • DISPATCHER cannot invite members
//   • MANAGER cannot touch billing
//   • Only OWNER transfers ownership or deletes the org

import { describe, it, expect } from 'vitest';
import { OrgRole } from '../../../src/types';
import { hasPermission, isOrgAdminTier, permissionsFor } from '../../../src/services/orgPermissions';

describe('org permissions matrix (LoadLead_Admin_Carrier_IAM_Spec.md)', () => {
  describe('OWNER', () => {
    it('has every permission including billing + ownership', () => {
      const owner = OrgRole.OWNER;
      expect(hasPermission(owner, 'members:invite')).toBe(true);
      expect(hasPermission(owner, 'members:promote')).toBe(true);
      expect(hasPermission(owner, 'members:remove')).toBe(true);
      expect(hasPermission(owner, 'members:transfer_ownership')).toBe(true);
      expect(hasPermission(owner, 'billing:view')).toBe(true);
      expect(hasPermission(owner, 'billing:edit')).toBe(true);
      expect(hasPermission(owner, 'org:edit')).toBe(true);
      expect(hasPermission(owner, 'org:delete')).toBe(true);
      expect(hasPermission(owner, 'org:transfer_ownership')).toBe(true);
      expect(hasPermission(owner, 'drivers:onboard')).toBe(true);
      expect(hasPermission(owner, 'drivers:dispatch')).toBe(true);
    });
  });

  describe('MANAGER (formerly ORG_ADMIN)', () => {
    it('can do every day-to-day org operation', () => {
      const m = OrgRole.MANAGER;
      expect(hasPermission(m, 'members:invite')).toBe(true);
      expect(hasPermission(m, 'members:promote')).toBe(true);
      expect(hasPermission(m, 'members:remove')).toBe(true);
      expect(hasPermission(m, 'drivers:onboard')).toBe(true);
      expect(hasPermission(m, 'drivers:dispatch')).toBe(true);
      expect(hasPermission(m, 'loads:create')).toBe(true);
      expect(hasPermission(m, 'loads:accept')).toBe(true);
      expect(hasPermission(m, 'org:edit')).toBe(true);
    });

    it('CANNOT touch billing — the spec guardrail', () => {
      expect(hasPermission(OrgRole.MANAGER, 'billing:view')).toBe(false);
      expect(hasPermission(OrgRole.MANAGER, 'billing:edit')).toBe(false);
    });

    it('CANNOT delete or transfer ownership', () => {
      expect(hasPermission(OrgRole.MANAGER, 'org:delete')).toBe(false);
      expect(hasPermission(OrgRole.MANAGER, 'org:transfer_ownership')).toBe(false);
      expect(hasPermission(OrgRole.MANAGER, 'members:transfer_ownership')).toBe(false);
    });
  });

  describe('DISPATCHER', () => {
    it('CAN do dispatch + load operations', () => {
      const d = OrgRole.DISPATCHER;
      expect(hasPermission(d, 'drivers:dispatch')).toBe(true);
      expect(hasPermission(d, 'loads:accept')).toBe(true);
      expect(hasPermission(d, 'loads:cancel')).toBe(true);
      expect(hasPermission(d, 'loads:view')).toBe(true);
    });

    it('CANNOT invite members — the spec guardrail', () => {
      expect(hasPermission(OrgRole.DISPATCHER, 'members:invite')).toBe(false);
      expect(hasPermission(OrgRole.DISPATCHER, 'members:promote')).toBe(false);
      expect(hasPermission(OrgRole.DISPATCHER, 'members:remove')).toBe(false);
    });

    it('CANNOT onboard drivers (adding members is invite-territory)', () => {
      expect(hasPermission(OrgRole.DISPATCHER, 'drivers:onboard')).toBe(false);
    });
  });

  describe('ORG_DRIVER', () => {
    it('only sees own loads — no other org-scoped powers', () => {
      const d = OrgRole.ORG_DRIVER;
      expect(hasPermission(d, 'loads:view')).toBe(true);
      expect(hasPermission(d, 'loads:create')).toBe(false);
      expect(hasPermission(d, 'loads:cancel')).toBe(false);
      expect(hasPermission(d, 'members:invite')).toBe(false);
      expect(hasPermission(d, 'drivers:dispatch')).toBe(false);
    });
  });

  describe('legacy aliases normalize on the way in', () => {
    it('ORG_ADMIN is treated as MANAGER (same permission set)', () => {
      expect(permissionsFor('ORG_ADMIN').sort()).toEqual(permissionsFor(OrgRole.MANAGER).sort());
    });

    it('legacy ADMIN inside OrgRole is treated as MANAGER (back-compat)', () => {
      expect(permissionsFor('ADMIN').sort()).toEqual(permissionsFor(OrgRole.MANAGER).sort());
    });

    it('MEMBER -> ORG_DRIVER', () => {
      expect(permissionsFor('MEMBER').sort()).toEqual(permissionsFor(OrgRole.ORG_DRIVER).sort());
    });

    it('unknown role returns []', () => {
      expect(permissionsFor('GHOST')).toEqual([]);
      expect(permissionsFor(null)).toEqual([]);
      expect(permissionsFor(undefined)).toEqual([]);
    });
  });

  describe('isOrgAdminTier helper', () => {
    it('only OWNER and MANAGER are admin-tier', () => {
      expect(isOrgAdminTier(OrgRole.OWNER)).toBe(true);
      expect(isOrgAdminTier(OrgRole.MANAGER)).toBe(true);
      expect(isOrgAdminTier(OrgRole.DISPATCHER)).toBe(false);
      expect(isOrgAdminTier(OrgRole.ORG_DRIVER)).toBe(false);
    });
    it('legacy ORG_ADMIN normalizes to admin-tier', () => {
      expect(isOrgAdminTier('ORG_ADMIN')).toBe(true);
    });
  });
});
