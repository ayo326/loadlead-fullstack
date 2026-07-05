/**
 * /api/admin/staff/* - platform-staff IAM management.
 *
 * GATED to STAFF_ADMIN only: authenticate → requireStaffTier(DESTRUCTIVE_TIER).
 * requireStaffTier does a fresh DB read of the user's platformRole (not the
 * JWT) and exact-matches it against DESTRUCTIVE_TIER = [STAFF_ADMIN]. So a
 * non-ADMIN role, OR an ADMIN-role staffer whose tier is MANAGER/SUPERVISOR/
 * TEAM_LEAD, gets 403 here. UI hides the section; this is the real gate.
 *
 * The accept endpoint (acceptStaffInviteHandler) is PUBLIC (the invitee
 * isn't logged in yet) and token-gated; it's mounted separately in index.ts.
 */

import express from 'express';
import { body } from 'express-validator';
import { authenticate, requireStaffTier, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { StaffService } from '../services/staffService';
import { DESTRUCTIVE_TIER, ALL_PLATFORM_ROLES } from '../types/platformRole';

const router = express.Router();

// Only STAFF_ADMIN reaches any route below.
router.use(authenticate);
router.use(requireStaffTier(...DESTRUCTIVE_TIER));

/** GET /api/admin/staff - list platform staff with role + status. */
router.get('/', asyncHandler(async (_req: AuthRequest, res) => {
  res.json({ staff: await StaffService.listStaff() });
}));

/** POST /api/admin/staff/invite { email, platformRole } - reuses Invitation flow. */
router.post(
  '/invite',
  validate([
    body('email').isEmail(),
    body('platformRole').isIn(ALL_PLATFORM_ROLES as string[]),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const invitation = await StaffService.invite({
      email: req.body.email,
      platformRole: req.body.platformRole,
      invitedBy: req.user!.userId,
    });
    res.status(201).json({
      ok: true,
      token: invitation.token,
      acceptUrl: `/accept-staff-invite?token=${invitation.token}`,
      email: invitation.email,
      platformRole: invitation.platformRole,
    });
  }),
);

/** PUT /api/admin/staff/:userId/role { platformRole } - promote/demote. */
router.put(
  '/:userId/role',
  validate([body('platformRole').isIn(ALL_PLATFORM_ROLES as string[])]),
  asyncHandler(async (req: AuthRequest, res) => {
    const member = await StaffService.changeRole(req.params.userId, req.body.platformRole, req.user!.userId);
    res.json({ ok: true, member });
  }),
);

/** POST /api/admin/staff/:userId/deactivate */
router.post('/:userId/deactivate', asyncHandler(async (req: AuthRequest, res) => {
  await StaffService.deactivate(req.params.userId, req.user!.userId);
  res.json({ ok: true });
}));

/** POST /api/admin/staff/:userId/reactivate */
router.post('/:userId/reactivate', asyncHandler(async (req: AuthRequest, res) => {
  await StaffService.reactivate(req.params.userId, req.user!.userId);
  res.json({ ok: true });
}));

/** GET /api/admin/staff/invites - pending staff invites. */
router.get('/invites', asyncHandler(async (_req: AuthRequest, res) => {
  res.json({ invites: await StaffService.listPendingInvites() });
}));

/** DELETE /api/admin/staff/invites/:token - revoke a pending invite. */
router.delete('/invites/:token', asyncHandler(async (req: AuthRequest, res) => {
  await StaffService.revokeInvite(req.params.token, req.user!.userId);
  res.json({ ok: true });
}));

export default router;

/**
 * PUBLIC accept handler (no session - the invitee isn't a user yet).
 * POST /api/admin/staff/accept-invite { token, password, fullName }
 * Mounted standalone in index.ts BEFORE the gated router so it's reachable
 * without auth. Token is the gate; reuses the same invite validation as
 * every other accept path.
 */
export const acceptStaffInviteValidators = [
  body('token').isString().isLength({ min: 16 }),
  body('password').optional().isString(),
  body('fullName').optional().isString(),
];
export const acceptStaffInviteHandler = asyncHandler(async (req: express.Request, res: express.Response) => {
  const { token, password, fullName } = req.body;
  const result = await StaffService.acceptInvite({ token, password, fullName });
  res.status(201).json({ ok: true, userId: result.userId, platformRole: result.platformRole });
});
