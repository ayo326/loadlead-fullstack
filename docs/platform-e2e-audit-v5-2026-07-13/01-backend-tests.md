# Audit v5 — Dimension 01: Backend Test Suite + Build Health

Date: 2026-07-12
Repo: /Users/ayodejiejidiran/loadlead-fullstack
Scope: backend/ (Node/Express/TypeScript, DynamoDB, Elastic Beanstalk)
Auditor dimension: BACKEND TEST SUITE + BUILD HEALTH

---

## SUITE-HEALTH SUMMARY (one line)

**GREEN — 93 test files, 739 tests, 0 failing, 0 skipped, 0 flaky. `tsc --noEmit` clean (0 type errors). No CRITICAL/HIGH/MEDIUM findings; 4 LOW hygiene notes only.**

Proof:
```
 Test Files  93 passed (93)
      Tests  739 passed (739)
   Duration  4.90s (transform 4.27s, import 21.75s, tests 9.23s)
```
- `npm test` exit code: **0**
- Fail/skip/todo/unhandled-rejection marker count in full log: **0**
- `npx tsc -p tsconfig.json --noEmit` exit: **0**, `error TS` line count: **0**
- Hidden `.skip/.only/.todo` in test source: **none**
- Toolchain: node v20.20.0, npm 10.8.2, vitest 4.1.9 (darwin-arm64)

Full logs:
- `audit-v5/test-run.log` (complete vitest output)
- `audit-v5/tsc-run.log` (complete tsc output)

---

## TASK 1 — Test suite run

Command:
```
cd backend && npm test        # = vitest run
```
Result: **all green.** 93/93 files, 739/739 tests passed. Duration ~5s test wall (imports dominate at ~22s across the pool). AWS is mocked throughout (`vi.mock` + in-memory fixtures via `tests/fixtures/factories.ts`); the suite is self-contained and performs **no real AWS/DynamoDB writes**. The `DYNAMODB_ENDPOINT` references in `tests/unit/integrations/bootGuard.test.ts:168-200` are in-test env save/restore, not live connections.

Suite composition (93 files):
- `tests/unit/payments/**` (28 files) — money/cents, negotiation, payee routing, factoring, accessorials, platform fee, reconciliation, invoice package, notice-of-assignment, stop events, pipeline E2E
- `tests/unit/compliance/**` (17 files) — five-state doc machine, W9, COI/LOA, legal records, law-enforcement/intercepts, discrepancy/adjudication, roles/audit
- `tests/unit/canopy/` , `iam/**` (8), `beta/**` (7), `verification/**` (2), `attestation/**` (7), `fleetMute/**` (3), `org/**` (3), `integrations/**` (7), `dashboards/**` (2), plus `security/**` (5) and `reliability/**` (3)

## TASK 2 — Failure root-cause

**No failures.** Nothing to root-cause; no isolation re-runs needed for flakiness (there were zero failures to re-run). Explicitly verified the full log contains zero `FAIL`/`failed`/`✗`/`unhandled`/`rejection` markers.

## TASK 3 — TypeScript build

Command:
```
cd backend && npx tsc -p tsconfig.json --noEmit
```
Result: **clean.** Exit 0, zero `error TS` lines. The only stdout line is a benign `npm warn config ignoring workspace config at backend/.npmrc` (see BE-4). `tsconfig.json` runs with `"strict": true`, so this is a strict-mode-clean type check across `src/**/*.ts`.

## TASK 4 — Coverage of critical paths (targeted, no full coverage run)

Assessed by cross-referencing critical source modules against test imports/assertions rather than a repo-polluting `--coverage` run. All critical paths are exercised:

| Critical path | Source | Test coverage | Verdict |
|---|---|---|---|
| Money/cents — accessorial calc | `services/accessorialCalc.ts` (`computeAccessorial`, `computeAccessorialFromDwell`, `dwellMinutesBetween`) + `accessorialChargeService.ts` (uses `utils/money.assertIntegerCents`) | `accessorialCharge.test.ts` asserts exact `amountCents` across DoD matrix: 0 (sub-free-time), 7500 (3.5h @ std, billableMinutes 90, 15-min round-up), 26250 (HAZMAT), 30000 (2-day layover, no double-bill), caps 15000/5000, idempotency (same chargeId, 1 charge). | STRONG (transitive but thorough) |
| Platform fee | `platformFeeService.ts` | imported by 4 test files | STRONG |
| Payee routing | `payeeRoutingService.ts` | imported by 5 test files (`payeeRouting.test.ts` + payments suite) | STRONG |
| Negotiation | `negotiationService.ts` | 3 test files (`negotiation`, `negotiationDispatch`, `negotiationEsign`) | STRONG |
| Reconciliation | `reconciliationService.ts` | 4 test files | STRONG |
| Compliance five-state machine | `services/compliance/**`, `complianceDocumentService.ts`, `complianceGather.ts` | `complianceDocumentStore.test.ts` (5 imports), route tests mount `adminCompliance` via supertest (`complianceRoutes.test.ts`, `complianceMeAndGrants.test.ts`) exercising `gatherForLoad`/`gatherCaseFileRecords` | STRONG |
| Canopy | `services/canopy/**` (ingestion, mapper, crossReferenceEngine, complianceEvaluator, insuranceBadge, coiService) | `canopy/canopyConnect.test.ts` + `compliance/coiAndLoa.test.ts` (coiService: submitCoi/decideCoi/expireDueCois) | STRONG |

No untested critical module found. (Initial grep flagged `canopy/coiService` as 0-import — false alarm: that file does not exist; the only `coiService.ts` lives under `compliance/` and is tested by `coiAndLoa.test.ts`.)

---

## FINDINGS

### BE-1 — AWS SDK v3 will drop Node 20 support (Jan 2027); repo pinned to node v20.20.0
- Severity: **LOW** (forward-looking maintenance; not currently breaking)
- Evidence: every worker in `test-run.log` emits `NodeVersionSupportWarning: The AWS SDK for JavaScript (v3) versions published after the first week of January 2027 will require node >=22. You are running node v20.20.0.` Confirmed `node -v` = v20.20.0. Package deps pin many `@aws-sdk/*` at `^3.7xx`/`^3.10xx` (backend/package.json:24-31).
- Root cause: runtime pinned to Node 20 while AWS SDK v3 has announced a Node >=22 floor for releases after early Jan 2027. Elastic Beanstalk platform likely still on a Node 20 branch.
- Impact: after ~Jan 2027, any `npm install`/dependency bump that pulls a newer `@aws-sdk/*` on Node 20 may fail to install or emit incompatibilities. ~6-month runway. No impact on current suite/build.
- COA: schedule a Node 22 upgrade (EB platform branch + CI node version + local `.nvmrc`) before Q1 2027; re-run `npm test` + `tsc` on Node 22 to catch any engine-specific breakage. Track as a maintenance ticket, not a blocker.

### BE-2 — No dedicated unit test for `accessorialCalc` pure money functions
- Severity: **LOW** (hygiene; math is already thoroughly asserted transitively)
- Evidence: `ls tests/unit/payments/ | grep -i calc` → none. `grep -rn accessorialCalc tests` → 0 direct imports. The functions are exercised only through `accessorialChargeService` (`accessorialCharge.test.ts`), which does assert exact cents/caps/round-up outcomes (see coverage table).
- Root cause: money math (`computeAccessorial`, `computeAccessorialFromDwell`, `dwellMinutesBetween`, caps/round-up) lives in a pure module but is validated through the service integration test, not a focused unit test.
- Impact: LOW — cents outputs and caps are well-asserted end-to-end. Risk is only that a future edge case (e.g. rounding boundary, cap interaction, negative dwell) added to the pure functions could regress without a focused failing test to localize it.
- COA: add `tests/unit/payments/accessorialCalc.test.ts` covering boundary dwell (exactly free-time, exactly 15-min increments), cap saturation, and layover/detention crossover directly against the pure functions. Optional/nice-to-have.

### BE-3 — Pact contract verification is excluded from `npm test`
- Severity: **LOW** (CI-scope observation)
- Evidence: `vitest.config.ts:7` `include: ['tests/**/*.test.ts']`. The contract file is `tests/contract/verify-provider.ts` (not a `*.test.ts`), so it is never run by `npm test`. `@pact-foundation/pact` + `pact-cli` are devDependencies (package.json:54-55).
- Root cause: provider verification is intentionally a separate runner, but there is no `npm` script wiring it, so it is easy to forget in CI.
- Impact: LOW — consumer/provider contract drift would not be caught by the standard test command. Only matters if a Pact broker flow is expected in CI.
- COA: confirm the Pact provider verification runs in a dedicated CI step; if desired, add a `test:contract` npm script so it is discoverable. No product risk.

### BE-4 — `npm warn config ignoring workspace config at backend/.npmrc`
- Severity: **LOW** (trivial config hygiene)
- Evidence: printed by both `npm test` and `npx tsc` invocations (`tsc-run.log` sole line).
- Root cause: a `backend/.npmrc` sits inside a workspace where npm ignores nested workspace `.npmrc` config in this invocation context.
- Impact: none observed — build and tests pass. Only a risk if that `.npmrc` carried a registry/auth/engine setting expected to take effect.
- COA: verify `backend/.npmrc` contents are not load-bearing (e.g. private registry auth). If they are, hoist to the root `.npmrc` or the workspace-appropriate location; otherwise ignore.

---

## BOTTOM LINE

Backend test + build health is **excellent for round v5**: fully green suite (739/739), strict-mode-clean type check, zero flakiness, and thorough assertion-level coverage on the highest-stakes paths (accessorial cents math with exact-value assertions, negotiation, payee routing, platform fee, reconciliation, compliance state machine, canopy). All four findings are LOW hygiene/maintenance items; none block ship. Highest-value follow-up is BE-1 (Node 22 upgrade before Q1 2027).
