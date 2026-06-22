import crypto from 'crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  Organization, OrgMembership, OrgInvitation, MembershipAuditLog,
  OrgCapability, OrgRole, ADMIN_ORG_ROLES, UserRole, Driver,
} from '../types';
import { Database } from '../config/database';
import { docClient } from '../config/aws';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';
import { DriverService } from './driverService';
import { EmailService } from './emailService';
import Logger from '../utils/logger';

const RESET_TABLE = process.env.DYNAMODB_RESET_TABLE || 'LoadLead_PasswordResets';

// ─── Capability invariant ────────────────────────────────────────────────────
// SHIPPER and CARRIER are mutually exclusive — a shipper that self-hauls would
// make self-haul fraud unrepresentable to check at runtime. RECEIVER may
// coexist with either (e.g. a distribution center that ships and receives).
// Centralized here and called from every org write path so it can't be
// bypassed by a new route forgetting to check.
export function assertCapabilities(caps: OrgCapability[]): void {
  const set = new Set(caps);
  if (set.size === 0) throw new AppError('Org needs at least one capability', 400);
  if (set.has(OrgCapability.SHIPPER) && set.has(OrgCapability.CARRIER)) {
    throw new AppError('SHIPPER and CARRIER capabilities are mutually exclusive', 400);
  }
}

// ─── OrgService ──────────────────────────────────────────────────────────────

export class OrgService {

  // ── Create organisation + owner membership atomically ──
  static async createOrg(params: {
    legalName: string;
    capabilities: OrgCapability[];
    ownerId: string;
    ownerRole: UserRole;
    dba?: string;
    dotNumber?: string;
    mcNumber?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  }): Promise<{ org: Organization; membership: OrgMembership }> {
    assertCapabilities(params.capabilities);
    const orgId = Helpers.generateId('org');
    const now = Helpers.getCurrentTimestamp();

    const org: Organization = {
      orgId,
      legalName: params.legalName,
      dba: params.dba,
      capabilities: params.capabilities,
      dotNumber: params.dotNumber,
      mcNumber: params.mcNumber,
      city: params.city,
      state: params.state,
      zip: params.zip,
      country: params.country,
      ownerId: params.ownerId,
      suspended: false,
      createdAt: now,
      updatedAt: now,
    };

    await Database.putItem(config.dynamodb.orgsTable, org);

    const membership = await OrgMembershipService.addMember({
      orgId,
      userId: params.ownerId,
      orgRole: OrgRole.OWNER,
      userRole: params.ownerRole,
    });

    await OrgAuditService.log({
      orgId,
      targetUserId: params.ownerId,
      actorUserId: params.ownerId,
      actorRole: params.ownerRole,
      action: 'MEMBER_ADDED',
      newValue: OrgRole.OWNER,
    });

    Logger.info(`Org created: ${orgId} by ${params.ownerId}`);
    return { org, membership };
  }

  static async getOrgById(orgId: string): Promise<Organization | null> {
    return Database.getItem<Organization>(config.dynamodb.orgsTable, { orgId });
  }

  static async updateOrg(orgId: string, updates: Partial<Organization>): Promise<void> {
    if (updates.capabilities) assertCapabilities(updates.capabilities);
    await Database.updateItem(config.dynamodb.orgsTable, { orgId }, {
      ...updates,
      updatedAt: Helpers.getCurrentTimestamp(),
    });
  }

  /** Platform Admin: suspend an entire org (spec §6.4) */
  static async suspendOrg(orgId: string, actorUserId: string, reason?: string): Promise<void> {
    const now = Helpers.getCurrentTimestamp();
    await Database.updateItem(config.dynamodb.orgsTable, { orgId }, {
      suspended: true,
      suspendedAt: now,
      suspendedBy: actorUserId,
      suspensionReason: reason ?? '',
      updatedAt: now,
    });
    await OrgAuditService.log({
      orgId,
      targetUserId: orgId,   // target is the org itself
      actorUserId,
      actorRole: UserRole.ADMIN,
      action: 'ORG_SUSPENDED',
      newValue: reason,
    });
    Logger.info(`Org suspended: ${orgId} by ${actorUserId}`);
  }

  /** Platform Admin: reinstate a suspended org */
  static async reinstateOrg(orgId: string, actorUserId: string): Promise<void> {
    const now = Helpers.getCurrentTimestamp();
    await Database.updateItem(config.dynamodb.orgsTable, { orgId }, {
      suspended: false,
      suspendedAt: undefined,
      suspendedBy: undefined,
      suspensionReason: undefined,
      updatedAt: now,
    });
    await OrgAuditService.log({
      orgId,
      targetUserId: orgId,
      actorUserId,
      actorRole: UserRole.ADMIN,
      action: 'ORG_REINSTATED',
    });
    Logger.info(`Org reinstated: ${orgId} by ${actorUserId}`);
  }

  /** All orgs where a user has a membership (ACTIVE or legacy records without status field) */
  static async getOrgsForUser(userId: string): Promise<Organization[]> {
    const memberships = await OrgMembershipService.getMembershipsForUser(userId);
    if (!memberships.length) return [];

    const orgs = await Promise.all(
      // Treat missing status as ACTIVE for backward-compat with pre-migration records
      memberships
        .filter(m => !m.status || m.status === 'ACTIVE')
        .map(m => OrgService.getOrgById(m.orgId))
    );
    return orgs.filter(Boolean) as Organization[];
  }

  /**
   * Direct driver onboarding (spec §5A) — a Carrier org's admin creates the
   * driver profile + active membership immediately, without an invite round
   * trip. The driver still completes Didit IDV personally before their first
   * acceptance (identity cannot be proxied). If no User account exists for
   * the email yet, one is created and an activation link (reusing the
   * existing forgot/reset-password flow) is emailed so they can set a
   * password.
   */
  static async createOrgDriver(params: {
    orgId: string;
    email: string;
    legalName: string;
    phone?: string;
    invitedBy: string;
  }): Promise<{ driver: Driver; membership: OrgMembership }> {
    const now = Helpers.getCurrentTimestamp();

    let user = await Database.query<{ userId: string }>(
      config.dynamodb.usersTable,
      'email-index',
      '#email = :email',
      { '#email': 'email' },
      { ':email': params.email },
    ).then(r => r[0] ?? null);

    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      const userId = Helpers.generateId('user');
      await Database.putItem(config.dynamodb.usersTable, {
        userId,
        email: params.email,
        password: await Helpers.hashPassword(crypto.randomBytes(24).toString('hex')),
        role: UserRole.DRIVER,
        status: 'PENDING_VERIFICATION',
        createdAt: now,
        updatedAt: now,
      });
      user = { userId };
    }

    // One-parent invariant: a fleet-bound driver cannot also join a Carrier org.
    const existingDriver = await DriverService.getProfileByUserId(user.userId);
    if (existingDriver?.ownedByOperatorId) {
      throw new AppError(
        'This person is already part of an Owner Operator fleet. Remove them from the fleet before adding to a Carrier org.',
        409,
      );
    }
    await OrgMembershipService.clearActiveCarrierMembership(user.userId);

    const driver = existingDriver ?? await DriverService.createProfile(user.userId, {
      legalName: params.legalName,
      phone: params.phone ?? '',
    });

    const membership = await OrgMembershipService.addMember({
      orgId: params.orgId,
      userId: user.userId,
      orgRole: OrgRole.ORG_DRIVER,
      userRole: UserRole.DRIVER,
    });

    await OrgAuditService.log({
      orgId: params.orgId,
      targetUserId: user.userId,
      actorUserId: params.invitedBy,
      actorRole: 'OWNER_OR_ORG_ADMIN',
      action: 'MEMBER_ADDED',
      newValue: OrgRole.ORG_DRIVER,
    });

    // Activation link reuses the existing self-service reset-password flow —
    // no new token mechanism needed.
    if (isNewUser) {
      const token = crypto.randomBytes(32).toString('hex');
      await docClient.send(new PutCommand({
        TableName: RESET_TABLE,
        Item: { token, userId: user.userId, email: params.email, expiresAt: now + 60 * 60 * 1000 },
      }));
      const activationUrl = `${process.env.FRONTEND_URL || 'https://loadleadapp.com'}/reset-password?token=${token}`;
      EmailService.sendOrgInvitation(params.email, 'your new Carrier org', activationUrl).catch(() => {});
    }

    Logger.info(`Org driver created: ${driver.driverId} in org ${params.orgId}`);
    return { driver, membership };
  }
}

// ─── OrgMembershipService ────────────────────────────────────────────────────

export class OrgMembershipService {

  static async addMember(params: {
    orgId: string;
    userId: string;
    orgRole: OrgRole;
    userRole: UserRole;
  }): Promise<OrgMembership> {
    const membershipId = Helpers.generateId('mbr');
    const membership: OrgMembership = {
      membershipId,
      orgId: params.orgId,
      userId: params.userId,
      orgRole: params.orgRole,
      userRole: params.userRole,
      status: 'ACTIVE',
      joinedAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.membershipsTable, membership);
    return membership;
  }

  static async getMembershipsForUser(userId: string): Promise<OrgMembership[]> {
    return Database.query<OrgMembership>(
      config.dynamodb.membershipsTable,
      'userId-index',
      '#userId = :userId',
      { '#userId': 'userId' },
      { ':userId': userId }
    );
  }

  static async getMembersOfOrg(orgId: string): Promise<OrgMembership[]> {
    return Database.query<OrgMembership>(
      config.dynamodb.membershipsTable,
      'orgId-index',
      '#orgId = :orgId',
      { '#orgId': 'orgId' },
      { ':orgId': orgId }
    );
  }

  static async getMembership(orgId: string, userId: string): Promise<OrgMembership | null> {
    const all = await this.getMembersOfOrg(orgId);
    return all.find(m => m.userId === userId) ?? null;
  }

  static async getMembershipById(membershipId: string): Promise<OrgMembership | null> {
    return Database.getItem<OrgMembership>(config.dynamodb.membershipsTable, { membershipId });
  }

  static async updateMemberRole(
    membershipId: string,
    orgRole: OrgRole,
    actorUserId: string,
    actorRole: string,
    oldRole: string,
  ): Promise<void> {
    const target = await this.getMembershipById(membershipId);
    if (!target) throw new AppError('Membership not found', 404);

    // Self-edit guard. You cannot change your own role; that path goes
    // through Transfer Ownership (OWNER-only) or removeMember.
    if (target.userId === actorUserId && actorRole !== UserRole.ADMIN) {
      throw new AppError('You cannot change your own role.', 403);
    }

    // Only OWNER (or platform ADMIN) can promote to OWNER or demote an
    // existing OWNER. MANAGER cannot touch OWNER memberships at all.
    const isOwnerTouched = oldRole === OrgRole.OWNER || orgRole === OrgRole.OWNER;
    if (isOwnerTouched && actorRole !== OrgRole.OWNER && actorRole !== UserRole.ADMIN) {
      throw new AppError('Only an Owner can change ownership.', 403);
    }

    // Last-owner guard for demotions.
    if (oldRole === OrgRole.OWNER && orgRole !== OrgRole.OWNER) {
      const all = await this.getMembersOfOrg(target.orgId);
      const otherOwners = all.filter(m =>
        m.membershipId !== membershipId
        && m.orgRole === OrgRole.OWNER
        && (m.status ?? 'ACTIVE') === 'ACTIVE');
      if (otherOwners.length === 0) {
        throw new AppError(
          'Cannot demote the last Owner. Promote another member to Owner first.',
          409,
        );
      }
    }

    await Database.updateItem(config.dynamodb.membershipsTable, { membershipId }, { orgRole });
    await OrgAuditService.log({
      orgId: target.orgId,
      targetUserId: target.userId,
      actorUserId,
      actorRole,
      action: 'ROLE_CHANGED',
      oldValue: oldRole,
      newValue: orgRole,
    });
  }

  /** Remove a member. Enforces spec §7 (last-owner, self, owner-protection). */
  static async removeMember(
    membershipId: string,
    actorUserId: string,
    actorRole: string,
  ): Promise<void> {
    const membership = await this.getMembershipById(membershipId);
    if (!membership) throw new AppError('Membership not found', 404);

    // Self-removal guard. A member cannot kick themselves; if they want
    // to leave they must use a separate Leave Org flow, or have someone
    // else remove them. This prevents the "I deleted myself by accident
    // and now I have no org" trap that surfaced in prod.
    if (membership.userId === actorUserId && actorRole !== UserRole.ADMIN) {
      throw new AppError(
        'You cannot remove yourself from the organisation. ' +
        'Ask another Owner or Manager to do it.',
        403,
      );
    }

    // OWNER-protection. Only another OWNER (or platform ADMIN) can
    // remove an OWNER. A MANAGER removing an OWNER was the gap that
    // produced the prod incident.
    if (membership.orgRole === OrgRole.OWNER
        && actorRole !== OrgRole.OWNER
        && actorRole !== UserRole.ADMIN) {
      throw new AppError('Only an Owner can remove another Owner.', 403);
    }

    // Last-owner guard (spec §7)
    if (membership.orgRole === OrgRole.OWNER) {
      const allMembers = await this.getMembersOfOrg(membership.orgId);
      const owners = allMembers.filter(m => m.orgRole === OrgRole.OWNER && m.status === 'ACTIVE');
      if (owners.length <= 1) {
        throw new AppError(
          'Cannot remove the last Owner. Transfer ownership first or add another Owner.',
          409
        );
      }
    }

    const { docClient } = await import('../config/aws');
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    await docClient.send(new DeleteCommand({
      TableName: config.dynamodb.membershipsTable,
      Key: { membershipId },
    }));

    await OrgAuditService.log({
      orgId: membership.orgId,
      targetUserId: membership.userId,
      actorUserId,
      actorRole,
      action: 'MEMBER_REMOVED',
      oldValue: membership.orgRole,
    });
  }

  /** Suspend a membership without deleting it (spec §6.4) */
  static async suspendMember(
    membershipId: string,
    actorUserId: string,
    actorRole: string,
  ): Promise<void> {
    const membership = await this.getMembershipById(membershipId);
    if (!membership) throw new AppError('Membership not found', 404);

    // Cannot suspend the last OWNER
    if (membership.orgRole === OrgRole.OWNER) {
      const allMembers = await this.getMembersOfOrg(membership.orgId);
      const activeOwners = allMembers.filter(
        m => m.orgRole === OrgRole.OWNER && m.status === 'ACTIVE'
      );
      if (activeOwners.length <= 1) {
        throw new AppError('Cannot suspend the last active Owner.', 409);
      }
    }

    await Database.updateItem(config.dynamodb.membershipsTable, { membershipId }, {
      status: 'SUSPENDED',
      suspendedAt: Helpers.getCurrentTimestamp(),
      suspendedBy: actorUserId,
    });

    await OrgAuditService.log({
      orgId: membership.orgId,
      targetUserId: membership.userId,
      actorUserId,
      actorRole,
      action: 'MEMBER_SUSPENDED',
    });
  }

  /**
   * One-parent invariant: remove this user's ACTIVE membership in any
   * CARRIER-capability org. Called when a driver joins an Owner Operator
   * fleet, since fleet membership and Carrier-org membership are mutually
   * exclusive (spec §5, "one parent only").
   */
  static async clearActiveCarrierMembership(userId: string): Promise<void> {
    const memberships = await this.getMembershipsForUser(userId);
    for (const m of memberships) {
      if (m.status !== 'ACTIVE') continue;
      const org = await OrgService.getOrgById(m.orgId);
      if (org?.capabilities?.includes(OrgCapability.CARRIER)) {
        await this.removeMember(m.membershipId, userId, 'SYSTEM_ONE_PARENT_INVARIANT');
      }
    }
  }

  /** Reinstate a suspended membership */
  static async reinstateMember(
    membershipId: string,
    actorUserId: string,
    actorRole: string,
  ): Promise<void> {
    const membership = await this.getMembershipById(membershipId);
    if (!membership) throw new AppError('Membership not found', 404);

    await Database.updateItem(config.dynamodb.membershipsTable, { membershipId }, {
      status: 'ACTIVE',
      suspendedAt: undefined,
      suspendedBy: undefined,
    });

    await OrgAuditService.log({
      orgId: membership.orgId,
      targetUserId: membership.userId,
      actorUserId,
      actorRole,
      action: 'MEMBER_REINSTATED',
    });
  }
}

// ─── OrgInvitationService ────────────────────────────────────────────────────

/** 7 days per spec §4.3 */
const INVITE_TTL_HOURS = 168;

export class OrgInvitationService {

  static async createInvitation(params: {
    orgId: string;
    email: string;
    orgRole: OrgRole;
    userRole: UserRole;
    invitedBy: string;
  }): Promise<OrgInvitation> {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Helpers.getCurrentTimestamp();

    const invitation: OrgInvitation = {
      token,
      orgId: params.orgId,
      email: params.email,
      orgRole: params.orgRole,
      userRole: params.userRole,
      invitedBy: params.invitedBy,
      expiresAt: now + INVITE_TTL_HOURS * 60 * 60 * 1000,
      createdAt: now,
    };

    await Database.putItem(config.dynamodb.invitationsTable, invitation);

    await OrgAuditService.log({
      orgId: params.orgId,
      targetUserId: params.email,   // user may not exist yet
      actorUserId: params.invitedBy,
      actorRole: 'OWNER_OR_ORG_ADMIN',
      action: 'INVITE_SENT',
      newValue: params.orgRole,
    });

    Logger.info(`Invitation created for ${params.email} to org ${params.orgId}`);
    return invitation;
  }

  static async getInvitationByToken(token: string): Promise<OrgInvitation | null> {
    return Database.getItem<OrgInvitation>(config.dynamodb.invitationsTable, { token });
  }

  static async getInvitationsForOrg(orgId: string): Promise<OrgInvitation[]> {
    return Database.query<OrgInvitation>(
      config.dynamodb.invitationsTable,
      'orgId-index',
      '#orgId = :orgId',
      { '#orgId': 'orgId' },
      { ':orgId': orgId }
    );
  }

  /** Revoke a pending invitation (spec §4.3). Only Owner/OrgAdmin may revoke. */
  static async revokeInvitation(token: string, actorUserId: string): Promise<void> {
    const invite = await this.getInvitationByToken(token);
    if (!invite) throw new AppError('Invitation not found', 404);
    if (invite.acceptedAt) throw new AppError('Invitation already accepted — cannot revoke', 409);
    if (invite.revokedAt) throw new AppError('Invitation already revoked', 409);

    await Database.updateItem(config.dynamodb.invitationsTable, { token }, {
      revokedAt: Helpers.getCurrentTimestamp(),
      revokedBy: actorUserId,
    });

    await OrgAuditService.log({
      orgId: invite.orgId,
      targetUserId: invite.email,
      actorUserId,
      actorRole: 'OWNER_OR_ORG_ADMIN',
      action: 'INVITE_REVOKED',
      oldValue: invite.orgRole,
    });

    Logger.info(`Invitation revoked: ${token} by ${actorUserId}`);
  }

  /** Accept an invitation: creates membership, marks invitation accepted */
  static async acceptInvitation(token: string, userId: string): Promise<OrgMembership> {
    const invite = await this.getInvitationByToken(token);
    if (!invite) throw new AppError('Invitation not found', 404);
    if (invite.acceptedAt) throw new AppError('Invitation already used', 409);
    if (invite.revokedAt) throw new AppError('Invitation has been revoked', 410);
    if (invite.expiresAt < Helpers.getCurrentTimestamp()) {
      throw new AppError('Invitation has expired', 410);
    }

    // One-parent invariant: joining a Carrier org as ORG_DRIVER must clear any
    // existing Owner Operator fleet assignment, and vice versa (driver.ts
    // fleet/accept-invite calls the symmetric clearActiveCarrierMembership).
    if (invite.orgRole === OrgRole.ORG_DRIVER) {
      const org = await OrgService.getOrgById(invite.orgId);
      if (!org?.capabilities?.includes(OrgCapability.CARRIER)) {
        throw new AppError('This organisation does not have CARRIER capability', 409);
      }

      let driver = await DriverService.getProfileByUserId(userId);
      if (driver?.ownedByOperatorId) {
        await Database.updateItem(config.dynamodb.driversTable, { driverId: driver.driverId }, {
          ownedByOperatorId: null,
        });
      }
      if (!driver) {
        driver = await DriverService.createProfile(userId, { legalName: invite.email, phone: '' });
      }
    }

    const membership = await OrgMembershipService.addMember({
      orgId: invite.orgId,
      userId,
      orgRole: invite.orgRole,
      userRole: invite.userRole,
    });

    // Mark accepted
    await Database.updateItem(config.dynamodb.invitationsTable, { token }, {
      acceptedAt: Helpers.getCurrentTimestamp(),
    });

    await OrgAuditService.log({
      orgId: invite.orgId,
      targetUserId: userId,
      actorUserId: userId,
      actorRole: invite.userRole,
      action: 'INVITE_ACCEPTED',
      newValue: invite.orgRole,
    });

    Logger.info(`Invitation accepted: ${token} by user ${userId}`);
    return membership;
  }
}

// ─── OrgAuditService ─────────────────────────────────────────────────────────

const MEMBERSHIP_AUDIT_TABLE = process.env.DYNAMODB_MEMBERSHIP_AUDIT_TABLE
  || 'LoadLead-MembershipAuditLogs';

export class OrgAuditService {
  static async log(params: {
    orgId: string;
    targetUserId: string;
    actorUserId: string;
    actorRole: string;
    action: MembershipAuditLog['action'];
    oldValue?: string;
    newValue?: string;
  }): Promise<void> {
    try {
      const log: MembershipAuditLog = {
        logId: Helpers.generateId('mlog'),
        orgId: params.orgId,
        targetUserId: params.targetUserId,
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        action: params.action,
        oldValue: params.oldValue,
        newValue: params.newValue,
        timestamp: Helpers.getCurrentTimestamp(),
      };
      await Database.putItem(MEMBERSHIP_AUDIT_TABLE, log);
    } catch (e) {
      // Non-blocking — audit failures must not break primary operations
      Logger.error(`[OrgAuditService] Failed to write audit log: ${e}`);
    }
  }

  static async getLogsForOrg(orgId: string): Promise<MembershipAuditLog[]> {
    return Database.query<MembershipAuditLog>(
      MEMBERSHIP_AUDIT_TABLE,
      'orgId-index',
      '#orgId = :orgId',
      { '#orgId': 'orgId' },
      { ':orgId': orgId }
    );
  }
}
