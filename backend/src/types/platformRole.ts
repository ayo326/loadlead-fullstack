// Platform-staff roles for the internal admin console.
//
// DELIBERATELY separate from UserRole (account type) and OrgRole (tenant
// permissions). The IAM spec calls out three independent enums to make
// substring confusion impossible:
//
//   UserRole.ADMIN        -> account type, gates access to /admin surface
//   OrgRole.MANAGER       -> tenant permission inside one carrier org
//   PlatformRole.STAFF_*  -> what an internal staffer can DO on the platform
//
// A platform staffer is a User with role=ADMIN AND a platformRole tier.
// The role=ADMIN check lets them through the surface gate (requireAdmin);
// the platformRole tier decides whether a given destructive action goes
// through (requireStaffTier).
//
// Multiple staffers at every tier are allowed. STAFF_ADMIN bootstraps
// out-of-band via backend/scripts/bootstrapAdmin.mjs; the others are
// created/elevated by an existing STAFF_ADMIN via the staff-management
// UI (built later) or via backend/scripts/setPlatformRole.mjs.

export enum PlatformRole {
  STAFF_ADMIN      = 'STAFF_ADMIN',
  STAFF_MANAGER    = 'STAFF_MANAGER',
  STAFF_SUPERVISOR = 'STAFF_SUPERVISOR',
  STAFF_TEAM_LEAD  = 'STAFF_TEAM_LEAD',
}

/** Every value here is a platform-staff role; exhaustive list. */
export const ALL_PLATFORM_ROLES: PlatformRole[] = [
  PlatformRole.STAFF_ADMIN,
  PlatformRole.STAFF_MANAGER,
  PlatformRole.STAFF_SUPERVISOR,
  PlatformRole.STAFF_TEAM_LEAD,
];

/** Read-only tier - sees the console, opens tickets, cannot mutate org/user state. */
export const READ_TIER: PlatformRole[] = [
  PlatformRole.STAFF_SUPERVISOR,
  PlatformRole.STAFF_TEAM_LEAD,
];

/** Operations tier - non-destructive ops (verify drivers, set buffers, etc). */
export const OPS_TIER: PlatformRole[] = [
  PlatformRole.STAFF_ADMIN,
  PlatformRole.STAFF_MANAGER,
];

/** Destructive tier - suspend/reinstate org, revoke carrier_admin, manage staff, set SLA policy. */
export const DESTRUCTIVE_TIER: PlatformRole[] = [
  PlatformRole.STAFF_ADMIN,
];

/**
 * Back-compat resolver. Pre-Phase-1 ADMIN users had no platformRole; treat
 * them as STAFF_ADMIN so the existing accounts still work. Anyone with an
 * explicit platformRole uses that value.
 *
 * Exact-match only. If the stored value isn't in the PlatformRole enum
 * (corrupt or tampered), return null so the caller can refuse.
 */
export function resolvePlatformRole(stored: string | null | undefined): PlatformRole | null {
  // SEC-C1 follow-up (audit v6): a missing platformRole now resolves to NULL, not
  // STAFF_ADMIN. Previously any role=ADMIN with no explicit platformRole was silently
  // granted the full DESTRUCTIVE tier - the amplifier behind the self-signup-ADMIN
  // CRITICAL. The auth gate (middleware/auth.requireStaffTier) treats null as no tier
  // and denies, so a null-platformRole admin is now fail-closed. Safe to flip: the
  // bootstrapped admin is stamped STAFF_ADMIN explicitly, and a prod users audit
  // (2026-07-14) confirmed every role=ADMIN row already carries an explicit platformRole.
  if (stored == null) return null;
  return ALL_PLATFORM_ROLES.includes(stored as PlatformRole)
    ? (stored as PlatformRole)
    : null;
}

export function hasTier(role: PlatformRole | null, tier: PlatformRole[]): boolean {
  return role != null && tier.includes(role);
}
