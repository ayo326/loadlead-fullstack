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
| `compliance` | **Role separation — deliberately deferred (decision 2026-07-01):** `davidejidiran@gmail.com` holds all three compliance roles (DISPUTE_ADMIN + LEGAL_ADMIN + LAW_ENFORCEMENT_LIAISON) by choice while the admin team is one person. Every action is individually audited in the admin audit log, which is the compensating control. Revisit when a second platform admin exists — split via Compliance Console → Grants. |
| `platform` | ~~`terraform import` the CLI-created prod tables~~ **FULLY DONE 2026-07-01**: all 23 imported via OpenTofu (20 module-declared payments/compliance + 3 newly declared beta tables), standard tags applied to all 23, and PITR + deletion protection enabled on the 3 beta tables (BetaApplications holds applicant PII). Final state: 52 table resources in prod TF state; `tofu plan` = "No changes. Your infrastructure matches the configuration." |
| `settlements` | ~~Invoice-package caveats~~ **DONE 2026-07-02** (commit `ddbd3bd`, deployed loadlead-backend-20260702001827): facts now resolved from real records — mover.verified from the Verifications table, debtor.verified = shipper account in good standing (no shipper KYB program exists; documented), withinTerms = 90-day aging from attested delivery, rateConfRef = carrier acceptance else shipper agreement else omitted (synthetic `rateconf:` ref removed). 9-case fact test; payments suite 149/149. |
| `settlements` + `identity` | ~~Factoring `carrierId` resolves owner-operators only~~ **DONE 2026-07-01** (commit `b83919d`, deployed loadlead-backend-20260701233911): `resolveCarrierIdForUser` mirrors carrier-of-record precedence — OO first, then ACTIVE OWNER/MANAGER membership in a CARRIER org; dispatchers/org-drivers/suspended/non-carrier never resolve. 11-case decision-table test. UI DONE 2026-07-02 (commit `b941ab3`, deployed): component promoted to `pages/factoring/FactoringWorkspace.tsx`, mounted at `/carrier/factoring` (CARRIER_ADMIN, nav item added) alongside `/owner-operator/factoring` — fleet-carrier org managers now have the full factoring surface in the UI. |
| `marketplace` | ~~Route-level E2E coverage~~ **DONE 2026-07-02** (commit `2ab21c9`): `factoringRoutes.test.ts` (12 — gating, OO + fleet-org resolution over HTTP, package facts, full export flow) + `complianceMeAndGrants.test.ts` (6 — /me, STAFF_ADMIN-gated grants) join the existing accessorial/compliance route tests. Backend suite 576 tests. Found+fixed en route: export handler still passed a synthetic `rateconf:` to the packet assembler (committed, NOT yet deployed). |
| `platform` | ~~www TLS handshake failure~~ **FIXED 2026-07-02** (commit `3dad608`): added `www.loadleadapp.com` to distribution `E38CZNP7L2DB98` aliases via Terraform (cert already carried the SAN); www now serves 200 over TLS. Also deployed the export rateConfRef fix (loadlead-backend-20260702004208). |

---

## Notes
- The split is domain-driven, so ownership follows a real seam in the code rather than
  cutting across one. If Growth outgrows Marketplace (beta → GA funnels), spin it out as
  a sixth team and add a `growth` slug to the team-map.
- To (re)assign work: edit `jira/team-map.yaml` (`overrides:` for a single issue,
  `epics:` for a whole epic, `family_defaults:` for a family), then re-run
  `python3 jira/sync.py` (dry-run) to preview the new distribution.
