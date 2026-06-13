import crypto from 'crypto';
import {
  Organization, OrgMembership, OrgInvitation, MembershipAuditLog,
  OrgCapability, OrgRole, ADMIN_ORG_ROLES, UserRole,
} from '../types';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';
import Logger from '../utils/logger';

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

  /** All orgs where a user has an ACTIVE membership */
  static async getOrgsForUser(userId: string): Promise<Organization[]> {
    const memberships = await OrgMembershipService.getMembershipsForUser(userId);
    if (!memberships.length) return [];

    const orgs = await Promise.all(
      memberships
        .filter(m => m.status === 'ACTIVE')
        .map(m => OrgService.getOrgById(m.orgId))
    );
    return orgs.filter(Boolean) as Organization[];
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
    await Database.updateItem(config.dynamodb.membershipsTable, { membershipId }, { orgRole });
    // Fetch the updated record to get orgId/userId for audit
    const membership = await this.getMembershipById(membershipId);
    if (membership) {
      await OrgAuditService.log({
        orgId: membership.orgId,
        targetUserId: membership.userId,
        actorUserId,
        actorRole,
        action: 'ROLE_CHANGED',
        oldValue: oldRole,
        newValue: orgRole,
      });
    }
  }

  /** Remove a member. Enforces last-owner guard (spec §7). */
  static async removeMember(
    membershipId: string,
    actorUserId: string,
    actorRole: string,
  ): Promise<void> {
    const membership = await this.getMembershipById(membershipId);
    if (!membership) throw new AppError('Membership not found', 404);

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
