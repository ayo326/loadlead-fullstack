/**
 * StaffService - platform-staff IAM (the internal-team management layer).
 *
 * Platform staff are Users with role=ADMIN AND a PlatformRole tier
 * (STAFF_ADMIN / STAFF_MANAGER / STAFF_SUPERVISOR / STAFF_TEAM_LEAD). This
 * enum is DELIBERATELY separate from carrier-org OrgRole - exact-match, no
 * substring; the staff MANAGER is not the tenant MANAGER.
 *
 * Invites REUSE the existing OrgInvitation flow (same table/token/TTL/revoke)
 * via OrgInvitationService.createStaffInvitation - the `platformRole` field
 * is the only difference. Accepting a staff invite creates/elevates a
 * role=ADMIN account with that tier; it is NOT public signup and NOT a
 * customer/cohort account.
 *
 * Only STAFF_ADMIN may manage staff (enforced at the route via
 * requireStaffTier(DESTRUCTIVE_TIER)); this service additionally protects
 * against locking out the last active admin. Every mutating action is
 * audit-logged ([staff-audit]); no secrets/PII (passwords) ever logged.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { User, UserRole, UserStatus, OrgInvitation } from '../types';
import {
  PlatformRole, ALL_PLATFORM_ROLES, resolvePlatformRole,
} from '../types/platformRole';
import { AuthService } from './authService';
import { OrgInvitationService } from './orgService';
import { EmailService } from './emailService';

export interface StaffMember {
  userId: string;
  email: string;
  fullName?: string;
  platformRole: PlatformRole;
  status: UserStatus;
  createdAt: number;
}

export interface PendingStaffInvite {
  token: string;
  email: string;
  platformRole: string;
  invitedBy: string;
  expiresAt: number;
  createdAt: number;
}

/** A value is a valid platform-staff role only by EXACT enum membership. */
function assertValidPlatformRole(value: string): PlatformRole {
  if (!(ALL_PLATFORM_ROLES as string[]).includes(value)) {
    throw new AppError(`Invalid platform-staff role: ${value}`, 400);
  }
  return value as PlatformRole;
}

export class StaffService {

  /** All platform-staff accounts (role=ADMIN), with their resolved tier. */
  static async listStaff(): Promise<StaffMember[]> {
    const all = await Database.scan<User>(config.dynamodb.usersTable);
    return all
      .filter(u => u.role === UserRole.ADMIN)
      .map(u => {
        const tier = resolvePlatformRole(u.platformRole) ?? PlatformRole.STAFF_ADMIN;
        return {
          userId: u.userId,
          email: u.email,
          fullName: u.fullName,
          platformRole: tier,
          status: u.status,
          createdAt: u.createdAt,
        };
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Count active STAFF_ADMINs - used to prevent last-admin lockout. */
  private static async activeAdminCount(): Promise<number> {
    const staff = await this.listStaff();
    return staff.filter(s => s.platformRole === PlatformRole.STAFF_ADMIN && s.status === UserStatus.ACTIVE).length;
  }

  /**
   * Invite a platform staffer by email + role. Reuses the existing
   * Invitation flow (createStaffInvitation). Returns the invite token.
   */
  static async invite(params: { email: string; platformRole: string; invitedBy: string }): Promise<OrgInvitation> {
    const role = assertValidPlatformRole(params.platformRole);
    const email = params.email.toLowerCase().trim();
    if (!email.includes('@')) throw new AppError('Valid email required', 400);

    const invitation = await OrgInvitationService.createStaffInvitation({
      email, platformRole: role, invitedBy: params.invitedBy,
    });

    // Email the invite via the existing Resend adapter (fire-and-forget so a
    // mail failure never blocks the invite; the accept link is still returned
    // in the API response as a fallback). The accept page lives on the admin
    // subdomain. STAFF_xxx → "Admin"/"Manager"/… for the email copy.
    const adminBase = process.env.ADMIN_FRONTEND_URL || 'https://admin.loadleadapp.com';
    const acceptUrl = `${adminBase}/accept-staff-invite?token=${invitation.token}`;
    const roleLabel = role.replace('STAFF_', '').split('_').map(w => w[0] + w.slice(1).toLowerCase()).join(' ');
    EmailService.staffInvite(email, roleLabel, acceptUrl).catch((e) =>
      Logger.warn(`[staff-audit] staff invite email failed for ${email}: ${e?.message}`));

    Logger.info(`[staff-audit] ${params.invitedBy} invited ${email} as ${role} (token ${invitation.token.slice(0, 8)}…)`);
    return invitation;
  }

  /**
   * Accept a staff invite → create or elevate a role=ADMIN account with the
   * invited tier. NOT public signup. Idempotent on the invite token (reuses
   * the same used/revoked/expired checks as every other invite).
   */
  static async acceptInvite(params: { token: string; password: string; fullName?: string }): Promise<{ userId: string; platformRole: PlatformRole }> {
    const invite = await OrgInvitationService.getInvitationByToken(params.token);
    if (!invite) throw new AppError('Invitation not found', 404);
    if (!invite.platformRole) throw new AppError('Not a staff invitation', 400);
    if (invite.acceptedAt) throw new AppError('Invitation already used', 409);
    if (invite.revokedAt) throw new AppError('Invitation has been revoked', 410);
    if (invite.expiresAt < Helpers.getCurrentTimestamp()) throw new AppError('Invitation has expired', 410);

    const role = assertValidPlatformRole(invite.platformRole);
    const now = Helpers.getCurrentTimestamp();

    let userId: string;
    const existing = await AuthService.getUserByEmail(invite.email);
    if (existing) {
      // Elevate an existing account to platform staff.
      userId = existing.userId;
      await Database.updateItem(config.dynamodb.usersTable, { userId }, {
        role: UserRole.ADMIN,
        platformRole: role,
        status: UserStatus.ACTIVE,
        fullName: params.fullName?.trim() || existing.fullName,
        updatedAt: now,
      });
    } else {
      // Create a new platform-staff account. role=ADMIN + platformRole.
      if (!params.password || params.password.length < 12) {
        throw new AppError('Password must be at least 12 characters', 400);
      }
      userId = Helpers.generateId('user');
      const hashed = await Helpers.hashPassword(params.password);
      const user: User = {
        userId,
        email: invite.email,
        password: hashed,
        passwordHash: hashed,
        role: UserRole.ADMIN,
        platformRole: role,
        status: UserStatus.ACTIVE,
        fullName: params.fullName?.trim(),
        createdAt: now,
        updatedAt: now,
      } as User;
      await Database.putItem(config.dynamodb.usersTable, user);
    }

    await Database.updateItem(config.dynamodb.invitationsTable, { token: params.token }, {
      acceptedAt: now,
    });
    Logger.info(`[staff-audit] staff invite accepted: ${invite.email} → ${role} (user ${userId})`);
    return { userId, platformRole: role };
  }

  /** Promote/demote a staffer. Exact-match role; protects the last admin. */
  static async changeRole(targetUserId: string, newRole: string, actorUserId: string): Promise<StaffMember> {
    const role = assertValidPlatformRole(newRole);
    const target = await Database.getItem<User>(config.dynamodb.usersTable, { userId: targetUserId });
    if (!target || target.role !== UserRole.ADMIN) throw new AppError('Staff member not found', 404);

    const currentTier = resolvePlatformRole(target.platformRole) ?? PlatformRole.STAFF_ADMIN;
    // Last-admin guard: refuse to demote the only active STAFF_ADMIN.
    if (currentTier === PlatformRole.STAFF_ADMIN && role !== PlatformRole.STAFF_ADMIN) {
      if (await this.activeAdminCount() <= 1) {
        throw new AppError('Cannot demote the last active STAFF_ADMIN', 409);
      }
    }

    await Database.updateItem(config.dynamodb.usersTable, { userId: targetUserId }, {
      platformRole: role,
      updatedAt: Helpers.getCurrentTimestamp(),
    });
    Logger.info(`[staff-audit] ${actorUserId} changed ${target.email} role ${currentTier} → ${role}`);
    return {
      userId: targetUserId, email: target.email, fullName: target.fullName,
      platformRole: role, status: target.status, createdAt: target.createdAt,
    };
  }

  /** Deactivate (suspend) a staffer. Can't deactivate self or the last admin. */
  static async deactivate(targetUserId: string, actorUserId: string): Promise<void> {
    if (targetUserId === actorUserId) throw new AppError('You cannot deactivate your own account', 409);
    const target = await Database.getItem<User>(config.dynamodb.usersTable, { userId: targetUserId });
    if (!target || target.role !== UserRole.ADMIN) throw new AppError('Staff member not found', 404);

    const tier = resolvePlatformRole(target.platformRole) ?? PlatformRole.STAFF_ADMIN;
    if (tier === PlatformRole.STAFF_ADMIN && target.status === UserStatus.ACTIVE) {
      if (await this.activeAdminCount() <= 1) {
        throw new AppError('Cannot deactivate the last active STAFF_ADMIN', 409);
      }
    }

    await Database.updateItem(config.dynamodb.usersTable, { userId: targetUserId }, {
      status: UserStatus.SUSPENDED,
      updatedAt: Helpers.getCurrentTimestamp(),
    });
    Logger.info(`[staff-audit] ${actorUserId} deactivated ${target.email} (${tier})`);
  }

  /** Reactivate a suspended staffer. */
  static async reactivate(targetUserId: string, actorUserId: string): Promise<void> {
    const target = await Database.getItem<User>(config.dynamodb.usersTable, { userId: targetUserId });
    if (!target || target.role !== UserRole.ADMIN) throw new AppError('Staff member not found', 404);
    await Database.updateItem(config.dynamodb.usersTable, { userId: targetUserId }, {
      status: UserStatus.ACTIVE,
      updatedAt: Helpers.getCurrentTimestamp(),
    });
    Logger.info(`[staff-audit] ${actorUserId} reactivated ${target.email}`);
  }

  /** Pending (unaccepted, unrevoked, unexpired) staff invites. */
  static async listPendingInvites(): Promise<PendingStaffInvite[]> {
    const all = await Database.scan<OrgInvitation>(config.dynamodb.invitationsTable);
    const now = Helpers.getCurrentTimestamp();
    return all
      .filter(i => i.platformRole && !i.acceptedAt && !i.revokedAt && i.expiresAt > now)
      .map(i => ({
        token: i.token, email: i.email, platformRole: i.platformRole!,
        invitedBy: i.invitedBy, expiresAt: i.expiresAt, createdAt: i.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Revoke a pending staff invite. */
  static async revokeInvite(token: string, actorUserId: string): Promise<void> {
    const invite = await OrgInvitationService.getInvitationByToken(token);
    if (!invite || !invite.platformRole) throw new AppError('Staff invitation not found', 404);
    if (invite.acceptedAt) throw new AppError('Invitation already accepted', 409);
    await Database.updateItem(config.dynamodb.invitationsTable, { token }, {
      revokedAt: Helpers.getCurrentTimestamp(),
      revokedBy: actorUserId,
    });
    Logger.info(`[staff-audit] ${actorUserId} revoked staff invite for ${invite.email}`);
  }
}
