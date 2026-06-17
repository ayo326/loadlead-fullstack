import express from 'express';
import { body, param } from 'express-validator';
import { authenticate, AuthRequest, requireRole, requireOrgCapability } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import {
  OrgService, OrgMembershipService, OrgInvitationService, OrgAuditService,
} from '../services/orgService';
import { OrgCapability, OrgRole, ADMIN_ORG_ROLES, UserRole } from '../types';
import { AppError } from '../middleware/errorHandler';
import { EmailService } from '../services/emailService';
import { Database } from '../config/database';
import config from '../config/environment';
import { submitCarrierDocs, getVerification, EntityType } from '../services/verification';
import { LoadService } from '../services/loadService';
import { OfferService } from '../services/offerService';
import { DriverService } from '../services/driverService';
import { resolveInvoicePayee } from '../services/factoring';
import * as Calc from '../services/dashboardCalc';
import { LoadStatus, OfferStatus, Driver, Load, Offer } from '../types';

const router = express.Router();

// Apply authentication + role guard to every org route.
// DRIVERs have no org concept and must not access these routes.
router.use(authenticate);
router.use(requireRole(
  UserRole.SHIPPER,
  UserRole.RECEIVER,
  UserRole.OWNER_OPERATOR,
  UserRole.CARRIER_ADMIN,
  UserRole.ADMIN,
));

// ─── Org CRUD ────────────────────────────────────────────────────────────────

/**
 * POST /api/org
 * Create a new organisation. The authenticated user becomes the OWNER.
 */
router.post(
  '/',
  validate([
    body('legalName').notEmpty().withMessage('legalName is required'),
    body('capabilities').isArray({ min: 1 }).withMessage('At least one capability is required'),
    body('capabilities.*').isIn(Object.values(OrgCapability)).withMessage('Invalid capability'),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { legalName, capabilities, dba, dotNumber, mcNumber, city, state, zip, country } = req.body;
    const result = await OrgService.createOrg({
      legalName,
      capabilities,
      ownerId: req.user!.userId,
      ownerRole: req.user!.role,
      dba, dotNumber, mcNumber, city, state, zip, country,
    });
    res.status(201).json(result);
  })
);

/**
 * GET /api/org
 * List all organisations the authenticated user belongs to.
 */
router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const orgs = await OrgService.getOrgsForUser(req.user!.userId);
    res.json({ orgs });
  })
);

/**
 * GET /api/org/:orgId
 * Get a single organisation (must be a member or Platform Admin).
 */
router.get(
  '/:orgId',
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const membership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    if (!membership && req.user!.role !== UserRole.ADMIN) {
      throw new AppError('Forbidden', 403);
    }
    const org = await OrgService.getOrgById(orgId);
    if (!org) throw new AppError('Organisation not found', 404);
    res.json({ org });
  })
);

/**
 * PATCH /api/org/:orgId
 * Update org details. Requires OWNER or ORG_ADMIN org role (or Platform Admin).
 */
router.patch(
  '/:orgId',
  validate([
    body('legalName').optional().notEmpty(),
    body('capabilities').optional().isArray({ min: 1 }),
    body('capabilities.*').optional().isIn(Object.values(OrgCapability)),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const membership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canEdit = req.user!.role === UserRole.ADMIN
      || (membership && ADMIN_ORG_ROLES.includes(membership.orgRole));
    if (!canEdit) throw new AppError('Forbidden', 403);

    const { legalName, capabilities, dba, dotNumber, mcNumber, city, state, zip, country } = req.body;
    await OrgService.updateOrg(orgId, { legalName, capabilities, dba, dotNumber, mcNumber, city, state, zip, country });
    res.json({ ok: true });
  })
);

// ─── Carrier-org verification (FMCSA + Didit KYB, keyed on orgId) ────────────
// Reuses the exact same submitCarrierDocs/getVerification functions the
// Owner Operator verification routes call (services/verification.ts) — no
// forked logic, just a CARRIER-capability org instead of an operatorId.

/**
 * GET /api/org/:orgId/verification
 * Current company authority status (FMCSA + KYB). OWNER/ORG_ADMIN only.
 */
router.get(
  '/:orgId/verification',
  requireOrgCapability(OrgCapability.CARRIER),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const membership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canView = req.user!.role === UserRole.ADMIN
      || (membership && ADMIN_ORG_ROLES.includes(membership.orgRole));
    if (!canView) throw new AppError('Forbidden', 403);

    const verification = await getVerification(orgId);
    res.json({ verification: verification ?? { verificationStatus: 'UNVERIFIED' } });
  })
);

/**
 * POST /api/org/:orgId/verification/submit
 * Submit MC/DOT for company-level verification (FMCSA + KYB). OWNER/ORG_ADMIN
 * only, and only on a CARRIER-capability org.
 */
router.post(
  '/:orgId/verification/submit',
  requireOrgCapability(OrgCapability.CARRIER),
  validate([
    body('mcNumber').optional().isString(),
    body('dotNumber').optional().isString(),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const { mcNumber, dotNumber } = req.body;
    if (!mcNumber && !dotNumber) throw new AppError('mcNumber or dotNumber is required', 400);

    const membership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canSubmit = req.user!.role === UserRole.ADMIN
      || (membership && ADMIN_ORG_ROLES.includes(membership.orgRole));
    if (!canSubmit) throw new AppError('Forbidden', 403);

    const verification = await submitCarrierDocs(orgId, EntityType.ORGANIZATION, mcNumber ?? '', dotNumber ?? '');
    res.status(201).json({ verification });
  })
);

// ─── Platform Admin: suspend / reinstate an org ───────────────────────────────

/**
 * POST /api/org/:orgId/suspend
 * Platform Admin only. Freezes the org and all its members' access.
 */
router.post(
  '/:orgId/suspend',
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const { reason } = req.body;
    const org = await OrgService.getOrgById(orgId);
    if (!org) throw new AppError('Organisation not found', 404);
    if (org.suspended) throw new AppError('Organisation is already suspended', 409);
    await OrgService.suspendOrg(orgId, req.user!.userId, reason);
    res.json({ ok: true, message: 'Organisation suspended' });
  })
);

/**
 * POST /api/org/:orgId/reinstate
 * Platform Admin only. Lifts a suspension.
 */
router.post(
  '/:orgId/reinstate',
  requireRole(UserRole.ADMIN),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const org = await OrgService.getOrgById(orgId);
    if (!org) throw new AppError('Organisation not found', 404);
    if (!org.suspended) throw new AppError('Organisation is not currently suspended', 409);
    await OrgService.reinstateOrg(orgId, req.user!.userId);
    res.json({ ok: true, message: 'Organisation reinstated' });
  })
);

// ─── Members ─────────────────────────────────────────────────────────────────

/**
 * GET /api/org/:orgId/members
 */
router.get(
  '/:orgId/members',
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const membership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    if (!membership && req.user!.role !== UserRole.ADMIN) throw new AppError('Forbidden', 403);

    const members = await OrgMembershipService.getMembersOfOrg(orgId);
    res.json({ members });
  })
);

/**
 * PATCH /api/org/:orgId/members/:membershipId
 * Change a member's org role. Only OWNER can promote to OWNER; OWNER/ORG_ADMIN can do the rest.
 */
router.patch(
  '/:orgId/members/:membershipId',
  validate([
    body('orgRole').isIn(Object.values(OrgRole)).withMessage('Invalid orgRole'),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId, membershipId } = req.params;
    const { orgRole } = req.body;

    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canEdit = req.user!.role === UserRole.ADMIN
      || (callerMembership && ADMIN_ORG_ROLES.includes(callerMembership.orgRole));
    if (!canEdit) throw new AppError('Forbidden', 403);

    if (orgRole === OrgRole.OWNER
      && callerMembership?.orgRole !== OrgRole.OWNER
      && req.user!.role !== UserRole.ADMIN) {
      throw new AppError('Only an OWNER can transfer ownership', 403);
    }

    const target = await OrgMembershipService.getMembershipById(membershipId);
    if (!target) throw new AppError('Membership not found', 404);

    await OrgMembershipService.updateMemberRole(
      membershipId,
      orgRole,
      req.user!.userId,
      callerMembership?.orgRole ?? req.user!.role,
      target.orgRole,
    );
    res.json({ ok: true });
  })
);

/**
 * DELETE /api/org/:orgId/members/:membershipId
 * Remove a member. OWNER/ORG_ADMIN org role required.
 * Enforces last-owner guard (spec §7).
 */
router.delete(
  '/:orgId/members/:membershipId',
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId, membershipId } = req.params;
    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canEdit = req.user!.role === UserRole.ADMIN
      || (callerMembership && ADMIN_ORG_ROLES.includes(callerMembership.orgRole));
    if (!canEdit) throw new AppError('Forbidden', 403);

    await OrgMembershipService.removeMember(
      membershipId,
      req.user!.userId,
      callerMembership?.orgRole ?? req.user!.role,
    );
    res.json({ ok: true });
  })
);

/**
 * POST /api/org/:orgId/members/:membershipId/suspend
 * Suspend a membership without deleting it (spec §6.4).
 */
router.post(
  '/:orgId/members/:membershipId/suspend',
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId, membershipId } = req.params;
    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canEdit = req.user!.role === UserRole.ADMIN
      || (callerMembership && ADMIN_ORG_ROLES.includes(callerMembership.orgRole));
    if (!canEdit) throw new AppError('Forbidden', 403);

    await OrgMembershipService.suspendMember(
      membershipId,
      req.user!.userId,
      callerMembership?.orgRole ?? req.user!.role,
    );
    res.json({ ok: true });
  })
);

/**
 * POST /api/org/:orgId/members/:membershipId/reinstate
 * Reinstate a suspended membership.
 */
router.post(
  '/:orgId/members/:membershipId/reinstate',
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId, membershipId } = req.params;
    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canEdit = req.user!.role === UserRole.ADMIN
      || (callerMembership && ADMIN_ORG_ROLES.includes(callerMembership.orgRole));
    if (!canEdit) throw new AppError('Forbidden', 403);

    await OrgMembershipService.reinstateMember(
      membershipId,
      req.user!.userId,
      callerMembership?.orgRole ?? req.user!.role,
    );
    res.json({ ok: true });
  })
);

// ─── Owner self-buffer (spec §5.1) ───────────────────────────────────────────

/**
 * PATCH /api/org/:orgId/buffer
 * Owner can set their own driver's safety buffer, within platform-defined bounds.
 * The Owner must also be a DRIVER (has a driver profile).
 */
router.patch(
  '/:orgId/buffer',
  validate([
    body('safetyBufferPct')
      .isInt({ min: 5, max: 25 })
      .withMessage('safetyBufferPct must be 5–25'),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const { safetyBufferPct } = req.body;

    // Must be OWNER of this org
    const membership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    if (!membership || membership.orgRole !== OrgRole.OWNER) {
      throw new AppError('Only the org Owner can set buffer via this endpoint', 403);
    }

    // Update driver record (Owner must have a DRIVER account)
    const { docClient } = await import('../config/aws');
    const { QueryCommand, UpdateCommand } = await import('@aws-sdk/lib-dynamodb');

    // Find driverId for this userId
    const qRes = await docClient.send(new QueryCommand({
      TableName: process.env.DYNAMODB_DRIVERS_TABLE || 'LoadLead-Drivers',
      IndexName: 'userId-index',
      KeyConditionExpression: '#u = :u',
      ExpressionAttributeNames: { '#u': 'userId' },
      ExpressionAttributeValues: { ':u': req.user!.userId },
    }));
    const driver = qRes.Items?.[0];
    if (!driver) throw new AppError('No driver profile found for this owner', 404);

    await docClient.send(new UpdateCommand({
      TableName: process.env.DYNAMODB_DRIVERS_TABLE || 'LoadLead-Drivers',
      Key: { driverId: driver.driverId },
      UpdateExpression: 'SET safetyBufferPct = :pct, bufferSetBy = :by, bufferSetByRole = :role, updatedAt = :ts',
      ExpressionAttributeValues: {
        ':pct': safetyBufferPct,
        ':by': req.user!.userId,
        ':role': 'OWNER',
        ':ts': Date.now(),
      },
    }));

    res.json({
      ok: true,
      safetyBufferPct,
      setBy: 'OWNER',
      message: `Safety buffer set to ${safetyBufferPct}% by your owner.`,
    });
  })
);

// ─── Direct driver onboarding (spec §5A, CARRIER orgs only) ──────────────────

/**
 * POST /api/org/:orgId/drivers
 * A Carrier org admin creates a driver profile + active membership directly
 * (no invite round trip). Creates the User account if one doesn't exist yet
 * and emails an activation link. The driver still completes Didit IDV
 * personally before their first acceptance — identity cannot be proxied.
 */
router.post(
  '/:orgId/drivers',
  requireOrgCapability(OrgCapability.CARRIER),
  validate([
    body('email').isEmail().withMessage('Valid email required'),
    body('legalName').notEmpty().withMessage('legalName is required'),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const { email, legalName, phone } = req.body;

    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canCreate = req.user!.role === UserRole.ADMIN
      || (callerMembership && ADMIN_ORG_ROLES.includes(callerMembership.orgRole));
    if (!canCreate) throw new AppError('Forbidden', 403);

    const { driver, membership } = await OrgService.createOrgDriver({
      orgId, email, legalName, phone, invitedBy: req.user!.userId,
    });
    res.status(201).json({ driver, membership });
  })
);

// ─── Invitations ─────────────────────────────────────────────────────────────

/**
 * POST /api/org/:orgId/invitations
 * Send an invitation. OWNER/ORG_ADMIN org role required.
 */
router.post(
  '/:orgId/invitations',
  validate([
    body('email').isEmail().withMessage('Valid email required'),
    body('orgRole').isIn(Object.values(OrgRole)).withMessage('Invalid orgRole'),
    body('userRole').isIn(Object.values(UserRole)).withMessage('Invalid userRole'),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const { email, orgRole, userRole } = req.body;

    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canInvite = req.user!.role === UserRole.ADMIN
      || (callerMembership && ADMIN_ORG_ROLES.includes(callerMembership.orgRole));
    if (!canInvite) throw new AppError('Forbidden', 403);

    const org = await OrgService.getOrgById(orgId);
    if (!org) throw new AppError('Organisation not found', 404);

    if (orgRole === OrgRole.ORG_DRIVER && !org.capabilities?.includes(OrgCapability.CARRIER)) {
      throw new AppError('ORG_DRIVER invitations require the organisation to have CARRIER capability', 409);
    }

    const invitation = await OrgInvitationService.createInvitation({
      orgId,
      email,
      orgRole,
      userRole,
      invitedBy: req.user!.userId,
    });

    // Send invite email (non-blocking)
    const inviteUrl = `${process.env.FRONTEND_URL || 'https://loadleadapp.com'}/accept-invite?token=${invitation.token}`;
    EmailService.sendOrgInvitation(email, org.legalName, inviteUrl).catch(() => {});

    res.status(201).json({ token: invitation.token, expiresAt: invitation.expiresAt });
  })
);

/**
 * GET /api/org/:orgId/invitations
 * List pending invitations for an org.
 */
router.get(
  '/:orgId/invitations',
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canView = req.user!.role === UserRole.ADMIN
      || (callerMembership && ADMIN_ORG_ROLES.includes(callerMembership.orgRole));
    if (!canView) throw new AppError('Forbidden', 403);

    const invitations = await OrgInvitationService.getInvitationsForOrg(orgId);
    // Filter out already-revoked so the list shows only actionable invites
    res.json({ invitations: invitations.filter(i => !i.revokedAt) });
  })
);

/**
 * DELETE /api/org/:orgId/invitations/:token
 * Revoke a pending invitation (spec §4.3). Owner/OrgAdmin only.
 */
router.delete(
  '/:orgId/invitations/:token',
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId, token } = req.params;

    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canRevoke = req.user!.role === UserRole.ADMIN
      || (callerMembership && ADMIN_ORG_ROLES.includes(callerMembership.orgRole));
    if (!canRevoke) throw new AppError('Forbidden', 403);

    await OrgInvitationService.revokeInvitation(token, req.user!.userId);
    res.json({ ok: true });
  })
);

/**
 * GET /api/org/invitations/:token
 * Preview an invitation (public — used on accept-invite page before login).
 */
router.get(
  '/invitations/:token',
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const invitation = await OrgInvitationService.getInvitationByToken(token);
    if (!invitation) throw new AppError('Invitation not found', 404);
    if (invitation.revokedAt) throw new AppError('Invitation has been revoked', 410);
    if (invitation.expiresAt < Date.now()) throw new AppError('Invitation has expired', 410);

    const org = await OrgService.getOrgById(invitation.orgId);
    res.json({
      email: invitation.email,
      orgRole: invitation.orgRole,
      userRole: invitation.userRole,
      orgName: org?.legalName,
      expiresAt: invitation.expiresAt,
      alreadyAccepted: !!invitation.acceptedAt,
    });
  })
);

/**
 * POST /api/org/invitations/:token/accept
 * Accept an invitation. Must be authenticated.
 */
router.post(
  '/invitations/:token/accept',
  asyncHandler(async (req: AuthRequest, res) => {
    const { token } = req.params;
    const membership = await OrgInvitationService.acceptInvitation(token, req.user!.userId);
    res.json({ membership });
  })
);

// ─── Audit log ───────────────────────────────────────────────────────────────

/**
 * GET /api/org/:orgId/audit
 * Membership audit trail. OWNER/ORG_ADMIN/Platform Admin only.
 */
router.get(
  '/:orgId/audit',
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canView = req.user!.role === UserRole.ADMIN
      || (callerMembership && ADMIN_ORG_ROLES.includes(callerMembership.orgRole));
    if (!canView) throw new AppError('Forbidden', 403);

    const logs = await OrgAuditService.getLogsForOrg(orgId);
    res.json({ logs: logs.sort((a, b) => b.timestamp - a.timestamp) });
  })
);

// ─── Carrier settings aggregation (canonical sections) ─────────────────────
// Read-only aggregation of the spec §3 canonical sections, bound to this
// org's canonical records. Writes are NOT here — they go through each
// section's existing canonical endpoint (PATCH /:orgId, POST verification/
// submit, POST :orgId/drivers, etc.) so we keep "no parallel store" rule.
//
// Independent of the OO settings endpoint — separate handler, separate code,
// per the Independence Principle. The parity test asserts both expose the
// same canonical section set (minus persona-N/As).
router.get('/:orgId/settings', asyncHandler(async (req: AuthRequest, res) => {
  const { orgId } = req.params;
  const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
  if (!callerMembership || callerMembership.status !== 'ACTIVE') {
    throw new AppError('Forbidden', 403);
  }

  const [org, members, authority] = await Promise.all([
    OrgService.getOrgById(orgId),
    OrgMembershipService.getMembersOfOrg(orgId),
    getVerification(orgId),
  ]);
  if (!org) throw new AppError('Organisation not found', 404);

  const driverMembers = members.filter(m => m.orgRole === OrgRole.ORG_DRIVER && m.status === 'ACTIVE');
  const driverUsers = await Promise.all(
    driverMembers.map(m =>
      Database.getItem<{ userId: string; email: string; idvStatus?: string }>(
        config.dynamodb.usersTable, { userId: m.userId },
      ),
    ),
  );

  res.json({
    parentType: 'CARRIER_ORG',
    sections: {
      profile: {
        editable: true,
        endpoint: `PATCH /api/org/${orgId}`,
        data: {
          legalName: org.legalName,
          dba: org.dba,
          mcNumber: org.mcNumber,
          dotNumber: org.dotNumber,
          city: org.city,
          state: org.state,
        },
      },
      verification: {
        editable: false,           // read-only mirror with re-verify action
        action: { endpoint: `POST /api/org/${orgId}/verification/submit` },
        data: {
          status: authority?.verificationStatus ?? 'UNVERIFIED',
          fmcsaAuthorityActive: authority?.fmcsaAuthorityActive ?? null,
          kybStatus: authority?.kybStatus ?? null,
          reverifyAfter: authority?.reverifyAfter ?? null,
        },
      },
      identity: {
        editable: false,           // read-only mirror of member drivers' user.idvStatus
        data: {
          members: driverUsers.filter(Boolean).map(u => ({
            userId: u!.userId,
            email: u!.email,
            idvStatus: u!.idvStatus ?? 'UNVERIFIED',
          })),
        },
      },
      driversFleet: {
        editable: true,
        endpoints: {
          createDirect: `POST /api/org/${orgId}/drivers`,
          invite: `POST /api/org/${orgId}/invitations`,
          roster: `GET /api/org/${orgId}/members`,
          remove: `DELETE /api/org/${orgId}/members/:membershipId`,
        },
        data: { count: driverMembers.length },
      },
      factoring: {
        editable: true,
        endpoint: `GET/PUT /api/factoring/profile?carrierId=${orgId}`,
        data: { carrierId: orgId },
      },
      notifications: {
        editable: true,
        endpoint: `GET/PUT /api/notifications/preferences`,
        data: { pushEnabled: null, emailEnabled: null }, // FE reads canonical prefs route
      },
      membersAndRoles: {
        editable: true,
        endpoints: {
          list: `GET /api/org/${orgId}/members`,
          changeRole: `PATCH /api/org/${orgId}/members/:membershipId/role`,
        },
        data: { total: members.length },
      },
      capabilities: {
        editable: false,           // read-only mirror; SHIPPER+CARRIER exclusivity enforced server-side
        data: { current: org.capabilities },
      },
    },
  });
}));

// ─── Carrier dashboard aggregation ──────────────────────────────────────────
// Independent of the OO dashboard. Computed server-side in a single handler
// per spec §0 — no N+1 from the client. Shares only the persona-neutral calc
// service with the OO dashboard.
//
// 🔴 fields (HOS, reefer, fuel, CSA) return { available:false } per the
// no-fabrication rule. The frontend renders those as "Connect <X>"
// placeholders, never zeros.
router.get(
  '/:orgId/dashboard',
  requireOrgCapability(OrgCapability.CARRIER),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    if (!callerMembership || callerMembership.status !== 'ACTIVE') {
      throw new AppError('Forbidden', 403);
    }

    // ── Org → drivers → loads + offers, in parallel ──────────────────────
    const members = await OrgMembershipService.getMembersOfOrg(orgId);
    const driverMembers = members.filter(m => m.orgRole === OrgRole.ORG_DRIVER && m.status === 'ACTIVE');

    // Driver records (Driver.userId === member.userId, since direct-onboarded
    // drivers' Driver row is keyed off their User).
    const driverProfiles = (await Promise.all(
      driverMembers.map(m => DriverService.getProfileByUserId(m.userId))
    )).filter((d): d is Driver => !!d);

    // Loads assigned to these drivers + their active offers — fan-out in
    // parallel so the handler is still O(1) round-trips per persona.
    const [driverLoads, driverOffersList, org, authority] = await Promise.all([
      Promise.all(driverProfiles.map(d => LoadService.getLoadsByAssignedDriver(d.driverId))),
      Promise.all(driverProfiles.map(d => OfferService.getOffersByDriver(d.driverId))),
      OrgService.getOrgById(orgId),
      getVerification(orgId),
    ]);

    const loads: Load[] = driverLoads.flat();
    const offers: Offer[] = driverOffersList.flat();

    // User records for member drivers (idvStatus lives on User per refactor)
    const memberUsers = await Promise.all(
      driverMembers.map(m =>
        Database.getItem<{ userId: string; idvStatus?: string }>(
          config.dynamodb.usersTable, { userId: m.userId },
        ),
      ),
    );

    // ── 1.1 Alerts ───────────────────────────────────────────────────────
    const activeLoads = Calc.activeLoadCounts(loads);
    const unassigned = Calc.unassignedLoads(loads).map(l => ({
      loadId: l.loadId,
      pickup: { city: l.pickupCity, state: l.pickupState, at: l.pickupDate },
      delivery: { city: l.deliveryCity, state: l.deliveryState, at: l.deliveryDate },
      rate: l.rateAmount,
    }));
    const etaAtRisk = Calc.etaAtRisk(loads); // 🟡 partial — no live ETA provider wired yet

    // ── 1.2 Fleet & compliance ───────────────────────────────────────────
    const driversPanel = driverProfiles.map(d => {
      const u = memberUsers.find(uu => uu?.userId === d.userId);
      return {
        driverId: d.driverId,
        name: d.legalName,
        availability: Calc.driverAvailability(d.driverId, offers, loads),
        idvStatus: u?.idvStatus ?? 'UNVERIFIED',
      };
    });
    const onboarding = Calc.onboardingRollup(memberUsers.filter(Boolean) as Array<{ idvStatus?: string }>);
    const authorityCompliance = Calc.complianceRollup(authority ?? null);

    // ── 1.3 Financial ─────────────────────────────────────────────────────
    const grossRevenue = Calc.grossRevenue(loads);
    const rpm = Calc.rpmBreakdown(loads);

    // Payee breakdown: only against delivered loads, and only those with an
    // amount we can compute. Each call to resolveInvoicePayee is sequential
    // intentionally — DynamoDB Local doesn't like many parallel writes; the
    // GSI on the OptIns table is the bottleneck anyway.
    const deliveredLoads = loads.filter(l => l.status === LoadStatus.DELIVERED);
    const payees = [];
    for (const l of deliveredLoads) {
      const total = l.rateType === 'PER_MILE'
        ? (l.totalMiles ? l.rateAmount * l.totalMiles : 0)
        : l.rateAmount;
      if (total <= 0) continue;
      try {
        const p = await resolveInvoicePayee(l.loadId);
        payees.push({ payee: p.payee, amount: total });
      } catch { /* per-load resolution failure shouldn't fail the dashboard */ }
    }
    const payeeBreakdown = Calc.payeeBreakdown(payees);

    // ── 1.4 Loadboard ────────────────────────────────────────────────────
    const tendered = offers
      .filter(o => o.status === OfferStatus.OFFERED)
      .map(o => {
        const l = loads.find(ll => ll.loadId === o.loadId);
        if (!l) return null;
        return {
          loadId: l.loadId,
          driverId: o.driverId,
          origin: { city: l.pickupCity, state: l.pickupState },
          dest: { city: l.deliveryCity, state: l.deliveryState },
          weight: l.totalWeightLbs,
          commodity: l.commodityDescription,
          equipment: l.equipmentType,
          payout: l.rateType === 'PER_MILE' ? (l.totalMiles ?? 0) * l.rateAmount : l.rateAmount,
          expiresAt: o.expiresAt,
        };
      })
      .filter(Boolean);

    // ── 1.5 SLA ──────────────────────────────────────────────────────────
    const acceptance = Calc.acceptanceMetrics(offers);
    const otp = Calc.otpMetrics(loads);

    res.json({
      orgId,
      orgName: org?.legalName,
      // 1.1
      alerts: {
        activeLoads,
        unassigned,
        etaAtRisk,
        hosWarnings: Calc.NOT_CONNECTED,        // ELD integration not connected
        reeferDeviations: Calc.NOT_CONNECTED,   // Trailer telemetry not connected
      },
      // 1.2
      fleet: {
        drivers: driversPanel,
        onboarding,
        authorityExpiry: authorityCompliance.daysToExpiry,
        compliance: authorityCompliance,
        insurance: Calc.PENDING_CAPTURE,         // COI fields not captured yet
        hosRemaining: Calc.NOT_CONNECTED,
        equipmentHealth: Calc.NOT_CONNECTED,
      },
      // 1.3
      financial: {
        grossRevenue,
        rpm,
        payeeBreakdown,
        factoringPipeline: Calc.factoringPipeline([]), // No org-level factoring opt-ins surface yet
        fuelSpend: Calc.NOT_CONNECTED,
        tolls: Calc.NOT_CONNECTED,
      },
      // 1.4
      loadboard: {
        tendered,
        capabilityWarnings: [],  // capability gate enforces server-side; warnings empty here means nothing to surface
        dwell: Calc.dwell(loads), // 🟡 pending status-transition timestamps
        deadhead: Calc.PENDING_CAPTURE,
      },
      // 1.5
      sla: {
        otp,
        acceptance,
        compliancePosture: authorityCompliance,
        csaScores: Calc.NOT_CONNECTED,
      },
    });
  })
);

export default router;
