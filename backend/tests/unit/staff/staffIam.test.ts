/**
 * Platform-staff IAM proofs (the TASK acceptance bullets):
 *   - staff invites REUSE the existing Invitation flow (same table/token/TTL)
 *   - accepting a staff invite creates a role=ADMIN account with that tier
 *   - an ADMIN can change a staff role + deactivate (with last-admin guard)
 *   - non-ADMIN / insufficient-tier → 403 on the staff API (requireStaffTier)
 *   - PlatformRole is a SEPARATE enum from carrier-org OrgRole (exact-match)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory DDB fake keyed by table → Map<pk, item>.
const stores: Record<string, Map<string, any>> = {};
const S = (t: string) => (stores[t] ??= new Map());

vi.mock('../../../src/config/database', () => ({
  Database: {
    putItem: vi.fn(async (table: string, item: any) => {
      const pk = item.userId ?? item.token ?? item.applicationId ?? JSON.stringify(item);
      S(table).set(pk, { ...item }); return item;
    }),
    getItem: vi.fn(async (table: string, key: any) => {
      const pk = key.userId ?? key.token ?? Object.values(key)[0];
      return S(table).get(pk as string) ?? null;
    }),
    updateItem: vi.fn(async (table: string, key: any, updates: any) => {
      const pk = (key.userId ?? key.token ?? Object.values(key)[0]) as string;
      const cur = S(table).get(pk) ?? { ...key };
      const next = { ...cur, ...updates }; S(table).set(pk, next); return next;
    }),
    scan: vi.fn(async (table: string) => [...S(table).values()]),
    query: vi.fn(async () => []),
  },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// EmailService is fire-and-forget in invite(); stub it so no real send.
vi.mock('../../../src/services/emailService', () => ({
  EmailService: { staffInvite: vi.fn(async () => {}) },
}));
// AuthService.getUserByEmail reads the users store directly.
vi.mock('../../../src/services/authService', () => ({
  AuthService: {
    getUserByEmail: vi.fn(async (email: string) =>
      [...S('LoadLead_Users').values()].find((u: any) => u.email === email) ?? null),
  },
}));

import { Database } from '../../../src/config/database';
import { EmailService } from '../../../src/services/emailService';
import { StaffService } from '../../../src/services/staffService';
import { OrgInvitationService } from '../../../src/services/orgService';
import { requireStaffTier } from '../../../src/middleware/auth';
import { PlatformRole, ALL_PLATFORM_ROLES, DESTRUCTIVE_TIER } from '../../../src/types/platformRole';
import { OrgRole, UserRole, UserStatus } from '../../../src/types';
import config from '../../../src/config/environment';

const USERS = config.dynamodb.usersTable;
const INVITES = config.dynamodb.invitationsTable;

function seedAdmin(userId: string, email: string, tier = PlatformRole.STAFF_ADMIN, status = UserStatus.ACTIVE) {
  S(USERS).set(userId, { userId, email, role: UserRole.ADMIN, platformRole: tier, status, createdAt: Date.now() });
}

beforeEach(() => {
  for (const k of Object.keys(stores)) delete stores[k];
  vi.clearAllMocks();
});

describe('staff invites REUSE the existing Invitation flow', () => {
  it('invite writes an OrgInvitation (same table) with platformRole + userRole=ADMIN, no orgId', async () => {
    const inv = await StaffService.invite({ email: 'New@Staff.com', platformRole: PlatformRole.STAFF_MANAGER, invitedBy: 'admin-1' });
    expect(inv.platformRole).toBe(PlatformRole.STAFF_MANAGER);
    expect(inv.userRole).toBe(UserRole.ADMIN);
    expect(inv.orgId).toBeUndefined();           // not a carrier-org invite
    expect(inv.email).toBe('new@staff.com');     // lowercased
    // It lives in the SAME invitations table the carrier-org/beta invites use.
    const stored = await OrgInvitationService.getInvitationByToken(inv.token);
    expect(stored?.token).toBe(inv.token);
    expect(stored?.platformRole).toBe(PlatformRole.STAFF_MANAGER);
    // …and the invite is EMAILED via the existing Resend adapter (with the
    // role label + an accept link carrying the token).
    expect(EmailService.staffInvite).toHaveBeenCalledTimes(1);
    const [toArg, roleArg, urlArg] = (EmailService.staffInvite as any).mock.calls[0];
    expect(toArg).toBe('new@staff.com');
    expect(roleArg).toBe('Manager');
    expect(urlArg).toContain(`token=${inv.token}`);
  });

  it('rejects an invalid platform role (exact-match, no substring)', async () => {
    await expect(StaffService.invite({ email: 'x@y.com', platformRole: 'MANAGER', invitedBy: 'admin-1' }))
      .rejects.toThrow(/Invalid platform-staff role/);   // tenant "MANAGER" is NOT a staff role
  });
});

describe('accepting a staff invite creates a platform-staff account', () => {
  it('creates a NEW role=ADMIN + platformRole account (not public signup)', async () => {
    const inv = await StaffService.invite({ email: 'sup@staff.com', platformRole: PlatformRole.STAFF_SUPERVISOR, invitedBy: 'admin-1' });
    const { userId, platformRole } = await StaffService.acceptInvite({ token: inv.token, password: 'a-very-strong-pass', fullName: 'Sue Sup' });
    expect(platformRole).toBe(PlatformRole.STAFF_SUPERVISOR);
    const user = S(USERS).get(userId);
    expect(user.role).toBe(UserRole.ADMIN);
    expect(user.platformRole).toBe(PlatformRole.STAFF_SUPERVISOR);
    expect(user.status).toBe(UserStatus.ACTIVE);
    // invite consumed (idempotent on re-accept)
    await expect(StaffService.acceptInvite({ token: inv.token, password: 'x' })).rejects.toThrow(/already used/);
  });

  it('ELEVATES an existing user to staff instead of duplicating', async () => {
    S(USERS).set('u-existing', { userId: 'u-existing', email: 'promote@me.com', role: UserRole.SHIPPER, status: UserStatus.ACTIVE, createdAt: 1 });
    const inv = await StaffService.invite({ email: 'promote@me.com', platformRole: PlatformRole.STAFF_TEAM_LEAD, invitedBy: 'admin-1' });
    const { userId } = await StaffService.acceptInvite({ token: inv.token });
    expect(userId).toBe('u-existing');                 // same account, elevated
    expect(S(USERS).get('u-existing').role).toBe(UserRole.ADMIN);
    expect(S(USERS).get('u-existing').platformRole).toBe(PlatformRole.STAFF_TEAM_LEAD);
  });
});

describe('change role + deactivate (with last-admin guard)', () => {
  it('an ADMIN can promote/demote a staffer', async () => {
    seedAdmin('admin-1', 'a1@x.com');                  // keep a second admin so demote is allowed
    seedAdmin('admin-2', 'a2@x.com');
    seedAdmin('staff-1', 's1@x.com', PlatformRole.STAFF_SUPERVISOR);
    const m = await StaffService.changeRole('staff-1', PlatformRole.STAFF_MANAGER, 'admin-1');
    expect(m.platformRole).toBe(PlatformRole.STAFF_MANAGER);
    expect(S(USERS).get('staff-1').platformRole).toBe(PlatformRole.STAFF_MANAGER);
  });

  it('refuses to demote the LAST active STAFF_ADMIN', async () => {
    seedAdmin('only-admin', 'only@x.com');
    await expect(StaffService.changeRole('only-admin', PlatformRole.STAFF_MANAGER, 'only-admin'))
      .rejects.toThrow(/last active STAFF_ADMIN/);
  });

  it('refuses to deactivate the last admin AND refuses self-deactivate', async () => {
    seedAdmin('only-admin', 'only@x.com');
    await expect(StaffService.deactivate('only-admin', 'someone'))
      .rejects.toThrow(/last active STAFF_ADMIN/);
    seedAdmin('admin-2', 'a2@x.com');
    await expect(StaffService.deactivate('admin-2', 'admin-2'))
      .rejects.toThrow(/your own account/);
  });

  it('deactivate suspends a non-last staffer', async () => {
    seedAdmin('admin-1', 'a1@x.com');
    seedAdmin('staff-1', 's1@x.com', PlatformRole.STAFF_MANAGER);
    await StaffService.deactivate('staff-1', 'admin-1');
    expect(S(USERS).get('staff-1').status).toBe(UserStatus.SUSPENDED);
  });
});

describe('requireStaffTier — non-ADMIN / insufficient tier → 403', () => {
  function mockRes() {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return { status, json } as any;
  }

  it('non-ADMIN role → 403', async () => {
    const req: any = { user: { userId: 'u1', role: UserRole.SHIPPER } };
    const res = mockRes(); const next = vi.fn();
    await requireStaffTier(...DESTRUCTIVE_TIER)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('ADMIN role but STAFF_MANAGER tier → 403 (not in DESTRUCTIVE_TIER)', async () => {
    seedAdmin('mgr', 'mgr@x.com', PlatformRole.STAFF_MANAGER);
    const req: any = { user: { userId: 'mgr', role: UserRole.ADMIN } };
    const res = mockRes(); const next = vi.fn();
    await requireStaffTier(...DESTRUCTIVE_TIER)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('STAFF_ADMIN tier → passes (next called)', async () => {
    seedAdmin('boss', 'boss@x.com', PlatformRole.STAFF_ADMIN);
    const req: any = { user: { userId: 'boss', role: UserRole.ADMIN } };
    const res = mockRes(); const next = vi.fn();
    await requireStaffTier(...DESTRUCTIVE_TIER)(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('PlatformRole is a SEPARATE enum from carrier-org OrgRole', () => {
  it('no PlatformRole value collides with any OrgRole value', () => {
    const orgValues = new Set(Object.values(OrgRole) as string[]);
    for (const pr of ALL_PLATFORM_ROLES) {
      expect(orgValues.has(pr)).toBe(false);
    }
    // and the names are tier-prefixed so substring confusion is impossible
    expect(ALL_PLATFORM_ROLES.every(r => r.startsWith('STAFF_'))).toBe(true);
    // the staff MANAGER ("STAFF_MANAGER") is NOT the tenant MANAGER ("MANAGER")
    expect(PlatformRole.STAFF_MANAGER).not.toBe(OrgRole.MANAGER);
  });
});
