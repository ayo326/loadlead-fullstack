---
connie-title: LoadLead — Beta Gate + Program Acceptance Proofs
connie-publish: true
status: Reconciled
audience: 'reviewer verifying the TASK acceptance list'
---

# Beta Gate + Program — Acceptance Proofs

Every bullet from the TASK acceptance list, mapped to the runnable proof.
All tests live under `backend/tests/` and run with `cd backend && npm test`.

## Test inventory

| Suite | File | Cases |
|---|---|---|
| Gate (Part A) | `tests/security/betaGate.test.ts` | 17 |
| Auto-qualify + scoring (Part B) | `tests/unit/beta/autoQualifyAndScoring.test.ts` | 20 |
| Tally ingest + signature (Part B) | `tests/unit/beta/tallyIngest.test.ts` | 6 |
| Admit round-trip (Part B) | `tests/unit/beta/admitRoundTrip.test.ts` | 4 |
| **Total** | | **47** |

Run: `cd backend && npx vitest run tests/security/betaGate.test.ts tests/unit/beta/`
→ `Test Files 4 passed (4) · Tests 47 passed (47)`.

## Part A acceptance ↔ proof

| TASK bullet | Proof |
|---|---|
| BETA_MODE ON: unauth visitor lands on private-beta page + joins waitlist | FE `PrivateBetaLanding.tsx` → `POST /api/beta/waitlist` (public, idempotent). Server route `routes/beta.ts`. |
| BETA_MODE ON: signup API with NO invite + non-allowlisted email is REJECTED server-side (not UI hiding) | `[GATE-1]` — middleware returns 403 `BETA_REQUIRED` with `next()` never called. Pure server middleware test, no UI in loop. |
| Valid invite (each persona) → signup → betaUser=true, cohort, invitedVia=INVITE | `[GATE-2]` (gate attaches `invitedVia=INVITE`) + `admitRoundTrip` test (full chain → betaContext). `AuthService.signup` stamps the user. |
| Allowlisted domain email self-signs-up (invitedVia=ALLOWLIST) | `[GATE-3]` (DOMAIN) + `[GATE-4]` (EMAIL). |
| Non-allowlisted, non-invited email rejected with neutral message | `[GATE-1]` — same message regardless of email existence (no disclosure sub-test). |
| Existing carrier-org/driver invite flow still works (reused, not duplicated) | `[GATE-9]` — `acceptInvitation` branches on `orgId`; carrier-org path unchanged. Existing `tests/unit/org/` suites untouched + still green. |
| Platform-admin CLI bootstrap works regardless of BETA_MODE | Structural: `bootstrapAdmin.mjs` writes to DDB directly, never hits the gated HTTP routes. `[GATE-6]` proves ADMIN login is never gated. |
| Flipping BETA_MODE OFF opens public signup; betaUser flags persist | `[GATE-8]` — gate is a no-op with zero DB reads when off. Flags live on the user row, unread when off. |

## Part B acceptance ↔ proof

| TASK bullet | Proof |
|---|---|
| Tally submission → BetaApplication (shipper + carrier branches, texasFocus set) | `tallyIngest` — "maps a SHIPPER submission" + "maps a CARRIER submission" (texasFocus MOSTLY/PARTLY asserted). |
| Duplicate (same responseId) does not double-create | `tallyIngest` — "a duplicate responseId returns the existing app without re-creating" (no second `putItem`). |
| Unconfigured form shows "not connected" | `routes/beta.ts` `/tally-webhook` returns 503 `form_not_connected` when `isTallyConnected()` is false. No fabricated apps. |
| Auto-gates: carrier no MC/DOT + shipper <5/wk auto-waitlisted; qualifying → QUALIFIED | `autoQualifyAndScoring` — every hard-gate case incl. boundary (5/wk = QUALIFIED). Carrier-no-MC → DISQUALIFIED. |
| MOSTLY-Texas applicant scores Geography=3 | `autoQualifyAndScoring` — "Geography: MOSTLY=3, PARTLY=2, OUTSIDE=0". |
| Staff scores an applicant; breakdown stored; board reflects status | `autoQualifyAndScoring` — "applyStaffScores merges staff dims + recomputes AUTO dims". Route `PUT /applications/:id/score`. FE score editor. |
| Admitting issues invite via EXISTING flow + allowlists email, tags cohort/wave; applicant signs up betaUser=true | `admitRoundTrip` — "admits a QUALIFIED application by reusing the existing invite flow…". Uses `OrgInvitationService.createSelfSignupInvitation` (the existing service) + `BetaAllowlistService.add`. |
| Cohort balance widget shows live shipper:carrier ratio + seats vs cap | `admitRoundTrip` — "cohort balance reflects an admitted shipper". Route `GET /cohort-balance` with `ratioOutOfBalance` flag. FE `CohortBalanceWidget`. |
| Non-admin/insufficient role → 403 on beta endpoints | `routes/adminBeta.ts` mounts `requireAdmin` on every route (exact-ADMIN). Same gate proven across the admin console. |
| Tally webhook signature-verified + idempotent | `tallyIngest` — signature accept/reject/missing-secret/missing-header + responseId idempotency. |

## Live curl proofs (run against a local backend)

```bash
# Boot with beta on + tables created:
cd backend && BETA_MODE=true npm run dev

# 1. SERVER-SIDE rejection (the headline proof — no UI involved):
curl -i -X POST localhost:4000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"x@nowhere.com","password":"hunter2hunter2","role":"SHIPPER"}'
# → HTTP/1.1 403 Forbidden  {"error":"BETA_REQUIRED",...}

# 2. Tally webhook unconfigured → inert:
curl -i -X POST localhost:4000/api/beta/tally-webhook -d '{}'
# → HTTP/1.1 503  {"error":"form_not_connected"}   (when TALLY_WEBHOOK_SECRET unset)

# 3. Waitlist (public) works:
curl -i -X POST localhost:4000/api/beta/waitlist \
  -H 'Content-Type: application/json' -d '{"email":"hopeful@x.com"}'
# → HTTP/1.1 201  {"ok":true,"waitlistId":"wait_...",...}

# 4. Beta admin endpoint requires ADMIN:
curl -i localhost:4000/api/admin/beta/applications
# → HTTP/1.1 401 (no token)  /  403 (non-ADMIN token)
```

## Guardrails honored

- **Server-side enforcement**: the gate is Express middleware on the auth
  routes, not UI. Proven by middleware-level tests with no UI.
- **One pipeline**: BetaApplication references Invitation + Allowlist +
  Waitlist; admit calls the EXISTING `OrgInvitationService`. No second
  invite mechanism — proven by `admitRoundTrip` asserting `orgId` absent
  (self-signup branch of the same table/flow).
- **Runtime-editable allowlist**: `BetaAllowlistService.add` writes to DDB;
  effective immediately, no deploy. Admin route `POST /allowlist`.
- **CLI bootstrap unaffected**: writes to DDB directly, outside HTTP.
- **Neutral messaging**: same 403 body regardless of email existence.
- **betaUser + cohort + invitedVia** on every beta account: stamped in
  `AuthService.signup` / `signupCarrierAdmin`.
- **No secrets/PII in logs**: webhook logs the verify *reason* and the
  applicant email (staff-authorized), never the signing secret or raw body.
- **Tally signature-verified + idempotent + inert when unconfigured**.
- **Cohort balance is first-class**: headline widget + `/cohort-balance`.
