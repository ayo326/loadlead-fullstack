/**
 * /api/admin/beta/* — the Beta Program management surface for platform
 * staff. Exact-ADMIN gated (same requireAdmin used by the rest of the
 * admin console). Mounted separately from admin.ts to keep the beta
 * concern self-contained.
 *
 * The ADMIT action is the heart of Part B: it REUSES the existing
 * OrgInvitationService (createSelfSignupInvitation for non-carrier
 * personas, createInvitation for carrier-org) AND adds the email to
 * BetaAllowlist — never a parallel invite mechanism. The eventual signup
 * through that invite stamps betaUser=true / cohort / invitedVia=INVITE.
 *
 * Every mutating action is audit-logged (Logger + the action carries the
 * acting staff userId). No secrets or PII beyond the applicant's own
 * contact data, which staff are authorized to see.
 */

import express from 'express';
import { body } from 'express-validator';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { Logger } from '../utils/logger';
import { getBetaConfig } from '../config/beta';
import { BetaApplicationService, sideToUserRole } from '../services/betaApplicationService';
import { BetaAllowlistService } from '../services/betaAllowlistService';
import { WaitlistService } from '../services/waitlistService';
import { OrgInvitationService } from '../services/orgService';
import { findLaneOverlaps } from '../services/betaScoring';
import { UserRole } from '../types';

const router = express.Router();

// Exact-ADMIN gate on every beta admin route.
router.use(authenticate);
router.use(requireAdmin);

// ─── Applications pipeline ───────────────────────────────────────────────

/** GET /api/admin/beta/applications?status=&side=&wave= */
router.get('/applications', asyncHandler(async (req: AuthRequest, res) => {
  const { status, side, wave } = req.query as Record<string, string>;
  const apps = await BetaApplicationService.list({ status, side, wave });
  // newest first
  apps.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ applications: apps, count: apps.length });
}));

/** GET /api/admin/beta/applications/:id — detail + lane-overlap helper */
router.get('/applications/:id', asyncHandler(async (req: AuthRequest, res) => {
  const app = await BetaApplicationService.get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  // Lane-overlap helper: surface other-side candidates sharing lanes/Texas.
  const otherSide = app.side === 'CARRIER' ? ['SHIPPER', 'BOTH'] : ['CARRIER', 'BOTH'];
  const all = await BetaApplicationService.list();
  const candidates = all.filter(a => otherSide.includes(a.side) && a.status !== 'DISQUALIFIED');
  const overlaps = findLaneOverlaps(app, candidates);
  const overlapDetail = overlaps.slice(0, 10).map(o => {
    const c = candidates.find(x => x.applicationId === o.applicationId)!;
    return {
      applicationId: o.applicationId,
      fullName: c.fullName,
      company: c.company,
      side: c.side,
      sharedLaneTokens: o.sharedTokens,
      bothTexas: o.bothTexas,
    };
  });

  res.json({ application: app, laneOverlaps: overlapDetail });
}));

/** PUT /api/admin/beta/applications/:id/score — staff edits subjective dims */
router.put(
  '/applications/:id/score',
  validate([
    body('segmentFit').optional().isInt({ min: 0, max: 3 }),
    body('laneOverlap').optional().isInt({ min: 0, max: 2 }),
    body('pain').optional().isInt({ min: 0, max: 2 }),
    body('responsiveness').optional().isInt({ min: 0, max: 1 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const { segmentFit, laneOverlap, pain, responsiveness } = req.body;
    const updated = await BetaApplicationService.updateScore(req.params.id, {
      segmentFit, laneOverlap, pain, responsiveness,
    });
    Logger.info(`[beta-admin] ${req.user!.userId} scored application ${req.params.id}: ${updated.score}/15`);
    res.json({ application: updated });
  }),
);

/** POST /api/admin/beta/applications/:id/notes */
router.post(
  '/applications/:id/notes',
  validate([body('text').isString().isLength({ min: 1, max: 2000 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    await BetaApplicationService.addNote(req.params.id, req.user!.userId, req.body.text);
    res.json({ ok: true });
  }),
);

/** POST /api/admin/beta/applications/:id/assign */
router.post('/applications/:id/assign', asyncHandler(async (req: AuthRequest, res) => {
  await BetaApplicationService.assign(req.params.id, req.user!.userId);
  res.json({ ok: true });
}));

/** POST /api/admin/beta/applications/:id/waitlist — move to waitlist tier */
router.post('/applications/:id/waitlist', asyncHandler(async (req: AuthRequest, res) => {
  const app = await BetaApplicationService.get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  await BetaApplicationService.setStatus(req.params.id, 'WAITLISTED');
  // Also drop a Waitlist row so it shows in the waitlist view alongside
  // landing-page entries.
  await WaitlistService.add({
    email: app.workEmail,
    name: app.fullName,
    personaInterest: sideToUserRole(app.side),
    source: 'application',
  });
  Logger.info(`[beta-admin] ${req.user!.userId} waitlisted application ${req.params.id}`);
  res.json({ ok: true });
}));

/**
 * POST /api/admin/beta/applications/:id/admit — THE admit round-trip.
 *   1. issue an Invitation via the EXISTING flow (self-signup invite for
 *      Shipper/OO/Receiver/Driver; carrier-org invite path for Carrier)
 *   2. add the applicant's email to BetaAllowlist (so even if they lose
 *      the invite link, their email self-signs-up)
 *   3. mark the application ADMITTED→INVITED + stamp cohort/wave +
 *      linkedInvitationToken
 *
 * Body: { wave?: string, userRoleOverride?: UserRole }
 * Never creates a second invite mechanism.
 */
router.post(
  '/applications/:id/admit',
  validate([
    body('wave').optional().isString(),
    body('userRoleOverride').optional().isIn(Object.values(UserRole)),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const app = await BetaApplicationService.get(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (app.status === 'INVITED' || app.status === 'ONBOARDED') {
      return res.status(409).json({ error: 'Application already admitted' });
    }

    const cfg = getBetaConfig();
    const wave = req.body.wave || cfg.currentCohort;
    const userRole: UserRole = req.body.userRoleOverride || sideToUserRole(app.side);
    const staffId = req.user!.userId;

    // 1. Issue an invite via the EXISTING service. Self-signup invite
    //    (no orgId) for every persona including carrier — the carrier
    //    creates their org during signupCarrier, so a self-signup invite
    //    is correct here (the org isn't pre-created by staff).
    const invitation = await OrgInvitationService.createSelfSignupInvitation({
      email: app.workEmail,
      userRole,
      invitedBy: staffId,
      cohort: wave,
    });

    // 2. Allowlist the email (belt-and-suspenders: the invite is the
    //    primary path; the allowlist covers link-loss + lets them retry).
    await BetaAllowlistService.add({
      type: 'EMAIL',
      value: app.workEmail,
      addedByStaffId: staffId,
      reason: `Admitted from beta application ${app.applicationId} (${wave})`,
    });

    // 3. Mark the application admitted + link the invite.
    await BetaApplicationService.markAdmitted(app.applicationId, {
      invitationToken: invitation.token,
      cohort: wave,
      wave,
    });

    Logger.info(`[beta-admin] ${staffId} ADMITTED application ${app.applicationId} (${app.workEmail}, role=${userRole}, wave=${wave}) → invite ${invitation.token.slice(0, 8)}…`);

    res.json({
      ok: true,
      invitationToken: invitation.token,
      acceptUrl: `/accept-invite?token=${invitation.token}`,
      cohort: wave,
      userRole,
    });
  }),
);

// ─── Cohort balance (headline metric) ────────────────────────────────────

/** GET /api/admin/beta/cohort-balance?wave= */
router.get('/cohort-balance', asyncHandler(async (req: AuthRequest, res) => {
  const wave = (req.query.wave as string) || undefined;
  const balance = await BetaApplicationService.cohortBalance(wave);
  const cfg = getBetaConfig();

  // The ratio target is ~1:1; flag if either side is >20% past the other.
  const { shippers, carriers } = balance.admitted;
  const total = shippers + carriers;
  const ratioOff = total > 0
    ? Math.abs(shippers - carriers) / total > 0.2
    : false;

  res.json({
    ...balance,
    cohortCap: cfg.cohortCap,
    seatsFilled: balance.totalAdmitted,
    ratioTarget: '1:1',
    ratioOutOfBalance: ratioOff,
    currentCohort: cfg.currentCohort,
  });
}));

// ─── Allowlist management ────────────────────────────────────────────────

/** GET /api/admin/beta/allowlist */
router.get('/allowlist', asyncHandler(async (_req: AuthRequest, res) => {
  const entries = await BetaAllowlistService.list();
  entries.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ entries });
}));

/** POST /api/admin/beta/allowlist  { type, value, reason? } */
router.post(
  '/allowlist',
  validate([
    body('type').isIn(['EMAIL', 'DOMAIN']),
    body('value').isString().isLength({ min: 3, max: 255 }),
    body('reason').optional().isString().isLength({ max: 500 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const entry = await BetaAllowlistService.add({
      type: req.body.type,
      value: req.body.value,
      addedByStaffId: req.user!.userId,
      reason: req.body.reason,
    });
    Logger.info(`[beta-admin] ${req.user!.userId} allowlisted ${entry.type} ${entry.value}`);
    res.status(201).json({ entry });
  }),
);

/** DELETE /api/admin/beta/allowlist/:id — soft-delete */
router.delete('/allowlist/:id', asyncHandler(async (req: AuthRequest, res) => {
  await BetaAllowlistService.deactivate(req.params.id, req.user!.userId);
  res.json({ ok: true });
}));

// ─── Waitlist management ─────────────────────────────────────────────────

/** GET /api/admin/beta/waitlist */
router.get('/waitlist', asyncHandler(async (_req: AuthRequest, res) => {
  const entries = await WaitlistService.listAll();
  entries.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ entries });
}));

/** POST /api/admin/beta/waitlist/:id/promote — promote a waitlisted person
 *  to an invite (issues a self-signup invite + allowlists + marks INVITED). */
router.post(
  '/waitlist/:id/promote',
  validate([
    body('userRole').isIn(Object.values(UserRole)),
    body('wave').optional().isString(),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const all = await WaitlistService.listAll();
    const entry = all.find(e => e.waitlistId === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Waitlist entry not found' });

    const cfg = getBetaConfig();
    const wave = req.body.wave || cfg.currentCohort;
    const staffId = req.user!.userId;

    const invitation = await OrgInvitationService.createSelfSignupInvitation({
      email: entry.email,
      userRole: req.body.userRole,
      invitedBy: staffId,
      cohort: wave,
    });
    await BetaAllowlistService.add({
      type: 'EMAIL',
      value: entry.email,
      addedByStaffId: staffId,
      reason: `Promoted from waitlist ${entry.waitlistId} (${wave})`,
    });
    await WaitlistService.markInvited(entry.waitlistId, staffId);

    Logger.info(`[beta-admin] ${staffId} promoted waitlist ${entry.waitlistId} (${entry.email}) → invite`);
    res.json({ ok: true, invitationToken: invitation.token, acceptUrl: `/accept-invite?token=${invitation.token}` });
  }),
);

// ─── CSV export ──────────────────────────────────────────────────────────

/** GET /api/admin/beta/export/applications.csv */
router.get('/export/applications.csv', asyncHandler(async (_req: AuthRequest, res) => {
  const apps = await BetaApplicationService.list();
  const header = [
    'applicationId', 'side', 'fullName', 'workEmail', 'company', 'region',
    'texasFocus', 'status', 'score', 'cohort', 'wave', 'autoFlags', 'createdAt',
  ];
  const rows = apps.map(a => [
    a.applicationId, a.side, a.fullName, a.workEmail, a.company ?? '', a.region ?? '',
    a.texasFocus, a.status, a.score ?? '', a.cohort ?? '', a.wave ?? '',
    (a.autoFlags ?? []).join('|'), new Date(a.createdAt).toISOString(),
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(csvCell).join(','))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="beta-applications.csv"');
  res.send(csv);
}));

function csvCell(v: any): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default router;
