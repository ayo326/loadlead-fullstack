---
title: Team Ownership & RACI
status: active
owner: platform
updated: 2026-07-01
---

# LoadLead — Five Teams

The whole system, grouped by the team that owns it end-to-end (services → routes →
UI → tables → deploy). The machine-readable source of truth is
[`jira/team-map.yaml`](../jira/team-map.yaml); `jira/sync.py` stamps every Jira
issue with a `team-<slug>` label from it. Filter any team's work in Jira with
`labels = "team-<slug>"`.

| Team | Slug | Mission |
|---|---|---|
| Settlements & Financing | `settlements` | Every cent from accrual to payout, correctly and auditably. |
| Trust & Compliance | `compliance` | Oversight without ever mutating the record; append-only, audited, counsel-gated. |
| Identity & Access | `identity` | Who someone is, what they may do, and how they get in. |
| Marketplace & Growth | `marketplace` | The two-sided freight marketplace and its adoption loop. |
| Platform Engineering | `platform` | The ground everything runs on and the tooling to ship safely. |

Current Jira coverage: **211 issues, 100% routed** — identity 95, compliance 49,
platform 34, marketplace 33 (settlements work lands here as new manifest items are
added; use the `overrides:` block in the team-map to route them explicitly).

---

## 1 · Settlements & Financing (`settlements`)
**Owns (code):** `backend/src/services/` — `accessorialPolicyService`, `stopEventService`,
`accessorialCalc`, `accessorialChargeService`, `platformFeeService`,
`factoringAssignmentService`, `payeeRoutingService`, `noticeOfAssignmentService`,
`invoicePackageService`, `funding/`, `fundingAdvanceService`, `reconciliationService`,
`factorContactService`, `factoringPacketService`, `factoringSubmissionService`;
`config/accessorialPolicy.ts`, `config/platformFee.ts`, `utils/money.ts`.
Routes `/api/accessorials`, `/api/factoring`. UI `OwnerOperatorFactoring`, `AccessorialsPanel`.
Script `scripts/seedDetentionCharge.ts`. ~13 payment tables.
**Invariants:** integer cents everywhere; Load model + linehaul take untouched;
append-only ledgers; detention XOR layover; no advance unless charge APPROVED.

## 2 · Trust & Compliance (`compliance`)
**Owns (code):** `complianceRoleService`, `adminAuditService`, `discrepancyDetector`,
`adjudicationService`, `legalHoldService`, `caseFileService`, `lawEnforcementService`,
`payoutInterceptService`, `complianceGather`; `betaTrustEventService`; disclosures &
acknowledgments (both sides). Route `/api/admin/compliance`, middleware
`requireComplianceRole`. UI `ComplianceConsole.tsx`. Security/STIG pipeline
(`compliance/`, `.github/workflows/compliance.yml`). 7 compliance tables.
**Invariants:** oversight only — never mutate/delete an immutable record; audited
(fail-closed); counsel-gated disclosure; legal holds block deletion for everyone.

## 3 · Identity & Access (`identity`)
**Owns (code):** `middleware/auth.ts` (`requireRole`/`requireStaffTier`/`requireAdmin`),
`orgService`, `carrierOfRecord`, staff IAM (`/api/admin/staff`), verification/IDV
(`services/integrations/didit`, `fmcsa`), invitations & accept flows, carrier signup,
MFA (TOTP), permissions matrix, onboarding tours (`tour/`).
**Invariants:** server is the gate (JWT never trusted for tier/role); least privilege;
separation of the platform-staff axis (PlatformRole) from the compliance axis.

## 4 · Marketplace & Growth (`marketplace`)
**Owns (code):** loads/offers/matching, taxonomy + `/api/reference`, load posting,
dispatch dashboards, live tracking maps, POD upload, load history, notifications
(`pushService`, `notificationService`, inbox), lane liquidity, beta program
(`betaAllowlistService`, waitlist, Tally webhook, scoring, `BetaProgramDashboard`,
`/api/admin/beta`), and the design system / glass theme.
**Invariants:** two-sided balance in cohort admits; product E2E/UAT lives here.

## 5 · Platform Engineering (`platform`)
**Owns (code):** `infra/terraform/`, `scripts/createTables.mjs`, `deploy-backend.sh`,
`deploy-frontend.sh`, `deploy-admin-frontend.sh`, `.github/workflows/`, integration
adapters + `modeResolver`/`bootGuard` (prod fail-closed), and the knowledge pipeline
(`docs/`, `jira/`, Confluence publish, Smart Commits).
**Invariants:** prod is APP_ENV-locked and fail-closed; deploys are the only path to
prod; infra is declared (Terraform) — CLI-created tables must be imported.

---

## Shared seams — RACI

The boundaries where two teams must coordinate. **R**esponsible · **A**ccountable ·
**C**onsulted · **I**nformed. (`settlements`=SET, `compliance`=TRC, `identity`=IAM,
`marketplace`=MKT, `platform`=PLT.)

| Seam | SET | TRC | IAM | MKT | PLT |
|---|:--:|:--:|:--:|:--:|:--:|
| Intercept-at-settlement (`reconcileDebtorPayment` → `applyAtSettlement`) | A/R | C | I | — | I |
| Notification suppression under non-disclosure (`PushService.send` → `isEntityRestricted`) | — | C | — | A/R | I |
| Payee = carrier-of-record (`resolveInvoicePayee` → `carrierOfRecord`) | A/R | I | C | — | — |
| New authenticated route / permission gate | R* | C | C | R* | I |
| New DynamoDB table or infra change | C | C | — | C | A/R |
| Production deploy of any change | C | C | C | C | A/R |

\* the feature team building the route is R; Identity is C for the guard.

**Rule of thumb:** if a change touches a seam, the **C** team gets a review before
merge. The three code seams above are real wires in the codebase today, not theory.

---

## Open follow-ups, routed by team

| Team | Follow-up |
|---|---|
| `compliance` | **Separate the three compliance roles across distinct people** before production use — one super-admin (`davidejidiran@gmail.com`) currently holds DISPUTE_ADMIN + LEGAL_ADMIN + LAW_ENFORCEMENT_LIAISON. Use the Compliance Console → Grants tab. |
| `platform` | **`terraform import` the CLI-created prod tables** (13 payments + 7 compliance + `ShipperAgreements`) into prod state so Terraform stops drifting from reality. |
| `settlements` | Replace invoice-package caveats: verification/terms currently assumed true; `rateconf:<loadId>` is a synthetic ref (no rate-confirmation doc yet). |
| `settlements` + `identity` | Factoring `carrierId` resolves owner-operators only — extend payee resolution to fleet-carrier orgs. |
| `marketplace` | Add route-level integration/E2E tests for the payments + compliance routes/UI (service layer has unit coverage; HTTP layer does not). |

---

## Notes
- The split is domain-driven, so ownership follows a real seam in the code rather than
  cutting across one. If Growth outgrows Marketplace (beta → GA funnels), spin it out as
  a sixth team and add a `growth` slug to the team-map.
- To (re)assign work: edit `jira/team-map.yaml` (`overrides:` for a single issue,
  `epics:` for a whole epic, `family_defaults:` for a family), then re-run
  `python3 jira/sync.py` (dry-run) to preview the new distribution.
