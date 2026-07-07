/**
 * Public beta routes - the non-authenticated surface of the private-beta
 * program. Mounted at /api/beta. NOT gated by requireBetaGate (these are
 * the routes a non-cohort visitor needs to reach).
 *
 * Endpoints:
 *   GET  /api/beta/status   - { betaMode, tallyConnected } for the FE
 *                              landing page to know what to render
 *   POST /api/beta/waitlist - public, captures email + name +
 *                              personaInterest from the landing form
 *   POST /api/beta/tally-webhook - Tally form submission (Part B)
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
import { EmailService } from '../services/emailService';
import { getBetaConfig, isTallyConnected } from '../config/beta';
import { isFleetCarrierPersonaEnabled } from '../config/featureFlags';
import { Logger } from '../utils/logger';
import { UserRole } from '../types';

const router = express.Router();

/** Public status - no auth, no PII. Tells the FE landing page how to
 *  behave (private-beta gate visible? Tally form connected?). */
router.get('/status', (req, res) => {
  const cfg = getBetaConfig();
  res.json({
    betaMode: cfg.betaMode,
    currentCohort: cfg.currentCohort,
    tallyConnected: isTallyConnected(),
    // Persona flags for the FE to gate muted personas. The FE reads the same
    // single source here (no scattered env reads); the backend enforces
    // independently.
    fleetCarrierPersonaEnabled: isFleetCarrierPersonaEnabled(),
  });
});

/** Public waitlist signup. Idempotent - adding the same email twice
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

    // Auto-send the beta application form (Tally) so the visitor can apply
    // right away. Fire-and-forget: a mail failure never breaks the waitlist
    // join, and we never disclose existence via timing/status. The form URL
    // is env-configurable; default is the public LoadLead beta form.
    const formUrl = process.env.TALLY_FORM_URL || 'https://tally.so/r/Xxglrj';
    EmailService.betaFormInvite(email, formUrl).catch((e) =>
      Logger.warn(`[beta] form-invite email failed: ${e?.message}`));

    // We return the same shape whether the row was new or pre-existing -
    // the caller can't probe "is this email already on the list" by
    // inspecting the response.
    res.status(201).json({
      ok: true,
      waitlistId: entry.waitlistId,
      message:
        'Thanks - you are on the list. Check your email for the beta ' +
        'application form.',
    });
  }),
);

// NOTE: the Tally webhook lives at POST /api/admin/beta/webhook - mounted
// separately in index.ts with a route-only raw-body parser (before
// express.json) so the HMAC verifies against the exact bytes Tally sent.
// See routes/tallyWebhook.ts. It is intentionally NOT under this public
// /api/beta router (which is JSON-parsed) nor the requireAdmin router.

export default router;
