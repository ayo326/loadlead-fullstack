# Admin Console Build-out — Progress

Living checklist for the multi-phase rebuild of `admin.loadleadapp.com`.
Resume from the first NOT STARTED item. See task brief in the original
prompt for the full execution protocol.

| # | Phase | Status |
|---|---|---|
| 1 | Internal `/login` revamp + platform-staff roles | DONE |
| 2 | Live fleet feed (telematics-gated) | NOT STARTED |
| 3 | Email support inbox (Resend inbound + outbound; SLA) | NOT STARTED |
| 4 | Chat + phone via third-party embeds | NOT STARTED |
| 5 | Independence + a11y pass | NOT STARTED |

## Phase 1 — Internal /login + platform-staff roles
**Status:** DONE
**Files touched:**
- `backend/src/types/platformRole.ts` — NEW. `PlatformRole` enum (STAFF_ADMIN | STAFF_MANAGER | STAFF_SUPERVISOR | STAFF_TEAM_LEAD), tier matrices (DESTRUCTIVE_TIER, OPS_TIER, READ_TIER), back-compat resolver. Different module + different TS type than `OrgRole`.
- `backend/src/types/index.ts` — added optional `platformRole?: string` to User.
- `backend/src/middleware/auth.ts` — `requireStaffTier(...allowed)` middleware. Fresh DB read of the user (NOT the JWT) so tier changes take effect on the next request, not the next token refresh.
- `backend/src/routes/admin.ts` — `requireStaffTier(...DESTRUCTIVE_TIER)` on `/orgs/:id/suspend`, `/orgs/:id/reinstate`, `/users/:id/revoke-admin`. Read-only routes stay on `requireAdmin` only (all four tiers can read).
- `backend/scripts/setPlatformRole.mjs` — NEW CLI to set / change tier on an existing ADMIN user. Idempotent.
- `backend/tests/unit/iam/platformRole.test.ts` — NEW (15/15 pass): (a) PlatformRole values namespaced with `STAFF_`; (b) STAFF_MANAGER/SUPERVISOR/TEAM_LEAD all 403 on the three destructive routes; (c) STAFF_ADMIN passes; (d) legacy admin row with no `platformRole` resolves to STAFF_ADMIN (back-compat).
- `frontend-v2/src/pages/admin/AdminLogin.tsx` — NEW. Internal-only sign-in: env badge (PROD/STAGING/DEV), authorized-use notice, IP-restricted note, neutral palette, no signup, no marketing. Generic error copy ("Sign-in failed") so wrong-email vs wrong-password are indistinguishable. Lockout message for 429. Clear MFA challenge screen with one-time-code field.
- `frontend-v2/src/admin-main.tsx` — swapped customer `Login` for `AdminLogin` at the `/login` route in the admin bundle.

**Acceptance / proof (all green):**
- 15/15 platformRole tests pass.
- Admin bundle (`dist-admin/admin-*.js`) contains `"Internal use only"` and `"LoadLead Platform Operations"` and does NOT contain `"Join the network"` or `"owner operator portal"` — verified via grep on the built artefact.
- `PlatformRole` is in its own module (`types/platformRole.ts`); `OrgRole.MANAGER === "MANAGER"` ≠ `PlatformRole.STAFF_MANAGER === "STAFF_MANAGER"`.
- All four staff roles can sign in (`/api/auth/login` 2FA gate covers everyone with role=ADMIN); only STAFF_ADMIN tier passes destructive routes.

**Ops follow-ups for the user (not blocking):**
- Once deployed, run `node backend/scripts/setPlatformRole.mjs --email <admin email> --tier <STAFF_*>` against each of the 4 existing ADMIN rows to assign explicit tiers. Until then they all back-compat to STAFF_ADMIN, which preserves current behaviour.

## Phase 2 — Live fleet feed
**Status:** NOT STARTED → next on resume.
**Next step on resume:** survey existing `/api/admin/loads/:loadId/tracking` + DriverProfile fields; design `/api/admin/fleet/feed` endpoint; render feed + drawer; gate live-GPS on a `TELEMATICS_PROVIDER` env var with a clear "live tracking not connected" empty state (no fabricated positions).

## Phase 3 — Email support inbox
**Status:** NOT STARTED
**Next step on resume:** Resend Inbound receiving domain + webhook signature verification; SupportTicket + SupportMessage DynamoDB tables; threading via Message-ID + In-Reply-To + References.

## Phase 4 — Chat + phone embeds
**Status:** NOT STARTED
**Next step on resume:** support adapter (interface), env-driven vendor wiring, unconfigured "not connected" state.

## Phase 5 — Independence + a11y
**Status:** NOT STARTED
**Next step on resume:** grep for shared parameterized containers; axe-core run; WCAG AA fixes.
