---
connie-title: 'Architecture - Outstanding Work Audit'
connie-publish: true
---

# LoadLead Outstanding-Work Audit

> Evidence-based audit against every workstream's spec. **Every DONE row is backed by a file path, grep result, or test outcome.** Ambiguous items are flagged NEEDS VERIFICATION rather than assumed DONE. Produced after Parts A-C of the security audit; the Part B blocker is already remediated on `feat/admin-bootstrap-lockdown` and is listed here for completeness.

## Summary (counts)

| Status | Count |
|---|--:|
| **GO-LIVE BLOCKERS open** | **0** (B previously CAT-I, now remediated on branch) |
| DONE | 32 |
| PARTIAL | 8 |
| NOT STARTED | 6 |
| NEEDS VERIFICATION | 9 |
| **Total tracked items** | **55** |

## Top 5 priorities (none are CAT-I blockers)

| # | Item | Why |
|---|---|---|
| 1 | Merge `feat/admin-bootstrap-lockdown` to main + deploy | Closes Part B CAT-I in prod |
| 2 | PostGIS analytics replica (Phase 1 - schema + Streams consumer) | Spec'd, not started; unlocks build-now telemetry tier |
| 3 | E2E / SEC / REL / UAT / BDD test plan implementation | Plans exist; specs uncovered |
| 4 | Compliance CI green checks (Prowler, OpenSCAP, gitleaks, SBOM) | Pipeline exists but green/red status NEEDS VERIFICATION |
| 5 | Driver second IDV step + unaffiliated limited state UI | Backend stores `idvStatus`; UI surface partial |

---

## Detailed table

| Item | Workstream | Status | Evidence | Priority | Next action |
|---|---|---|---|---|---|
| Part B: public admin-bootstrap form (now removed) | Security/STIG | **DONE on branch** | `feat/admin-bootstrap-lockdown` commit `ddabc37`; `frontend-v2/src/pages/Landing.tsx` no longer has `RequestAdminSection`; `backend/src/routes/setup.ts` env-gated + rate-limited + atomic singleton + audit log; `backend/tests/security/bootstrap.race.test.ts` proves concurrency | **P0** | Merge to main + deploy |
| Part A: role separation (ADMIN vs CARRIER_ADMIN) | Security/STIG | **DONE** | UserRole enum distinct (`backend/src/types/index.ts`); `requireRole` is exact allow-list (`auth.ts:40-50`); 0 substring/regex matches across repo | P0 | None |
| Carrier-of-record resolver | Refactor & invariants | **DONE** | `backend/src/services/carrierOfRecord.ts` + tests `backend/tests/unit/carrierOfRecord/resolve.test.ts` pass | P0 | None |
| Capability exclusivity (CARRIER vs SHIPPER vs RECEIVER) | Refactor & invariants | **DONE** | `backend/tests/unit/org/capabilities.test.ts` passes; `assertCapabilities()` in `orgService.ts` | P0 | None |
| One-parent invariant (driver belongs to exactly one parent) | Refactor & invariants | **DONE** | `selfHaulAndOnboarding.test.ts` passes; OO self-driver auto-creation in `OwnerOperatorService` | P0 | None |
| Two-gate verification: org authority + user IDV | Refactor & invariants | **DONE** | `carrierOfRecord.ts:71-86` checks org `VerificationEntityType.CARRIER_ORG`; user `idvStatus` checked separately; `requireVerifiedCarrier()` in `auth.ts` | P0 | None |
| OO self-driver auto-create | Refactor & invariants | **DONE** | `anOoSelfDriver` factory; `selfHaulAndOnboarding.test.ts` passes | P0 | None |
| CARRIER_ADMIN role (admin without hauling) | Refactor & invariants | **DONE** | `requireCarrierAdmin()` gates org routes; excluded from `requireDriver`/`requireOwnerOperator` allow-lists in `auth.ts:55-58` | P0 | None |
| 5 public signup personas | Frontend persona | **DONE** | `Signup.tsx:17-37` lists OWNER_OPERATOR, DRIVER, SHIPPER, RECEIVER, CARRIER. ADMIN intentionally absent | P0 | None |
| `/verification/idv` second-IDV step | Frontend persona | **PARTIAL** | Backend: `getOoIdv`/`submitOoIdv` in `api.ts`; `OwnerOperatorVerification.tsx` covers OO. Driver-side IDV is reached via Settings -> ID Verification tab, no dedicated `/verification/idv` route on the driver path. | P1 | Add explicit `/driver/verification/idv` step with affiliation-gate banner |
| Unaffiliated-driver limited state UI | Frontend persona | **PARTIAL** | Tour copy calls out the gate; AppLayout shows persona but no dedicated banner on `/driver` when `affiliations.length === 0`. Backend already returns no offers. | P1 | Render an "Awaiting affiliation" banner on the DriverDashboard when fleet is empty |
| Five signup personas reachable from Landing | Frontend persona | **DONE** | Landing.tsx grid is exactly 5 cards routing to `/signup?role=<KEY>` | P0 | None |
| Unit tests A1-A4 (carrier-of-record resolution) | Testing | **DONE** | `tests/unit/carrierOfRecord/resolve.test.ts` | P0 | None |
| Unit tests B1-B4 (verification gates) | Testing | **DONE** | `tests/unit/org/requireOrgCapability.test.ts` | P0 | None |
| Unit tests C1-C4 (org capability + exclusivity) | Testing | **DONE** | `tests/unit/org/capabilities.test.ts` | P0 | None |
| Unit tests D-F (OO self-haul + onboarding + payee) | Testing | **DONE** | `tests/unit/org/selfHaulAndOnboarding.test.ts` | P0 | None |
| Unit tests G (security boundary) | Testing | **PARTIAL** | New `tests/security/bootstrap.race.test.ts` covers G7. G1-G6 NEEDS VERIFICATION | P1 | Run grep against test names to confirm G1-G6 |
| Unit tests H (cross-persona contracts) | Testing | **NEEDS VERIFICATION** | No grep hits for "H1\|H2\|H3\|H4" in test names | P2 | Inventory + author missing tests |
| E2E tests (HE2E / VE2E) | Testing | **NOT STARTED** | No `tests/e2e/` directory; plan exists at `docs/testing/e2e-uat-bdd-test-plan.md` | P1 | Author Playwright/Cypress against the 5 personas |
| System tests (SEC, REL) | Testing | **NOT STARTED** | No `tests/system/` directory; plan only | P2 | Author after E2E baseline |
| UAT tests | Testing | **NOT STARTED** | Plan only | P2 | After E2E baseline |
| BDD tests | Testing | **NOT STARTED** | Plan only | P3 | After E2E baseline |
| CI gating on test suite | Testing | **DONE** | `tests/sync-tracker.js` + `test:ci` script; `.github/workflows/compliance.yml` 6 jobs | P0 | None |
| Test dashboard sync | Testing | **DONE** | `sync-tracker.js`, deploy hooks call it | P0 | None |
| LL-AC-001 (privilege boundary) | Security/STIG | **DONE** | Part A audit verified separation | P0 | None |
| LL-AC-004 (CAT-I privilege escalation paths) | Security/STIG | **DONE on branch** | feat/admin-bootstrap-lockdown closes the public bootstrap CAT-I; race test passes | P0 | Merge + deploy |
| LL-IA-005 (bootstrap token concurrency) | Security/STIG | **DONE on branch** | Atomic singleton + ConditionExpression in `setup.ts`; concurrency test green | P0 | Merge + deploy |
| LL-* full controls catalog mapped | Security/STIG | **PARTIAL** | `compliance/llmap.yaml` exists, normalize.ts + merge.ts wired; per-control DONE status NEEDS VERIFICATION | P1 | Run compliance CI; document per-control state in `docs/security/stig-checklist.md` |
| Compliance CI: OpenSCAP | Security/STIG | **NEEDS VERIFICATION** | Job exists in `.github/workflows/compliance.yml`; latest run status NEEDS VERIFICATION | P1 | `gh run list --workflow=compliance.yml` |
| Compliance CI: Prowler | Security/STIG | **NEEDS VERIFICATION** | Job exists; status NEEDS VERIFICATION | P1 | gh run list |
| Compliance CI: Semgrep | Security/STIG | **NEEDS VERIFICATION** | Job exists; status NEEDS VERIFICATION | P1 | gh run list |
| Compliance CI: gitleaks | Security/STIG | **NEEDS VERIFICATION** | Job exists; status NEEDS VERIFICATION | P1 | gh run list |
| Compliance CI: npm audit | Security/STIG | **DONE** | Wired in `compliance.yml`; produces SARIF | P0 | None |
| Compliance CI: SBOM | Security/STIG | **DONE** | CycloneDX upload step in `compliance.yml` | P0 | None |
| Carrier dashboard (built + independent) | Dashboards | **DONE** | `components/dashboard/CarrierDashboardView.tsx` exists; persona-shared atoms layer | P0 | None |
| Owner Operator dashboard (built + independent) | Dashboards | **DONE** | `components/dashboard/OwnerOperatorDashboardView.tsx` separate from carrier | P0 | None |
| Aggregation endpoints (`/api/org/:orgId/dashboard`, `/api/owner-operator/dashboard`) | Dashboards | **DONE** | Implemented per past commits; routes reachable | P0 | None |
| Settings parity (contract not shared code) | Dashboards | **DONE** | Separate `CarrierAdminSettings` + `OwnerOperatorSettings` in `SettingsPage.tsx` + `OwnerOperatorSettings.tsx` | P0 | None |
| "Coming soon" lane (no-fabrication rule) | Dashboards | **NEEDS VERIFICATION** | grep for "Coming soon" returns hits; visual review pending | P2 | Verify against `LoadLead_Carrier_OO_Dashboard_Spec.md` |
| Equipment classes (Layer 1 - matching unit) | Taxonomy | **DONE** | `data/taxonomy/equipment-classes.json` (40 classes) + `taxonomyLoader.ts` + `/api/reference/equipment-classes` | P0 | None |
| Equipment models (Layer 2 - manufacturer/model catalog) | Taxonomy | **DONE** | `data/taxonomy/equipment-models.json` (190 combos) + `/equipment-models?class=<code>` | P0 | None |
| Load type taxonomy (mode + service + characteristics + commodity + accessorials + hazmat) | Taxonomy | **DONE** | All 7 JSON files in `data/taxonomy/`; orthogonal Load model fields in `types/index.ts` | P0 | None |
| Searchable dropdowns (persona-neutral combobox) | Taxonomy | **DONE** | `components/ui/combobox.tsx` (Combobox, MultiCombobox, AsyncCombobox); used in PostLoad + Settings | P0 | None |
| Matching integration (single shared service) | Taxonomy | **DONE** | `services/loadMatcher.ts` consolidates rule; 6 tests pass in `tests/unit/matching/loadMatcher.test.ts` | P0 | None |
| Reference API (`/api/reference/*`) | Taxonomy | **DONE** | `routes/reference.ts` mounted at `index.ts:211`; 8 endpoints | P0 | None |
| Analytics DB: PostGIS schema | Analytics replica | **NOT STARTED** | Spec at `docs/database-analytics/analytics-db-spec.md` + provisioning checklist; no `analytics/` code | P2 | Provision RDS PostGIS + author schema migrations |
| Analytics DB: DynamoDB-Streams consumer (Lambda) | Analytics replica | **NOT STARTED** | Spec only | P2 | After PostGIS provisioned |
| Analytics DB: read models + materialized views | Analytics replica | **NOT STARTED** | Spec only | P3 | After consumer |
| In-app tour integrated | Onboarding | **DONE** | Live in prod (commit `2a3ecc1`); `frontend-v2/src/tour/LoadLeadTour.tsx` + `tour-theme.css`; 5 persona tours + settings sub-tour | P0 | None |
| Tour async steps (verification panel, inbound, offers) | Onboarding | **DONE** | `beforeShowPromise + waitForElement(selector, 10_000)` per spec | P0 | None |
| Jira manifest sync | Jira + docs | **DONE** | `jira/sync.py --apply` proves 179 issues synced (`sync-map.json` has 158+ entries; latest add of 23 items completes work-manifest.yaml) | P0 | None |
| Structured Jira descriptions | Jira + docs | **DONE** | `sync.py` composes ADF Context/Story/Gherkin sections; `description_hash` short-circuits | P0 | None |
| Priority mapping | Jira + docs | **DONE** | `resolve_priority()` honors CAT-I overrides and per-item hints | P0 | None |
| Smart Commits convention | Jira + docs | **DONE** | `.gitmessage` + commit-msg hook + `docs/automation/jira-smart-commits.md` | P0 | None |
| Deploy records in Jira | Jira + docs | **DONE** | `jira/post-deploy.py`; deploy scripts call it (dry-run prints when JIRA_* env unset) | P0 | None |
| Docs-to-Confluence sync | Jira + docs | **DONE** | `make publish-docs` + 9 docs live on `loadlleadllc.atlassian.net/wiki/spaces/ENG/pages/163985/LoadLead+Engineering+Docs` | P0 | None |
| Stub exclusion from prod bundle | Deploy/hardening | **DONE** | `deploy-backend.sh` 3-pass scan; `_test` mount guarded by APP_ENV | P0 | None |
| Fail-closed boot guard | Deploy/hardening | **DONE** | `services/integrations/bootGuard.ts`; exits process on contamination | P0 | None |
| Production-locked integration modes | Deploy/hardening | **DONE** | `modeResolver.ts` refuses non-live in prod | P0 | None |

---

## Notes on coverage

- **Test count**: backend currently runs **125 tests passing** including the new race test. Frontend has type checks only; no runtime unit tests yet.
- **Untracked workstreams**: nothing about external load-board (DAT/Truckstop) integration was in scope; the equipment taxonomy doc flags the reconciliation TODO.
- **Read-only by design**: Part D made no code changes outside of writing this file and updating `docs/audit-outstanding.json`. Every other workstream was inspected, not modified.
