/**
 * requireBetaGate — the single server-side gate for private-beta access.
 *
 * Precedence (matches the TASK spec, all SERVER-SIDE):
 *   1. BETA_MODE flag. OFF → gate lifts entirely, next() immediately.
 *   2. Signup/login is permitted ONLY if EITHER:
 *        a) a valid inviteToken is presented in the body, OR
 *        b) the email is in BetaAllowlist (direct EMAIL row or matching
 *           DOMAIN row)
 *   3. Otherwise: 403 with neutral "LoadLead is in private beta" message.
 *      No disclosure of whether the email exists, no different message
 *      for "not allowlisted" vs "no invite" — same message either way.
 *
 * The middleware attaches `req.betaContext` so downstream handlers know
 * HOW the user got through:
 *   { invitedVia: 'INVITE', invitation: <full row> }
 *   { invitedVia: 'ALLOWLIST', allowlistEntry: <full row> }
 *
 * Routes that should NEVER be gated (admin, setup, health, the gate
 * endpoints themselves) MUST NOT mount this middleware. We do not try to
 * be clever with path-based bypass — that's a footgun. Mount it only on
 * the routes that need it (the two signup routes + login).
 *
 * The CLI bootstrap path (backend/scripts/bootstrapAdmin.mjs) writes
 * directly to DDB and never hits HTTP — it is structurally outside this
 * gate. ADMIN logins go through /api/auth/login and the middleware lets
 * ADMIN through unconditionally (the role is on the user record; we
 * check it via the email after a tentative lookup).
 */

import { Request, Response, NextFunction } from 'express';
import { isBetaMode } from '../config/beta';
import { OrgInvitationService } from '../services/orgService';
import { BetaAllowlistService } from '../services/betaAllowlistService';
import { Logger } from '../utils/logger';
import { Database } from '../config/database';
import config from '../config/environment';
import { OrgInvitation, BetaAllowlistEntry, UserRole, User } from '../types';

/** Attached to req by requireBetaGate when the request passes. */
export interface BetaContext {
  invitedVia: 'INVITE' | 'ALLOWLIST';
  invitation?: OrgInvitation;
  allowlistEntry?: BetaAllowlistEntry;
}

/**
 * Neutral response — never discloses whether the email exists, whether
 * an invite was found, or anything else specific. Same shape no matter
 * which sub-check failed.
 */
function rejectAsBeta(res: Response): Response {
  return res.status(403).json({
    error: 'BETA_REQUIRED',
    message:
      'LoadLead is currently in private beta. Request access on the ' +
      'waitlist and we will reach out when your spot opens.',
  });
}

/**
 * Validate an invitation token. Returns the row when valid (so the gate
 * can stamp betaContext); null when invalid (caller falls through to
 * allowlist check, which is the right behaviour: a user might paste a
 * stale token but their email could still be on the allowlist).
 *
 * The token must:
 *   - exist
 *   - not be revoked
 *   - not be expired
 *   - not already accepted
 *   - match the email being signed up with (case-insensitive)
 */
async function checkInvitation(
  token: string | undefined,
  email: string,
): Promise<OrgInvitation | null> {
  if (!token) return null;
  const invite = await OrgInvitationService.getInvitationByToken(token);
  if (!invite) return null;
  if (invite.revokedAt) return null;
  if (invite.acceptedAt) return null;
  if (invite.expiresAt < Date.now()) return null;
  if (invite.email.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  return invite;
}

/**
 * The gate middleware. Reads `email` and (optionally) `inviteToken` from
 * the request body. For login, the inviteToken is absent — we only
 * check the allowlist and the existing user's betaUser flag.
 *
 * @param opts.mode  'signup' or 'login' — login also lets ADMINs through
 *                    unconditionally and checks existing user.betaUser
 *                    instead of requiring a new invite.
 */
export function requireBetaGate(opts: { mode: 'signup' | 'login' }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Fast path: gate disabled → no checks, no DB reads.
    if (!isBetaMode()) return next();

    const email: string | undefined = req.body?.email;
    if (!email || typeof email !== 'string') {
      return rejectAsBeta(res);
    }

    // ── login: check existing user.betaUser / role first ──────────────
    if (opts.mode === 'login') {
      try {
        const matches = await Database.query<User>(
          config.dynamodb.usersTable,
          'email-index',
          '#email = :email',
          { '#email': 'email' },
          { ':email': email.trim().toLowerCase() },
        );
        const user = matches[0];
        // No user — let the auth route handle "invalid credentials" with
        // its own neutral response. Don't reveal "no such email" via
        // a different status code.
        if (!user) return next();

        // ADMIN never gated.
        if (user.role === UserRole.ADMIN) return next();

        // Existing beta user — allow.
        if (user.betaUser === true) return next();

        // Pre-beta accounts that exist but aren't part of the cohort:
        // reject with the neutral private-beta message. They join the
        // waitlist like any non-cohort visitor.
        return rejectAsBeta(res);
      } catch (err) {
        Logger.error('beta gate (login) failed', err);
        // Fail closed: when we can't verify the gate, refuse access.
        return rejectAsBeta(res);
      }
    }

    // ── signup: invite OR allowlist ───────────────────────────────────
    try {
      const inviteToken: string | undefined = req.body?.inviteToken;
      const invitation = await checkInvitation(inviteToken, email);
      if (invitation) {
        (req as any).betaContext = {
          invitedVia: 'INVITE',
          invitation,
        } as BetaContext;
        return next();
      }

      const allowlistEntry = await BetaAllowlistService.findActiveMatchForEmail(email);
      if (allowlistEntry) {
        (req as any).betaContext = {
          invitedVia: 'ALLOWLIST',
          allowlistEntry,
        } as BetaContext;
        return next();
      }

      return rejectAsBeta(res);
    } catch (err) {
      Logger.error('beta gate (signup) failed', err);
      return rejectAsBeta(res);
    }
  };
}
