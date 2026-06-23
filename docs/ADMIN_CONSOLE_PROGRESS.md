# Admin Console Build-out — Progress

Living checklist for the multi-phase rebuild of `admin.loadleadapp.com`.
Resume from the first NOT STARTED item. See task brief in the original
prompt for the full execution protocol.

| # | Phase | Status |
|---|---|---|
| 1 | Internal `/login` revamp + platform-staff roles | DONE |
| 2 | Live fleet feed (telematics-gated) | DONE |
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
**Status:** DONE
**Files touched:**
- `backend/src/services/telematics.ts` — NEW. `getTelematicsStatus()` reads `TELEMATICS_PROVIDER` env. Empty/unset = `{ connected: false, provider: null }`. Any value = `{ connected: true, provider }`. No third state, no fakes.
- `backend/src/routes/admin.ts` — NEW endpoints `GET /api/admin/fleet/feed` and `GET /api/admin/fleet/drivers/:driverId`. Feed assembles drivers across every `DriverStatus` bucket; drawer joins User row for IDV + email/phone and looks up the current load when assigned. Positions surface with `source: 'driver-app'` (NEVER `'live'` or `'telematics'`); drivers with no coords get `position: null`.
- `backend/tests/unit/iam/fleetFeed.test.ts` — NEW (7/7 pass): no-fabrication invariants, env-gated telematics flag, status bucket counts, drawer 404, drawer joins IDV/load.
- `frontend-v2/src/lib/api.ts` — added `adminFleetFeed()` + `adminFleetDriver()`.
- `frontend-v2/src/components/admin/FleetFeed.tsx` — NEW. Driver table grouped by status with colour buckets, status pills, row click opens drawer. Top banner shows live-tracking pill: "Live tracking · samsara" when connected, "Live tracking not connected" + explanatory caption otherwise. Drivers without coords render "No location yet" in muted text.
- `frontend-v2/src/components/admin/FleetFeed.tsx` (DriverDrawer) — right-side dialog showing profile, IDV badge, last-known position (with explicit "not a telematics fix" note when applicable), current load, and disabled Flag / Open ticket quick actions (placeholders pending Phase 3 inbox).
- `frontend-v2/src/pages/admin/AdminDashboard.tsx` — mounted FleetFeed above the OrgManagementPanel.

**Acceptance / proof (all green):**
- 7/7 fleet-feed tests pass. The two no-fabrication assertions ("no coords → position null" and "real coords → source NEVER claims telematics") are explicit.
- `TELEMATICS_PROVIDER` unset → `liveTracking.connected = false`; UI shows the "not connected" pill and the muted explanatory caption.
- Drawer joins IDV (from User row), email/phone, current load (when assigned), and gracefully shows "No location reported yet" when the driver has no heartbeat.
- Admin bundle now 485 KB / 150 KB gzipped.

## Phase 3 — Email support inbox
**Status:** NOT STARTED → next on resume.
**Next step on resume:** add Resend Inbound receiving domain config; create `LoadLead_SupportTickets` + `LoadLead_SupportMessages` DynamoDB tables; implement `POST /api/support/inbound` webhook with Resend signature verification + idempotency on `email_id`; threading via Message-ID/In-Reply-To/References (and a `support+<ticketId>@` token); ticket list + detail UI in the admin bundle with assign/status/reply composer that sends via Resend; SLA policy stored on a `support_settings` row, configurable by STAFF_ADMIN, computed on read.

## Phase 4 — Chat + phone embeds
**Status:** NOT STARTED
**Next step on resume:** support adapter (interface), env-driven vendor wiring, unconfigured "not connected" state.

## Phase 5 — Independence + a11y
**Status:** NOT STARTED
**Next step on resume:** grep for shared parameterized containers; axe-core run; WCAG AA fixes.
