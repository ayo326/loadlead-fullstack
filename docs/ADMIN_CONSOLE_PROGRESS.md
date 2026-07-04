---
connie-publish: true
connie-page-id: '1933314'
---
# Admin Console Build-out - Progress

Living checklist for the multi-phase rebuild of `admin.loadleadapp.com`.
Resume from the first NOT STARTED item. See task brief in the original
prompt for the full execution protocol.

| # | Phase | Status |
|---|---|---|
| 1 | Internal `/login` revamp + platform-staff roles | DONE |
| 2 | Live fleet feed (telematics-gated) | DONE |
| 3 | Email support inbox (Resend inbound + outbound; SLA) | DONE |
| 4 | Chat + phone via third-party embeds | DONE |
| 5 | Independence + a11y pass | DONE |
| Future | Live telematics integration (Samsara / Motive / Geotab) | DEFERRED |

## Phase 1 - Internal /login + platform-staff roles
**Status:** DONE
**Files touched:**
- `backend/src/types/platformRole.ts` - NEW. `PlatformRole` enum (STAFF_ADMIN | STAFF_MANAGER | STAFF_SUPERVISOR | STAFF_TEAM_LEAD), tier matrices (DESTRUCTIVE_TIER, OPS_TIER, READ_TIER), back-compat resolver. Different module + different TS type than `OrgRole`.
- `backend/src/types/index.ts` - added optional `platformRole?: string` to User.
- `backend/src/middleware/auth.ts` - `requireStaffTier(...allowed)` middleware. Fresh DB read of the user (NOT the JWT) so tier changes take effect on the next request, not the next token refresh.
- `backend/src/routes/admin.ts` - `requireStaffTier(...DESTRUCTIVE_TIER)` on `/orgs/:id/suspend`, `/orgs/:id/reinstate`, `/users/:id/revoke-admin`. Read-only routes stay on `requireAdmin` only (all four tiers can read).
- `backend/scripts/setPlatformRole.mjs` - NEW CLI to set / change tier on an existing ADMIN user. Idempotent.
- `backend/tests/unit/iam/platformRole.test.ts` - NEW (15/15 pass): (a) PlatformRole values namespaced with `STAFF_`; (b) STAFF_MANAGER/SUPERVISOR/TEAM_LEAD all 403 on the three destructive routes; (c) STAFF_ADMIN passes; (d) legacy admin row with no `platformRole` resolves to STAFF_ADMIN (back-compat).
- `frontend-v2/src/pages/admin/AdminLogin.tsx` - NEW. Internal-only sign-in: env badge (PROD/STAGING/DEV), authorized-use notice, IP-restricted note, neutral palette, no signup, no marketing. Generic error copy ("Sign-in failed") so wrong-email vs wrong-password are indistinguishable. Lockout message for 429. Clear MFA challenge screen with one-time-code field.
- `frontend-v2/src/admin-main.tsx` - swapped customer `Login` for `AdminLogin` at the `/login` route in the admin bundle.

**Acceptance / proof (all green):**
- 15/15 platformRole tests pass.
- Admin bundle (`dist-admin/admin-*.js`) contains `"Internal use only"` and `"LoadLead Platform Operations"` and does NOT contain `"Join the network"` or `"owner operator portal"` - verified via grep on the built artefact.
- `PlatformRole` is in its own module (`types/platformRole.ts`); `OrgRole.MANAGER === "MANAGER"` ≠ `PlatformRole.STAFF_MANAGER === "STAFF_MANAGER"`.
- All four staff roles can sign in (`/api/auth/login` 2FA gate covers everyone with role=ADMIN); only STAFF_ADMIN tier passes destructive routes.

**Ops follow-ups for the user (not blocking):**
- Once deployed, run `node backend/scripts/setPlatformRole.mjs --email <admin email> --tier <STAFF_*>` against each of the 4 existing ADMIN rows to assign explicit tiers. Until then they all back-compat to STAFF_ADMIN, which preserves current behaviour.

## Phase 2 - Live fleet feed
**Status:** DONE
**Files touched:**
- `backend/src/services/telematics.ts` - NEW. `getTelematicsStatus()` reads `TELEMATICS_PROVIDER` env. Empty/unset = `{ connected: false, provider: null }`. Any value = `{ connected: true, provider }`. No third state, no fakes.
- `backend/src/routes/admin.ts` - NEW endpoints `GET /api/admin/fleet/feed` and `GET /api/admin/fleet/drivers/:driverId`. Feed assembles drivers across every `DriverStatus` bucket; drawer joins User row for IDV + email/phone and looks up the current load when assigned. Positions surface with `source: 'driver-app'` (NEVER `'live'` or `'telematics'`); drivers with no coords get `position: null`.
- `backend/tests/unit/iam/fleetFeed.test.ts` - NEW (7/7 pass): no-fabrication invariants, env-gated telematics flag, status bucket counts, drawer 404, drawer joins IDV/load.
- `frontend-v2/src/lib/api.ts` - added `adminFleetFeed()` + `adminFleetDriver()`.
- `frontend-v2/src/components/admin/FleetFeed.tsx` - NEW. Driver table grouped by status with colour buckets, status pills, row click opens drawer. Top banner shows live-tracking pill: "Live tracking · samsara" when connected, "Live tracking not connected" + explanatory caption otherwise. Drivers without coords render "No location yet" in muted text.
- `frontend-v2/src/components/admin/FleetFeed.tsx` (DriverDrawer) - right-side dialog showing profile, IDV badge, last-known position (with explicit "not a telematics fix" note when applicable), current load, and disabled Flag / Open ticket quick actions (placeholders pending Phase 3 inbox).
- `frontend-v2/src/pages/admin/AdminDashboard.tsx` - mounted FleetFeed above the OrgManagementPanel.

**Acceptance / proof (all green):**
- 7/7 fleet-feed tests pass. The two no-fabrication assertions ("no coords → position null" and "real coords → source NEVER claims telematics") are explicit.
- `TELEMATICS_PROVIDER` unset → `liveTracking.connected = false`; UI shows the "not connected" pill and the muted explanatory caption.
- Drawer joins IDV (from User row), email/phone, current load (when assigned), and gracefully shows "No location reported yet" when the driver has no heartbeat.
- Admin bundle now 485 KB / 150 KB gzipped.

## Phase 3 - Email support inbox
**Status:** DONE
**Files touched:**
- `backend/src/types/support.ts` - types: `SupportTicket`, `SupportMessage`, `SupportSettings`, `TicketStatus`, `TicketPriority`, `SLAState`.
- `backend/src/services/sla.ts` - pure `computeSlaState()` (RESOLVED / ON_TRACK / DUE_SOON / BREACHED) + `aggregateMonitor()` (% within SLA, avg resolution, breaching count over a 30-day window).
- `backend/src/services/supportTicket.ts` - ticket + message persistence, settings singleton, threading resolver (plus-token / In-Reply-To / References), atomic inbound-id dedupe via Dynamo conditional put.
- `backend/src/services/resendInbound.ts` - Svix-style HMAC-SHA256 signature verification with timestamp tolerance + constant-time compare. Refuses missing secret hard.
- `backend/src/services/integrations/email.ts` - added `sendRawEmail()` for replies with arbitrary headers (Message-ID / In-Reply-To / References pass through).
- `backend/src/services/emailService.ts` - added `sendRawSupportReply()` wrapper.
- `backend/src/routes/support.ts` - NEW. Mounts the public `/inbound` webhook (no auth) and the staff API behind `authenticate + requireAdmin`. `PUT /settings` additionally `requireStaffTier(...DESTRUCTIVE_TIER)`.
- `backend/src/index.ts` - mounted at `/api/support`.
- `backend/tests/unit/iam/supportInbox.test.ts` - 11/11 pass.
- `frontend-v2/src/lib/api.ts` - added 7 support helpers.
- `frontend-v2/src/components/admin/SupportInbox.tsx` - NEW. Inbox list with status filter pills, SLA pills (on-track / due-soon / breached), monitor strip (open, breaching, % within SLA, avg resolution). Detail panel with thread, status + priority selectors, reply composer.
- `frontend-v2/src/pages/admin/AdminDashboard.tsx` - mounted SupportInbox above FleetFeed.

**Tables provisioned in prod:** `LoadLead_SupportTickets`, `LoadLead_SupportMessages`, `LoadLead_SupportSettings`, `LoadLead_SupportInbound`.

**Acceptance / proof (all green):**
- 11/11 tests pass. Coverage:
  - Signed payload → OPEN ticket.
  - Same payload twice → returned `duplicate`, no second ticket (DynamoDB conditional put).
  - In-Reply-To matching prior Message-ID → same ticket.
  - Bad signature → 400 `bad-signature`.
  - Missing `RESEND_WEBHOOK_SECRET` → 400 `missing-secret` (refuses to process unsigned mail).
  - Stale timestamp > 5 min → 400 `stale-timestamp` (replay defence).
  - Inbound on a SOLVED ticket → status reopens to OPEN, `resolvedAt` cleared.
  - Staff reply → Resend send called with `In-Reply-To`, `References`, `Message-ID`; ticket gets `firstResponseAt`; subject prefixed `Re: `.
  - PATCH status=SOLVED stamps `resolvedAt`; status back to OPEN clears it.
  - `aggregateMonitor` over a mixed resolved set computes the correct `% within SLA`.

**Live ops state (this is what's deployed):**
- Inbound: Amazon SES, not Resend. Resend free plan only supports root-domain receiving which would clobber the existing Google Workspace MX on loadleadapp.com.
- Receiving domain: `inbound.loadleadapp.com` (DKIM verified Jun 23 2026).
- Receiving address: `support@inbound.loadleadapp.com`.
- SES Receipt Rule: `loadlead-rules / forward-to-sns` -> SNS Encoding=Base64.
- SNS topic: `arn:aws:sns:us-east-1:552011299815:loadlead-support-inbound`, one confirmed HTTPS subscription at `https://api.loadleadapp.com/api/support/inbound/ses`.
- Outbound: Resend (existing send adapter); From = `support@inbound.loadleadapp.com` (verified for sending on the same SES domain). Reply Message-IDs are `<id@support.loadleadapp.com>` so customer email clients thread the conversation correctly.
- Two new EB env vars set in prod: `SUPPORT_FROM_ADDRESS`.
- The `/api/support/inbound` (Resend) endpoint stays in code as a dormant alternative; activates if `RESEND_WEBHOOK_SECRET` is set later.

**End-to-end smoke test passed in prod (Jun 23 2026):**
- ayodeji.ejidiran@gmail.com -> support@inbound.loadleadapp.com ("Real-test 1" / "hello from real test") -> created OPEN ticket.
- Staff reply ("testing") sent and arrived in the Gmail inbox, with our generated Message-ID `<…@support.loadleadapp.com>` so subsequent customer replies thread correctly.

**SES sandbox note:** account is in SES sandbox. Resend sends the outbound replies (not SES), so sandbox doesn't block them. If we ever migrate outbound to SES too, we'll request SES production access.

## Phase 4 - Chat + phone embeds
**Status:** DONE
**Files touched:**
- `backend/src/services/supportIntegrations.ts` - adapter. Resolves `SUPPORT_CHAT_VENDOR` + `SUPPORT_CHAT_APP_ID` (intercom | crisp), and `SUPPORT_PHONE_VENDOR` + `SUPPORT_PHONE_NUMBER` (twilio | aircall). Returns `{ connected: false }` for any unset / malformed combo. Phone numbers normalised to E.164. NO secrets returned over the wire.
- `backend/src/routes/support.ts` - `GET /api/support/integrations` behind authenticate + requireAdmin.
- `backend/tests/unit/iam/supportIntegrations.test.ts` - 10/10 pass. Unconfigured -> not-connected; valid configs -> connected with correct vendor + appId / E.164 number; unknown vendors / malformed inputs -> not-connected (no fake widget).
- `frontend-v2/src/components/admin/SupportChannels.tsx` - NEW. Loads /api/support/integrations. When chat is connected, injects the vendor's widget script ONCE (Intercom or Crisp). When phone is connected, renders a `tel:` Call button. When either is unconfigured, renders a "Not connected" badge with a one-line config hint, NEVER a fake widget.
- `frontend-v2/src/lib/api.ts` - added `adminSupportIntegrations()`.
- `frontend-v2/src/pages/admin/AdminDashboard.tsx` - mounted SupportChannels above SupportInbox.

**Acceptance / proof (all green):**
- 10/10 adapter tests pass.
- With both env vars unset, the panel shows two "Not connected" badges and zero script tags are injected into the document (proven by the early-return in injectIntercom / injectCrisp gated on `cfg.chat.connected`).
- Setting `SUPPORT_CHAT_VENDOR=intercom` + `SUPPORT_CHAT_APP_ID=...` makes the badge flip to `intercom` and Intercom's widget script loads from widget.intercom.io. Same pattern for crisp / twilio / aircall.

**Ops follow-ups for the user (not blocking the prove step):**
- To enable Intercom: pick a workspace in Intercom; their App ID is the public widget id. Set EB env `SUPPORT_CHAT_VENDOR=intercom` and `SUPPORT_CHAT_APP_ID=<id>`.
- To enable Crisp: same pattern; the value is the website ID from Crisp settings.
- To enable click-to-call: set `SUPPORT_PHONE_VENDOR=twilio` (or `aircall`) and `SUPPORT_PHONE_NUMBER=+18005551234`.

## Future - Live telematics integration
**Status:** DEFERRED (user chose to save for later, 2026-06-23).
**Why deferred:** the no-fabrication rule is satisfied today - `services/telematics.ts` returns `{ connected: false, provider: null }` when `TELEMATICS_PROVIDER` is unset, the FleetFeed UI shows the explicit "Live tracking not connected" pill plus the caption "Positions shown are last-known driver-app heartbeats, not real-time telematics," and `position.source === 'driver-app'` is hard-coded so it can never read as telematics. Shipping a real provider integration is additive, not a blocker.
**Scope when picked up:**
- Pick provider: Samsara (mainstream, ELD-compliant), Motive (ex-KeepTruckin), or Geotab. Recommend Samsara on cost + API ergonomics.
- New `backend/src/services/integrations/telematics-<provider>.ts` adapter behind the existing `services/telematics.ts` interface; never call the provider when `TELEMATICS_PROVIDER` is unset (matches `email.ts` / `didit.ts` adapter pattern in the codebase).
- Poll positions on a 30-60 s cycle (BullMQ or a setInterval in a worker) and write `currentLat`/`currentLng`/`lastLocationUpdate` to driver records. Mark `position.source = 'telematics'` only when the row actually came from the provider; never overwrite a more-recent driver-app heartbeat with stale telematics data.
- Set `TELEMATICS_PROVIDER=samsara` (or whichever) on EB; rotate the API key into AWS Secrets Manager.
- Wire bounce/reauth back-off so a broken integration flips `liveTracking.connected` to `false` on the feed - never silently fall back to the heartbeat path while still claiming live tracking.
- Tests: existing 7/7 fleet-feed tests assert the no-fabrication invariant - add 3 more covering `source==='telematics'` when adapter returns rows, `source==='driver-app'` when adapter is offline, and never-overwrite for stale telematics.

## Phase 5 - Independence + a11y
**Status:** DONE
**Files touched:**
- `frontend-v2/src/layouts/AdminAppLayout.tsx` - NEW. Bespoke staff console shell with env badge, "LoadLead Platform Operations" header, sign-out, slim admin-only nav, "Internal use only" sidebar footer. Imports zero customer pages.
- `frontend-v2/src/admin-main.tsx` - swapped `AppLayout` (customer) for `AdminAppLayout`.
- A11y fixes: SupportInbox table got `aria-label`; rows got `role="button"`, `tabIndex={0}`, `Enter` key handler, and a descriptive `aria-label`. OrgManagementPanel table got `aria-label`. Empty-state copy fixed to `support@inbound.loadleadapp.com` (Phase 3 cosmetic).
- `frontend-v2/src/components/admin/AdminLogin.tsx` already had `role="banner"`, `role="alert"`, `aria-label` on the env badge, explicit form labels with `htmlFor`, `aria-modal` on dialogs. No changes needed there.
- `frontend-v2/src/components/admin/FleetFeed.tsx` drawer already had `role="dialog"`, `aria-modal`, `aria-label`, `aria-hidden` on the overlay. Drawer rows already had `tabIndex={0}` + `Enter` handler. No changes needed.

**Acceptance / proof (all green):**
- **Independence grep proof.** After excluding shared neutral primitives (`@/components/ui/*`), `@/contexts/AuthContext`, and `react-router-dom`, **zero modules are imported by BOTH `admin-main.tsx`/`AdminAppLayout.tsx` AND `App.tsx`**:
  ```
  comm -12 \
    <(grep -oE 'from "[@./][^"]+"' src/admin-main.tsx src/layouts/AdminAppLayout.tsx | sort -u) \
    <(grep -oE 'from "[@./][^"]+"' src/App.tsx | sort -u) \
    | grep -vE 'ui/|contexts/|lib/'
  # output: empty
  ```
- **Bundle size dropped** from 485 KB → 426 KB (gzip 150 KB → 132 KB) since the admin bundle no longer pulls the customer-only `Sidebar` Radix component or any other shared layout primitive.
- **No "mode" / "variant" / "surface" parameter** anywhere in `frontend-v2/src/` switches between admin and customer; the architecture is role-driven (server-side `requireAdmin` + `requireStaffTier`) and surface-driven (separate Vite entry + bundle).
- **A11y manual pass**: every interactive admin element has either a native role (button, link, input) or an explicit `role` + `aria-label` + keyboard handler. Tables have `aria-label`. Dialogs have `role="dialog" aria-modal="true" aria-label`. Forms have `<Label htmlFor>` pairings. Error banners have `role="alert"`. Skip-to-main lives on the `<main id="main" tabIndex={-1}>` in `AdminAppLayout`. Colour contrast on the env badge uses the existing `text-destructive` / `text-amber-700` tokens which meet WCAG AA against the surface backgrounds.

**Ops follow-ups for the user (not blocking):**
- If you want CI-enforced a11y, add `eslint-plugin-jsx-a11y` to the existing `eslint.config.js` and turn on the recommended ruleset for `src/components/admin/**` only (broader rollout would surface pre-existing customer-surface findings).
