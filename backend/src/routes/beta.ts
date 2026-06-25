/**
 * Public beta routes — the non-authenticated surface of the private-beta
 * program. Mounted at /api/beta. NOT gated by requireBetaGate (these are
 * the routes a non-cohort visitor needs to reach).
 *
 * Endpoints:
 *   GET  /api/beta/status   — { betaMode, tallyConnected } for the FE
 *                              landing page to know what to render
 *   POST /api/beta/waitlist — public, captures email + name +
 *                              personaInterest from the landing form
 *   POST /api/beta/tally-webhook — Tally form submission (Part B)
 *
 * The admin-side endpoints live under /api/admin/beta/* and are gated by
 * the existing requireAdmin middleware (they're in routes/admin.ts in a
 * later commit).
 */

import express from 'express';
import { body } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { WaitlistService } from '../services/waitlistService';
import { getBetaConfig, isTallyConnected } from '../config/beta';
import { UserRole } from '../types';

const router = express.Router();

/** Public status — no auth, no PII. Tells the FE landing page how to
 *  behave (private-beta gate visible? Tally form connected?). */
router.get('/status', (req, res) => {
  const cfg = getBetaConfig();
  res.json({
    betaMode: cfg.betaMode,
    currentCohort: cfg.currentCohort,
    tallyConnected: isTallyConnected(),
  });
});

/** Public waitlist signup. Idempotent — adding the same email twice
 *  returns the existing row. Always 2XX so abuse-resistant (no
 *  email-existence disclosure via status code). */
router.post(
  '/waitlist',
  validate([
    body('email').isEmail().withMessage('Valid email is required'),
    body('name').optional().isString().isLength({ max: 200 }),
    body('personaInterest').optional().isIn(Object.values(UserRole)),
  ]),
  asyncHandler(async (req, res) => {
    const { email, name, personaInterest } = req.body as {
      email: string; name?: string; personaInterest?: UserRole;
    };
    const entry = await WaitlistService.add({
      email,
      name,
      personaInterest,
      source: 'landing',
    });
    // We return the same shape whether the row was new or pre-existing —
    // the caller can't probe "is this email already on the list" by
    // inspecting the response.
    res.status(201).json({
      ok: true,
      waitlistId: entry.waitlistId,
      message:
        'Thanks — you are on the waitlist. We will be in touch when ' +
        'your spot opens.',
    });
  }),
);

// NOTE: the Tally webhook lives at POST /api/admin/beta/webhook — mounted
// separately in index.ts with a route-only raw-body parser (before
// express.json) so the HMAC verifies against the exact bytes Tally sent.
// See routes/tallyWebhook.ts. It is intentionally NOT under this public
// /api/beta router (which is JSON-parsed) nor the requireAdmin router.

export default router;
