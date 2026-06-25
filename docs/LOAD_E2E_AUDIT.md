---
title: LoadLead E2E Load + Functional Audit (fan-100)
date: 2026-06-23T00:00:00.000Z
harness: tests/load/fan100.js (k6 v2.0.0)
target: 'http://localhost:4000 (dev backend + DynamoDB Local; sandboxed externals)'
prod_guard: PASS — harness aborts in init if BASE_URL matches api.loadleadapp.com
connie-publish: true
connie-page-id: '2064385'
---

# Summary

Ran 100 full load-lifecycle iterations across 5 personas (Shipper, Carrier_admin, Owner Operator, Driver, Receiver) with equipment variety (dry van, reefer, flatbed, hazmat, oversize) and 4 carrier-of-record paths (org driver, OO self, OO fleet driver, unaffiliated). Shipper-side broadcast works at scale; the **acceptance and lifecycle stages don't complete in dev** because of a missing DynamoDB table that the accept flow's `resolveCarrierOfRecord()` requires. Every threshold was breached; the run is a **blocker** until the table is provisioned and re-run.

## Headline numbers

| Metric | Value | Target |
|---|---|---|
| iterations | 100 | 100 |
| http_reqs total | 669 | — |
| http_req_failed | **36.02%** | < 5% |
| http_req_duration p50 / p95 / max | 8 / 249 / 398 ms | p95 < 2000 ms |
| iteration_duration p95 | 2025 ms | — |
| biz_loads_posted | **72 / 100** | ≥ 95 |
| biz_loads_accepted | **0** | ≥ 80 |
| biz_loads_delivered | **0** | ≥ 70 |
| functional_check_pass | **70.94%** | ≥ 95% |
| security_check_pass | **88.30%** | == 100% |

# Coverage (every component the harness exercised)

| Endpoint group | Calls | Status |
|---|---|---|
| `POST /api/auth/login` | 13 | ✓ exercised (cached per VU via setup()) |
| `POST /api/shipper/loads/draft` | 100 | ✓ exercised; 100% drafted |
| `POST /api/shipper/loads/:loadId/submit` | 72 | ⚠ 28 dropped |
| `GET /api/driver/loadboard` (async-broadcast poll) | 359 | ✓ exercised (8x retry per iter) |
| `POST /api/driver/offers/:loadId/accept` | 31 | ✗ **all failed (500)** — see FIND-001 |
| `POST /api/driver/loads/:loadId/pod` | 0 | ✗ never reached (gated by accept) |
| `GET /api/receiver/incoming` | 0 | ✗ never reached |
| `GET /api/admin/orgs` (negative — driver token) | 47 | ⚠ 36 × 403 + 11 non-403 |
| `GET /api/driver/loadboard` (negative — carrier_admin token) | ~70 | mostly 403 |
| `GET /api/owner-operator/dashboard` | 0 | ✗ never reached |
| `GET /api/org/:orgId/dashboard` | 0 | ✗ org seed didn't include orgId |
| Probe `POST /api/driver/loads/:loadId/status` (IN_TRANSIT) | 1 | ✗ 404 expected — endpoint missing (FIND-004) |
| Probe `POST /api/receiver/loads/:loadId/confirm` | 1 | ✗ 404 expected — endpoint missing (FIND-005) |

# Per-persona breakdown

| Persona | Stage | Calls | Pass | Notes |
|---|---|---|---|---|
| Shipper | draft + submit | 100 + 72 | 72% submit | 28 submits dropped under concurrency |
| Driver  | loadboard poll | 359 | 100% (200 OK) | matching is async; needed avg ~4 retries |
| Driver  | accept | 31 | 0% | every accept threw 500 (FIND-001) |
| Driver  | POD upload | 0 | n/a | blocked behind accept |
| Carrier_admin | loadboard negative probe | 70 | mostly 403 | one IDOR slip suspected; see FIND-002 |
| Owner Op | self-haul accept | 0 | 0% | same accept 500 |
| Receiver | incoming list | 0 | n/a | blocked behind delivery |

# Findings (severity-ordered)

## FIND-001 [BLOCKER, Highest] — Accept-offer 500 on missing DynamoDB table

**Where**: `POST /api/driver/offers/:loadId/accept`
**Symptom**:
```
ResourceNotFoundException: Cannot do operations on a non-existent table
    at AwsJson1_0Protocol.handleError ...
```
**Root cause**: `services/carrierOfRecord.ts` reads `LoadLead_Verifications` (and possibly `LoadLead_OrgMemberships`) via `DYNAMODB_VERIFICATIONS_TABLE`. `backend/scripts/createTables.mjs` only provisions Users, Drivers, Shippers, Receivers, Loads, Offers — the auxiliary tables are missing, so every accept attempt 500s under `requireVerifiedCarrier()`'s carrier-of-record resolution.
**Impact**: Entire post-broadcast lifecycle is unreachable in dev — accept, status, POD, receiver visibility all blocked.
**Test ID**: H2 (cross-persona contract: carrier → driver assignment)
**Recommendation**: Extend `createTables.mjs` to provision Verifications, Organisations, OrgMemberships, OrgInvitations tables (whatever the carrier-of-record + permissions matrix touches). Fail-loud at boot if a referenced table doesn't exist.

## FIND-002 [BLOCKER, Highest] — Security check pass rate 88.3% (target 100%)

**Where**: `GET /api/admin/orgs` with non-admin bearer
**Symptom**: 47 negative probes, only 36 returned 403. 11 returned something else (likely 500/connection error under concurrency, not a 200 auth leak — see FIND-007 on http_req_failed).
**Investigation**: Direct curl probes returned 403 consistently. Failures were tied to the 36% http_req_failed rate during the run — likely the backend crashed mid-probe or returned non-403 transients (timeouts).
**Test ID**: SEC-1 / LL-AC-001
**Recommendation**: Re-run after FIND-001 + FIND-007 are fixed. If 100% holds, this resolves; if not, escalate to authorization audit.

## FIND-003 [HIGH] — Submit drops 28% under 6-VU concurrency

**Where**: `POST /api/shipper/loads/:loadId/submit`
**Symptom**: 100 drafts succeeded, only 72 submits did. Direct probe works.
**Suspected**: Either an idempotency conflict (multiple VUs racing the same shipper's submits), a per-shipper rate limit, or matching/broadcast service crashing on some load shapes (the iteration retried 0 times on submit, unlike loadboard).
**Test ID**: H1 (broadcast contract)
**Recommendation**: Add retry-with-backoff on submit, instrument the submit handler, and re-run.

## FIND-004 [MEDIUM] — Driver IN_TRANSIT status endpoint missing

**Where**: `POST /api/driver/loads/:loadId/status` returns 404
**Symptom**: Spec calls for a 6-stage lifecycle (dispatched → at pickup → picked up → in transit → at delivery → delivered). Implementation collapses to BOOKED (on accept) → DELIVERED (on POD). No driver-facing status transition between them.
**Test ID**: H3
**Recommendation**: Add `POST /api/driver/loads/:loadId/status` with state-machine validation (`BOOKED → IN_TRANSIT → AT_DELIVERY → DELIVERED`).

## FIND-005 [MEDIUM] — Receiver confirm-delivery endpoint missing

**Where**: `POST /api/receiver/loads/:loadId/confirm` returns 404
**Symptom**: Spec calls for receiver-side delivery confirmation. Currently the driver's POD post auto-marks DELIVERED. Receiver has read-only `/api/receiver/incoming`.
**Test ID**: H4 (receiver → POD chain)
**Recommendation**: Add `POST /api/receiver/loads/:loadId/confirm` for receiver-side acknowledgement. Useful for chain-of-custody disputes.

## FIND-006 [MEDIUM] — Matching/broadcast is async with no readiness signal

**Where**: Driver loadboard polling after `submit`
**Symptom**: Drivers had to poll up to 8× over 1.6s before the matched offer appeared. No event or webhook signals broadcast completion.
**Test ID**: H1
**Recommendation**: Either make broadcast synchronous on submit, or expose a `GET /api/shipper/loads/:loadId/offers` so clients can know when matching settled.

## FIND-007 [HIGH] — http_req_failed rate 36% under 6-VU concurrency

**Where**: Across the run
**Symptom**: Over a third of HTTP calls failed. Most were the 31 acceptance 500s + the 28 dropped submits + the 11 non-403 admin probes. Indicates the dev backend is not robust to even modest concurrency.
**Recommendation**: Add structured error logging on submit + accept; investigate whether ts-node-dev was thrashing under 6 VUs (try `npm start` against `dist/`).

## FIND-008 [LOW] — Auth rate limiter not env-tunable

**Where**: `backend/src/index.ts` authRateLimiter
**Symptom**: Hard-coded 15-req/15-min limit. Local E2E setup needed a dev-only `skip()` bypass added to this file as part of harness bring-up. Production limit is good; just needs a `RATE_LIMIT_MAX` env knob.
**Test ID**: LL-IA-003
**Recommendation**: Expose `RATE_LIMIT_MAX` + `RATE_LIMIT_WINDOW_MS` envs; keep current defaults.

# Threshold breaches (all failed)

| Threshold | Configured | Observed |
|---|---|---|
| `biz_loads_posted` count | ≥ 95 | 72 |
| `biz_loads_accepted` count | ≥ 80 | 0 |
| `biz_loads_delivered` count | ≥ 70 | 0 |
| `functional_check_pass` rate | ≥ 0.95 | 0.7094 |
| `security_check_pass` rate | == 1.00 | 0.8830 |
| `http_req_failed` rate | < 0.05 | 0.3602 |

# Reproducibility

```sh
# 1. Local stack
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
( cd backend && npm run dev )

# 2. Provision local DDB + seed cast
node backend/scripts/createTables.mjs
node tests/load/seed-direct.mjs

# 3. Smoke (5 lifecycles, 2 VUs)
STAGE=smoke k6 run tests/load/fan100.js

# 4. Full fan-out (100 lifecycles, 6 VUs)
LOAD_COUNT=100 k6 run tests/load/fan100.js

# Artifacts:
#   tests/load/.state/summary.json   (k6 raw)
#   tests/load/.state/actors.json    (seeded cast for reuse)
#   docs/LOAD_E2E_AUDIT.md           (this file)
#   docs/audit-outstanding-load-e2e.json (Jira manifest entries)
```
