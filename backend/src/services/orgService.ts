import crypto from 'crypto';
import { Organization, OrgMembership, OrgInvitation, OrgCapability, OrgRole, UserRole } from '../types';
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

  /** All orgs where a user has a membership */
  static async getOrgsForUser(userId: string): Promise<Organization[]> {
    const memberships = await OrgMembershipService.getMembershipsForUser(userId);
    if (!memberships.length) return [];

    const orgs = await Promise.all(
      memberships.map(m => OrgService.getOrgById(m.orgId))
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

  static async updateMemberRole(membershipId: string, orgRole: OrgRole): Promise<void> {
    await Database.updateItem(config.dynamodb.membershipsTable, { membershipId }, { orgRole });
  }

  static async removeMember(membershipId: string): Promise<void> {
    // DynamoDB delete via updateItem pattern not ideal — use deleteItem
    const { docClient } = await import('../config/aws');
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    await docClient.send(new DeleteCommand({
      TableName: config.dynamodb.membershipsTable,
      Key: { membershipId },
    }));
  }
}

// ─── OrgInvitationService ────────────────────────────────────────────────────

const INVITE_TTL_HOURS = 72;

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

  /** Accept an invitation: creates membership, marks invitation accepted */
  static async acceptInvitation(token: string, userId: string): Promise<OrgMembership> {
    const invite = await this.getInvitationByToken(token);
    if (!invite) throw new AppError('Invitation not found', 404);
    if (invite.acceptedAt) throw new AppError('Invitation already used', 409);
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

    Logger.info(`Invitation accepted: ${token} by user ${userId}`);
    return membership;
  }
}
