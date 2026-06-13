import express from 'express';
import { body, param } from 'express-validator';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { OrgService, OrgMembershipService, OrgInvitationService } from '../services/orgService';
import { OrgCapability, OrgRole, UserRole } from '../types';
import { AppError } from '../middleware/errorHandler';
import { EmailService } from '../services/emailService';

const router = express.Router();

// ─── Org CRUD ────────────────────────────────────────────────────────────────

/**
 * POST /api/org
 * Create a new organisation. The authenticated user becomes the OWNER.
 */
router.post(
  '/',
  authenticate,
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
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const orgs = await OrgService.getOrgsForUser(req.user!.userId);
    res.json({ orgs });
  })
);

/**
 * GET /api/org/:orgId
 * Get a single organisation (must be a member).
 */
router.get(
  '/:orgId',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const membership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    // ADMIN can always view any org
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
 * Update org details. Requires OWNER or ADMIN org role (or system ADMIN).
 */
router.patch(
  '/:orgId',
  authenticate,
  validate([
    body('legalName').optional().notEmpty(),
    body('capabilities').optional().isArray({ min: 1 }),
    body('capabilities.*').optional().isIn(Object.values(OrgCapability)),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const membership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canEdit = req.user!.role === UserRole.ADMIN
      || (membership && [OrgRole.OWNER, OrgRole.ADMIN].includes(membership.orgRole));
    if (!canEdit) throw new AppError('Forbidden', 403);

    const { legalName, capabilities, dba, dotNumber, mcNumber, city, state, zip, country } = req.body;
    await OrgService.updateOrg(orgId, { legalName, capabilities, dba, dotNumber, mcNumber, city, state, zip, country });
    res.json({ ok: true });
  })
);

// ─── Members ─────────────────────────────────────────────────────────────────

/**
 * GET /api/org/:orgId/members
 */
router.get(
  '/:orgId/members',
  authenticate,
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
 * Change a member's org role. Only OWNER can promote to OWNER; OWNER/ADMIN can do the rest.
 */
router.patch(
  '/:orgId/members/:membershipId',
  authenticate,
  validate([
    body('orgRole').isIn(Object.values(OrgRole)).withMessage('Invalid orgRole'),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId, membershipId } = req.params;
    const { orgRole } = req.body;

    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canEdit = req.user!.role === UserRole.ADMIN
      || (callerMembership && [OrgRole.OWNER, OrgRole.ADMIN].includes(callerMembership.orgRole));
    if (!canEdit) throw new AppError('Forbidden', 403);

    if (orgRole === OrgRole.OWNER && callerMembership?.orgRole !== OrgRole.OWNER && req.user!.role !== UserRole.ADMIN) {
      throw new AppError('Only an OWNER can transfer ownership', 403);
    }

    await OrgMembershipService.updateMemberRole(membershipId, orgRole);
    res.json({ ok: true });
  })
);

/**
 * DELETE /api/org/:orgId/members/:membershipId
 * Remove a member. OWNER/ADMIN org role required.
 */
router.delete(
  '/:orgId/members/:membershipId',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId, membershipId } = req.params;
    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canEdit = req.user!.role === UserRole.ADMIN
      || (callerMembership && [OrgRole.OWNER, OrgRole.ADMIN].includes(callerMembership.orgRole));
    if (!canEdit) throw new AppError('Forbidden', 403);

    await OrgMembershipService.removeMember(membershipId);
    res.json({ ok: true });
  })
);

// ─── Invitations ─────────────────────────────────────────────────────────────

/**
 * POST /api/org/:orgId/invitations
 * Send an invitation. OWNER/ADMIN org role required.
 */
router.post(
  '/:orgId/invitations',
  authenticate,
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
      || (callerMembership && [OrgRole.OWNER, OrgRole.ADMIN].includes(callerMembership.orgRole));
    if (!canInvite) throw new AppError('Forbidden', 403);

    const org = await OrgService.getOrgById(orgId);
    if (!org) throw new AppError('Organisation not found', 404);

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
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { orgId } = req.params;
    const callerMembership = await OrgMembershipService.getMembership(orgId, req.user!.userId);
    const canView = req.user!.role === UserRole.ADMIN
      || (callerMembership && [OrgRole.OWNER, OrgRole.ADMIN].includes(callerMembership.orgRole));
    if (!canView) throw new AppError('Forbidden', 403);

    const invitations = await OrgInvitationService.getInvitationsForOrg(orgId);
    res.json({ invitations });
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
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { token } = req.params;
    const membership = await OrgInvitationService.acceptInvitation(token, req.user!.userId);
    res.json({ membership });
  })
);

export default router;
