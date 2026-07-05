---
connie-title: Operations - LoadLead IAM Runbook
connie-publish: true
connie-page-id: '1998851'
---

# LoadLead IAM Ops Runbook

> Two-level IAM per `LoadLead_Admin_Carrier_IAM_Spec.md`. This document covers
> what's shipped, what still needs ops/infra work, and how to deploy each piece.

## What's shipped on `feat/admin-bootstrap-lockdown`

| Layer | Status |
|---|---|
| OrgRole rename `ORG_ADMIN` -> `MANAGER` + back-compat read | ✅ |
| Permissions matrix module + 14 unit tests | ✅ |
| Platform ADMIN vs CARRIER_ADMIN exact-match (Part A audit) | ✅ |
| Public admin bootstrap form removed | ✅ |
| `/api/setup/*` env-gated + rate-limited + atomic singleton + audit | ✅ |
| Concurrency race test (`bootstrap.race.test.ts`) | ✅ |
| Bootstrap CLI (`backend/scripts/bootstrapAdmin.mjs`) | ✅ |
| Persona cards = exactly 5 (no ADMIN) | ✅ |
| Outstanding-work audit (`docs/AUDIT.md` + JSON) | ✅ |

**Server-side security enforcement is in place.** The remaining items below
are additive: more endpoints, more UI, MFA, separate subdomain. None of them
weaken what's already shipped.

## What still needs work (next branch)

### IAM-3: Invite + accept flow
**Backend:**
- `POST /api/org/:orgId/invites` body `{ email, role }` -> creates `Invitation { token, role, expiresAt }` in a new `LoadLead_Invitations` table; gated by `hasPermission(membership.role, 'members:invite')` (only OWNER + MANAGER pass).
- `GET /api/org/invites/:token` -> returns invite metadata for the AcceptInvite page.
- `POST /api/org/invites/:token/accept` -> creates `Membership(role=invite.role)`, burns the token, idempotent on repeat acceptance.
- Email delivery: integrate Resend's API per the existing `emailService` adapter. Stub in dev outputs to the captureStore (already wired).

**Frontend:**
- The existing `AcceptInvite.tsx` is the entrypoint - needs to render role context + accept button.
- New "Members" section on the Carrier dashboard (composite `CarrierMembersPanel`): roster table, invite modal, pending invites list, role change controls, transfer ownership confirmation.

**Permissions to enforce server-side:**
- `members:invite` gated to OWNER + MANAGER.
- `members:promote / remove` likewise.
- `members:transfer_ownership` OWNER only.
- A driver member must complete their own IDV; the inviting user cannot proxy.

### IAM-4: Platform override endpoints
- `GET  /api/admin/orgs?status&limit&cursor` - paginated.
- `POST /api/admin/orgs/:orgId/suspend`  - body `{ reason }` mandatory.
- `POST /api/admin/orgs/:orgId/reinstate` - body `{ reason }` mandatory.
- `POST /api/admin/users/:userId/revoke-admin` - body `{ reason }`; if the user is the SOLE OWNER of an org, **suspend the org's admin functions** rather than orphan it.
- All four under `router.use(requireAdmin)` so they're 403 for CARRIER_ADMIN regardless of origin.
- New `LoadLead_AdminAudit` table records each call with `actorUserId`, `targetOrgId|targetUserId`, `action`, `reason`, `timestamp`.

### IAM-5: ADMIN MFA (TOTP)
- Backend: `POST /api/auth/mfa/enroll` (generates secret, returns QR provisioning URI), `/verify` (commits secret on first successful 6-digit code), `/challenge` (called during login when `user.role === ADMIN`).
- Secret stored as bcrypt'd hash + recovery codes (one-time, 10 codes).
- Login flow: ADMIN sign-in **MUST** present a valid TOTP before the session JWT is issued. Use the existing `twoFactorLogin` plumbing (`AuthContext.tsx` already routes through it for users that have 2FA on).

### IAM-6: Carrier Members UI
- New page `frontend-v2/src/pages/carrier/CarrierMembers.tsx` mounted at `/carrier/members`.
- Composite components, all neutral atoms:
  - `MembersTable` (roster + role badge + IDV state for drivers + actions cluster)
  - `InviteMemberDialog` (email + role select with a "what this role can do" hint per matrix)
  - `PendingInvitesList` (token, expiry, resend + revoke)
  - `RoleChangeDialog` (with confirmation + reason)
  - `TransferOwnershipDialog` (OWNER-only, confirm + reason + new-owner email confirmation)
- UI gating is convenience only - see the explicit comment in each handler that the real enforcement is server-side.
- Driver IDV state is read-only; **no UI affordance** to mark another driver's IDV complete.

### IAM-7: Platform Admin Org table UI
- Replace the "no orgs / endpoint needed" placeholder in `AdminDashboard.tsx`.
- Use the same neutral atoms: `MembersTable` (re-purposed as `OrgsTable`), `ConfirmWithReasonDialog`.
- Row actions: **Suspend / Reinstate** (both ask for reason); **Revoke admin** on a carrier_admin row (asks for reason).
- Empty / loading / error states everywhere.

### IAM-8: Subdomain + MFA enforcement at the edge
- DNS: create `admin.loadleadapp.com` -> CloudFront distribution serving `frontend-v2/dist-admin/` (separate build target).
- Frontend build: add `npm run build:admin` that emits the admin-only console (just the admin route + auth flow), excluding the customer surfaces.
- WAF: attach an IP-allowlist rule (your team CIDRs + corporate VPN) to the admin distribution. Customer surface unaffected.
- CORS: `app.use('/api/admin', cors({ origin: 'https://admin.loadleadapp.com', credentials: true }))` - only the admin origin can call it.
- Session cookie domain: when issuing a session for an ADMIN user, set cookie domain to `admin.loadleadapp.com` so the customer domain never sees it.

> The subdomain is **defense in depth**. The server-side `requireAdmin` gate
> on `/api/admin/*` is the real control. Even if someone served the admin
> bundle from the wrong host, every API call would still be 403 without an
> ADMIN token.

## How to deploy what's shipped now

```bash
# Already pushed: feat/admin-bootstrap-lockdown
git checkout main
git pull origin main
git merge feat/admin-bootstrap-lockdown --no-ff
git push origin main

# Backend has real code changes (setup.ts, types, orgPermissions.ts)
DEPLOY_MSG="LL-AC-004 fix: admin bootstrap lockdown + OrgRole MANAGER + matrix" \
  bash deploy-backend.sh

# Frontend changed too (Landing.tsx persona cards)
DEPLOY_MSG="Persona cards exactly 5; admin bootstrap form removed" \
  bash deploy-frontend.sh
```

## Required production env vars

| Var | Where | Value | Notes |
|---|---|---|---|
| `ALLOW_ADMIN_BOOTSTRAP` | Backend EB | **unset** (or `"false"`) | Routes return 404. Bootstrap via CLI only. |
| `DYNAMODB_BOOTSTRAP_AUDIT_TABLE` | Backend EB | `LoadLead_AdminBootstrapAttempts` | Pre-create the table |

## Required DynamoDB tables (pre-create before deploy)

| Table | PK | Use |
|---|---|---|
| `LoadLead_AdminBootstrapAttempts` | `attemptId: S` | Audit trail for every bootstrap attempt |
| `LoadLead_Invitations` *(IAM-3, next branch)* | `token: S` | Org member invites |
| `LoadLead_AdminAudit` *(IAM-4, next branch)* | `auditId: S` | Platform admin override actions |

## First-admin provisioning (canonical path)

```bash
# Anywhere with AWS creds set
node backend/scripts/bootstrapAdmin.mjs \
  --email founder@your-org.com \
  --name  "Founder Name"
# Prompts for password (no -- flag = interactive)
```

The script refuses to run if any ADMIN already exists. The atomic singleton
marker means two concurrent runs cannot both succeed.

## Verifying the security model after deploy

```bash
# (1) Bootstrap route is 404 in prod
curl -i https://api.loadleadapp.com/api/setup/status
# Expect: HTTP/2 404

# (2) /api/admin/* refuses non-ADMIN tokens
TOKEN=$(curl -s -X POST https://api.loadleadapp.com/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"<carrier_admin@..>","password":"…"}' | jq -r .token)
curl -i https://api.loadleadapp.com/api/admin/drivers -H "Authorization: Bearer $TOKEN"
# Expect: HTTP/2 403

# (3) Carrier signup unaffected
curl -i https://api.loadleadapp.com/api/auth/signup/carrier \
  -H 'content-type: application/json' \
  -d '{"email":"new-carrier@test.com","password":"longenough","legalName":"X"}'
# Expect: HTTP/2 200
```
