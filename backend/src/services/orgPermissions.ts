// Org-scoped RBAC for tenant carrier orgs.
// Per LoadLead_Admin_Carrier_IAM_Spec.md — the spec is the source of truth;
// this file is the executable form.
//
// Two layers in LoadLead:
//   • User role (UserRole)  — platform-level identity: DRIVER, SHIPPER,
//     RECEIVER, OWNER_OPERATOR, CARRIER_ADMIN, ADMIN. ADMIN is the platform
//     superuser and is NEVER conflated with anything here.
//   • Org role (OrgRole)    — tenant-level membership: OWNER, MANAGER,
//     DISPATCHER, ORG_DRIVER, SHIPPER_USER, RECEIVER_USER. This file applies
//     to org-scoped operations only.
//
// The legacy ORG_ADMIN value is normalized to MANAGER on read (see
// types/index.ts#normalizeOrgRole). We never WRITE ORG_ADMIN again.

import { OrgRole, normalizeOrgRole } from '../types';

/** Granular permissions. Names are stable identifiers used by callers. */
export type Permission =
  // Member management
  | 'members:invite'
  | 'members:promote'
  | 'members:remove'
  | 'members:transfer_ownership'
  // Driver operations
  | 'drivers:onboard'         // adding ORG_DRIVER members + their equipment
  | 'drivers:dispatch'        // assigning a driver to a load
  // Load operations
  | 'loads:create'
  | 'loads:accept'
  | 'loads:cancel'
  | 'loads:view'
  // Billing + ownership-only
  | 'billing:view'
  | 'billing:edit'
  | 'org:edit'
  | 'org:delete'
  | 'org:transfer_ownership';

/**
 * Permissions matrix. Each role is allowed the union of permissions in its
 * row. OWNER is a superset of MANAGER, which is a superset of DISPATCHER,
 * which is a superset of ORG_DRIVER. We list the full set explicitly for
 * each row (rather than inheriting) because spec changes should be obvious
 * in the diff.
 */
const MATRIX: Record<OrgRole, Permission[]> = {
  [OrgRole.OWNER]: [
    'members:invite', 'members:promote', 'members:remove', 'members:transfer_ownership',
    'drivers:onboard', 'drivers:dispatch',
    'loads:create', 'loads:accept', 'loads:cancel', 'loads:view',
    'billing:view', 'billing:edit',
    'org:edit', 'org:delete', 'org:transfer_ownership',
  ],
  [OrgRole.MANAGER]: [
    // MANAGER (formerly ORG_ADMIN) — every day-to-day operation, NO billing
    // and NO ownership/destructive org actions.
    'members:invite', 'members:promote', 'members:remove',
    'drivers:onboard', 'drivers:dispatch',
    'loads:create', 'loads:accept', 'loads:cancel', 'loads:view',
    'org:edit',
  ],
  [OrgRole.DISPATCHER]: [
    // Operations only. NO invites, NO members touching, NO billing.
    'drivers:dispatch',
    'loads:create', 'loads:accept', 'loads:cancel', 'loads:view',
  ],
  [OrgRole.ORG_DRIVER]: [
    // Drivers see their own loads; nothing else org-scoped.
    'loads:view',
  ],
  [OrgRole.SHIPPER_USER]: [
    'loads:create', 'loads:view',
  ],
  [OrgRole.RECEIVER_USER]: [
    'loads:view',
  ],

  // Legacy alias rows. Should never be reached because callers normalize first,
  // but defining them keeps the type exhaustive without an `as any`.
  [OrgRole.ORG_ADMIN]: [],
  [OrgRole.ADMIN]:     [],
  [OrgRole.MEMBER]:    [],
  [OrgRole.VIEWER]:    [],
};

/**
 * Single source of truth for "can this membership do X?". Always call
 * `normalizeOrgRole` first so legacy ORG_ADMIN/MEMBER/VIEWER rows map
 * to their canonical equivalents before lookup.
 */
export function hasPermission(role: OrgRole | string | null | undefined, permission: Permission): boolean {
  const norm = normalizeOrgRole(role);
  if (!norm) return false;
  return MATRIX[norm].includes(permission);
}

/** List every permission an org role currently has. Useful for tests + UI gating. */
export function permissionsFor(role: OrgRole | string | null | undefined): Permission[] {
  const norm = normalizeOrgRole(role);
  if (!norm) return [];
  return [...MATRIX[norm]];
}

/** Convenience for the common "is this membership admin-tier?" check. */
export function isOrgAdminTier(role: OrgRole | string | null | undefined): boolean {
  const norm = normalizeOrgRole(role);
  return norm === OrgRole.OWNER || norm === OrgRole.MANAGER;
}
