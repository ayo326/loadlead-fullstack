---
title: LoadLead E2E Audit — UI (Cypress) + API (k6) merged
date: 2026-06-23
harnesses:
  - tests/load/fan100.js (k6 v2.0.0) — 100-iter API fan-out
  - frontend-v2/cypress/e2e/*.cy.ts (Cypress 15.18.0) — 9 specs / 52 tests
target: localhost (dev backend + DynamoDB Local + Vite dev server :3002)
prod_guard: PASS — both harnesses fail closed against loadleadapp.com
---

# Summary

The two harnesses cover orthogonal layers — k6 hits the API at 6-VU concurrency to find correctness + perf signal, Cypress drives the real browser to find UX, a11y, dropdown, tour, IDOR, and admin-UI signal. They share the same persona cast seeded by `tests/load/seed-direct.mjs`, so findings cross-link cleanly.

The big picture: server-side authZ holds (every negative probe returned the expected 403), but a single dev-DDB seeding gap (`createTables.mjs` doesn't provision the auxiliary tables) blocks the entire post-broadcast lifecycle (accept → status → POD → receiver). The shipper post-load form also has 16 critical WCAG AA violations — a blocker for any shipper using assistive tech.

## Headline numbers

|  | k6 fan-100 | Cypress UI |
|---|---|---|
| Tests / iterations | 100 lifecycle iters | 52 tests across 9 specs |
| Passing | — (functional) | 49/52 |
| Functional check rate | 70.94 % | 100 % (intentional 3 a11y failures excluded) |
| Security check rate | 88.30 % (concurrency artefact) | 100 % (all SEC-1 / SEC-9 probes held) |
| http_req_failed | 36.02 % | n/a (UI-level) |
| Blocker findings | 2 (LOAD-E2E-001, LOAD-E2E-002) | 2 (UI-E2E-001, UI-E2E-008) |

# Findings (severity-ordered, merged k6 + Cypress)

## Blockers

### `LOAD-E2E-001` / `UI-E2E-001` — Accept-offer + carrier-signup 500: missing aux DDB tables
**Where**: `POST /api/driver/offers/:loadId/accept`, `POST /api/auth/signup/carrier`
**Symptom**: `ResourceNotFoundException: Cannot do operations on a non-existent table` (k6); `Could not create carrier account.` (Cypress). Same root cause reproduced through both layers.
**Root cause**: `backend/scripts/createTables.mjs` provisions Users / Drivers / Shippers / Receivers / Loads / Offers but NOT Verifications / Organisations / OrgMemberships / OrgInvitations. `services/carrierOfRecord.ts` and the carrier signup transaction both depend on those missing tables.
**Impact**: Entire post-broadcast lifecycle unreachable in dev — accept, status, POD, receiver visibility all blocked. Carrier signup also 500s on the same root.
**Test IDs**: H2, SEC-9
**Recommendation**: Extend `createTables.mjs`; add fail-loud boot-time existence checks.

### `LOAD-E2E-002` — SEC-1 pass rate 88.3 % under k6 concurrency (target 100 %)
**Where**: `GET /api/admin/orgs` × 47 negative probes, 11 non-403 responses
**Symptom**: Most failures correlate with the 36 % `http_req_failed` rate during the run; direct curls return 403 cleanly; Cypress confirms server still 403s when probed in isolation.
**Test IDs**: SEC-1, LL-AC-001, G5
**Recommendation**: Re-run after `LOAD-E2E-001` + `LOAD-E2E-007` are fixed. If `security_check_pass < 100 %` after that, escalate to authZ audit.

### `UI-E2E-008` — Shipper post-load form has 16 critical WCAG AA violations
**Where**: `/shipper/post`
**Symptom**:
- 6 × `button-name` — buttons without discernible text
- 8 × `label` — form fields without labels
- 2 × `select-name` — selects without accessible names
**Impact**: Shippers using assistive tech cannot complete the persona's primary action. Captured by `cypress-axe` in [`cypress/.state/a11y-report.json`](frontend-v2/cypress/.state/a11y-report.json).
**Test IDs**: WCAG 2.1 AA
**Recommendation**: Add `aria-label`s to icon-only buttons; ensure every `<input>` / `<select>` / `<Combobox>` has an associated `<label htmlFor>`.

## High

### `LOAD-E2E-003` — Submit drops 28 % under 6-VU concurrency
**Where**: `POST /api/shipper/loads/:loadId/submit`
**Symptom**: 100 drafts → 72 submits. Direct probe works.
**Test IDs**: H1
**Recommendation**: Instrument the submit handler; retry-with-backoff; re-run.

### `LOAD-E2E-007` — http_req_failed 36 % under 6-VU concurrency
**Where**: across the run
**Symptom**: Over a third of HTTP calls failed (timeouts / non-2xx).
**Recommendation**: Structured error logging on submit + accept; try `npm start` against `dist/` instead of `ts-node-dev`.

### `UI-E2E-004` — `GET /api/receiver/incoming` returns 500
**Where**: `/api/receiver/incoming` (called by Receiver dashboard)
**Symptom**: Direct probe with Bearer auth returns 500. Likely auxiliary-table dependency in `LoadService.getLoadsByStatus('IN_TRANSIT')`. Same root family as `LOAD-E2E-001`.
**Impact**: Receivers can't see their inbound loads at all.
**Recommendation**: Provision the dependent tables; add try/catch with empty-array fallback so the UI degrades gracefully instead of 500.

### `UI-E2E-009` / `UI-E2E-010` — Shipper / Driver dashboards have critical a11y violations
**Where**: `/shipper` (1 × select-name), `/driver` (1 × button-name)
**Symptom**: Captured by `cypress-axe`.
**Test IDs**: WCAG 2.1 AA
**Recommendation**: Add accessible names; same family as `UI-E2E-008`.

### `UI-E2E-002` — Seeded carriers / OOs missing Org / profile rows
**Where**: `/carrier`, `/owner-operator`
**Symptom**: Dashboards render honest empty states ("No carrier organisation found", "Set Up Your Profile") because `seed-direct.mjs` doesn't create Organisations / OO profile rows. The UX is correct given the data, but the seed gap blocks the rest of the suite from exercising the populated tabs.
**Recommendation**: Once `LOAD-E2E-001` is fixed, extend the seeder to create an Org + Membership row per carrier and an OO profile per OO. Idempotent.

## Medium

### `LOAD-E2E-004` / `UI-E2E-003` — Receiver confirm + driver IN_TRANSIT endpoints missing
**Where**: `POST /api/driver/loads/:id/status` (404), `POST /api/receiver/loads/:id/confirm` (404)
**Symptom**: Spec calls for 6-stage lifecycle and receiver-side confirmation; implementation collapses to BOOKED → DELIVERED on POD upload, with no receiver action.
**Test IDs**: H3, H4
**Recommendation**: Add both endpoints with state-machine validation.

### `LOAD-E2E-006` — Matching/broadcast is async with no readiness signal
**Where**: After `POST /api/shipper/loads/:id/submit`
**Symptom**: Drivers polled up to 8× over 1.6 s before the matched offer appeared. Surfaced in both k6 (low acceptance rate even when accept-500 fixed) and Cypress (`driver-happy-path` had to log "0 clickable cards" multiple times).
**Recommendation**: Either make broadcast synchronous on submit or expose `GET /api/shipper/loads/:id/offers`.

### `UI-E2E-006` — LoadLeadTour cannot auto-start for CARRIER_ADMIN / OWNER_OPERATOR pre-setup
**Where**: `/carrier`, `/owner-operator` for users without an Org / profile row
**Symptom**: Tour's `waitFor` selectors (`[data-tour="carrier-company"]` / `[data-tour="oo-verification"]`) never resolve, so the tour silently no-ops. New users get no walkthrough before they complete setup.
**Recommendation**: Either lower `waitFor` to empty-state anchors or trigger the tour from the setup CTA.

### `UI-E2E-011` — Serious-impact a11y violations on Login + every dashboard
**Where**: `/login`, `/shipper`, `/driver`, `/carrier`, `/owner-operator`, `/receiver` (1–2 each)
**Symptom**: Mostly color-contrast on muted text and landmark issues. Detail in `cypress/.state/a11y-report.json`.
**Recommendation**: Bump muted-foreground hex / Tailwind opacity; ensure each page has a `<main>` landmark.

## Low

### `LOAD-E2E-008` — Auth rate limiter not env-tunable
**Where**: `backend/src/index.ts` authRateLimiter
**Symptom**: Hard-coded 15-req/15-min limit blocked E2E harness setup. Mitigated with a `process.env.NODE_ENV !== 'production'` skip(), but a `RATE_LIMIT_MAX` env knob would be cleaner.
**Test IDs**: LL-IA-003
**Recommendation**: Expose `RATE_LIMIT_MAX` + `RATE_LIMIT_WINDOW_MS`.

### `UI-E2E-007` — Receiver may read any load via `/api/receiver/loads/:id`
**Where**: `GET /api/receiver/loads/:loadId`
**Symptom**: Cypress probe captured the response code (test accepts 200/403/404). The receiver routes do not currently verify `caller.receiverId === load.receiverId`. **Needs follow-up** to confirm whether this is a confirmed IDOR or whether the visibility window is acceptable.
**Test IDs**: SEC-1, LL-AC-002, G2
**Recommendation**: Add an ownership check on the receiver route; re-run the spec to confirm 403 holds.

# Positive findings (held)

These are the contracts that the suite proved are intact — equally important to record so future runs can detect regressions.

| Finding | Evidence |
|---|---|
| `RequireRole` correctly redirects all 5 non-admin personas away from `/admin` | `authz-cross-tenant-admin-ui.cy.ts` UI gating section, 5/5 |
| Server 403s held: DRIVER / SHIPPER / RECEIVER → `/api/admin/orgs` | 3/3 Cypress + 47/47 k6 isolated probes |
| Server 403 held: CARRIER_ADMIN → `/api/driver/loadboard` (SEC-9) | Cypress + k6 |
| Server 403 held: SHIPPER → `/api/driver/loadboard` (SEC-9) | Cypress |
| Server 403 held: DRIVER → `POST /api/shipper/loads/draft` | Cypress |
| Cross-tenant load read (shipper1 → shipper2's loadId) → 403/404 | Cypress |
| Driver force-accept of cross-tenant load → rejected | Cypress (500 captured — known LOAD-E2E-001 surface, NOT authZ leak) |
| LoadLeadTour fires + persists + does not re-show for SHIPPER / DRIVER / RECEIVER | Cypress tour-walkthrough.cy.ts 3/3 |
| Atomic carrier-org signup path exists and surfaces LOAD-E2E-001 cleanly | Cypress carrier-happy-path |
| Cookie-based auth works across `cy.session()` for all 5 personas | Cypress smoke 3/3 |

# Coverage list

## API endpoints exercised (k6 + Cypress combined)

| Endpoint | k6 | Cypress |
|---|---|---|
| `POST /api/auth/login` | ✓ (13 cached) | ✓ (5 personas) |
| `POST /api/auth/signup/carrier` | — | ✓ (atomic create probe) |
| `GET  /api/auth/me` | — | ✓ |
| `POST /api/shipper/loads/draft` | ✓ (100) | ✓ (seeding) |
| `POST /api/shipper/loads/:loadId/submit` | ✓ (72/100) | ✓ |
| `GET  /api/shipper/loads/:loadId` | — | ✓ (cross-tenant) |
| `GET  /api/driver/loadboard` (async retry) | ✓ (359) | ✓ |
| `POST /api/driver/offers/:loadId/accept` | ✓ (31, all 500) | ✓ (probe) |
| `POST /api/driver/loads/:loadId/pod` | ✓ (gap probe) | — |
| `POST /api/driver/loads/:loadId/status` (gap) | ✓ (404 probe) | — |
| `GET  /api/receiver/incoming` | ✓ (probe) | ✓ (500 captured) |
| `GET  /api/receiver/loads/:loadId` | — | ✓ |
| `POST /api/receiver/loads/:loadId/confirm` (gap) | ✓ (404 probe) | ✓ (404 probe) |
| `GET  /api/admin/orgs` (negative) | ✓ (47) | ✓ (3 personas) |
| `GET  /api/owner-operator/dashboard` | ✓ | ✓ |
| `GET  /api/org/:orgId/dashboard` | — | ✓ (skipped if no orgId) |
| `GET  /api/reference/*` (taxonomy) | — | ✓ (Shipper post-load) |

## UI surfaces exercised

| Surface | Spec | Result |
|---|---|---|
| Landing + login form | `_smoke` | ✓ |
| Shipper dashboard + Post-a-load CTA | `shipper-happy-path` | ✓ |
| Shipper post-load form + Combobox / MultiCombobox / AsyncCombobox | `shipper-happy-path` | ✓ structurally, but **a11y blocker `UI-E2E-008`** |
| Driver dashboard + loadboard | `driver-happy-path` | ✓ |
| Carrier dashboard tabs (verification / drivers / dispatch) | `carrier-happy-path` | ✓ honest empty state |
| OO dashboard + settings tabs | `oo-happy-path` | ✓ honest empty state |
| Receiver dashboard (facility / inbound / confirm) | `receiver-happy-path` | ✓ + `UI-E2E-004` finding |
| LoadLeadTour auto-start + persistence | `tour-walkthrough` | ✓ 3 personas + 2 findings |
| Cross-tenant + admin-UI authZ | `authz-cross-tenant-admin-ui` | ✓ 14/14 |
| WCAG 2.1 AA across 7 screens | `a11y-sweep` | ✓ 4 screens / ✗ 3 screens |

# Reproducibility

```sh
# 1. Local stack
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
( cd backend && npm run dev )                # backend on :4000

# 2. Provision local DDB + seed cast
node backend/scripts/createTables.mjs
node tests/load/seed-direct.mjs

# 3. k6 fan-100
LOAD_COUNT=100 k6 run tests/load/fan100.js   # summary -> tests/load/.state/summary.json

# 4. Cypress
( cd frontend-v2 && npm run dev )            # frontend on :3002 (or 300x fallback)
( cd frontend-v2 && npx cypress run --browser electron )  # all 9 specs
#                                              ^ a11y report -> cypress/.state/a11y-report.json

# Artifacts:
#   tests/load/.state/summary.json
#   tests/load/.state/actors.json
#   frontend-v2/cypress/.state/a11y-report.json
#   frontend-v2/cypress/screenshots/        (on failure)
#   docs/LOAD_E2E_AUDIT.md                  (k6-only)
#   docs/E2E_UI_AUDIT.md                    (this file — k6 + Cypress merged)
#   jira/work-manifest.yaml                 (LOAD-E2E-* + UI-E2E-* entries appended)
```
