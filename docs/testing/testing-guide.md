---
connie-title: Testing - LoadLead Testing Guide
connie-publish: true
connie-page-id: '65935'
---

# LoadLead - Testing Guide

> Rigorous test battery for the LoadLead freight-matching platform.
> Ordered by risk: the areas most likely to cause data leaks, lost loads, or security findings come first.

**Stack under test:** React 18 / Vite frontend (S3 + CloudFront) · Node 20 / Express / TypeScript backend (Elastic Beanstalk) · AWS DynamoDB (us-east-1) · Resend email · Google Maps Routes API · Web Push (VAPID).

**Critical context:** DynamoDB has no row-level security. Every bit of tenant isolation is enforced in the Express handlers. This makes authorization the single highest-risk surface in the application, not a checkbox. There is no LLM or AI layer; matching is rule-based on radius, equipment, CDL class, and MC maturity, so output-quality testing is deterministic and fixture-driven.

---

## Table of Contents

1. [Test Priority](#1-test-priority)
2. [Authorization and Tenant Isolation](#2-authorization-and-tenant-isolation)
3. [Role Guards and RBAC](#3-role-guards-and-rbac)
4. [Admin Bootstrap Flow](#4-admin-bootstrap-flow)
5. [Token Lifecycle](#5-token-lifecycle)
6. [Matching and Broadcast Engine](#6-matching-and-broadcast-engine)
7. [Offer Lifecycle and Concurrency](#7-offer-lifecycle-and-concurrency)
8. [Load State Machine](#8-load-state-machine)
9. [BOL and Digital Signature](#9-bol-and-digital-signature)
10. [GPS Tracking and Privacy](#10-gps-tracking-and-privacy)
11. [DynamoDB-Specific Behaviors](#11-dynamodb-specific-behaviors)
12. [Input Validation and Uploads](#12-input-validation-and-uploads)
13. [Infrastructure and Secrets](#13-infrastructure-and-secrets)
14. [Failure Modes](#14-failure-modes)
15. [Frontend](#15-frontend)
16. [Performance and Scale](#16-performance-and-scale)
17. [Regression and CI Gate](#17-regression-and-ci-gate)

---

## 1. Test Priority

Run these three first. If they are solid, you have covered the failure modes most likely to embarrass you in front of a real broker or a security reviewer.

| Order | Area | Why it matters |
|---|---|---|
| 1 | Authorization matrix (Section 2) | DynamoDB enforces nothing. A missing ownership check exposes every tenant's data. |
| 2 | Double-accept race (Section 7) | Two drivers accepting one load is the most damaging concurrency bug in the system. |
| 3 | Admin bootstrap race (Section 4) | A reusable or race-exploitable setup token means full platform takeover. |

Wire all three into CI as blocking checks (see Section 17).

---

## 2. Authorization and Tenant Isolation

DynamoDB has no RLS. If a handler fetches by `loadId` without checking ownership, anyone with a valid JWT can read anyone's data. Test every `:id` route for Insecure Direct Object Reference (IDOR).

- [ ] Driver A calls `GET /api/driver/loads/:loadId` with Driver B's loadId. Must 403, not 200.
- [ ] Shipper X calls `GET /api/shipper/loads/:loadId` for Shipper Y's load. Must 403.
- [ ] Org member of Org 1 calls any `/api/org/*` route scoped to Org 2. Must 403.
- [ ] Receiver signs a BOL on a load they are not the receiver for. Must reject.
- [ ] Driver posts `POST /api/driver/location` for a load assigned to a different driver. Must reject.
- [ ] Owner Operator pulls `/api/owner-operator/loadboard` and sees only their own fleet's offers, never a stranger's.

**Method:** build a parameterized matrix. For each protected route, run it as:
1. No token
2. Valid token, wrong role
3. Valid token, correct role, wrong tenant

Default-deny on all three except the single legitimate case. This matrix is the backbone of the suite and should be auto-generated from the route table.

---

## 3. Role Guards and RBAC

- [ ] Every `requireRole` route rejects all other roles. Hit each route with each of the 5 platform roles (OWNER_OPERATOR, DRIVER, SHIPPER, RECEIVER, ADMIN).
- [ ] Org IAM hierarchy: `DISPATCHER` cannot `PATCH /api/org/members/:userId/role` (OWNER only).
- [ ] `ORG_DRIVER` cannot invite members.
- [ ] Cannot remove or demote the org OWNER.
- [ ] Shipper admin-request elevation: a shipper cannot self-approve. Only ADMIN can via `/api/admin/shippers/:shipperId/approve-admin`.

---

## 4. Admin Bootstrap Flow

The race-safe bootstrap is clever code, so test it adversarially rather than sequentially.

- [ ] Fire two concurrent `POST /api/setup/complete` calls with the same valid token. Exactly one ADMIN created. The other gets a clean error.
- [ ] Replay a burned token. Must fail.
- [ ] `POST /api/setup/request` after any admin exists. Must return 409.
- [ ] Expired token (past 24hr TTL). Must reject.
- [ ] The landing "Need admin access?" section disappears once `GET /api/setup/status` returns `adminExists: true`, and the endpoint itself (not just the UI) refuses.

---

## 5. Token Lifecycle

Four single-use, time-boxed tokens exist: password reset (1hr), admin setup (24hr), org invite (72hr), fleet invite (168hr). For each token type:

- [ ] Used once, then reused. Must fail.
- [ ] Expired by TTL. Must fail.
- [ ] Tampered or forged token string. Must fail.
- [ ] Burned on accept (org and fleet invites). Verify the row is actually removed or marked, not just the HTTP response.
- [ ] `POST /api/auth/forgot-password` and `POST /api/setup/request` return identical responses for known and unknown emails. No user enumeration.

---

## 6. Matching and Broadcast Engine

The fan-out logic is core IP. Seed fixtures with known-correct answers and assert against them.

- [ ] Radius: a driver just inside vs just outside the geohash radius. Test the boundary, not just "roughly nearby."
- [ ] Equipment: a reefer load does not broadcast to a dry-van-only driver.
- [ ] CDL class and endorsements: a hazmat load excludes non-hazmat drivers.
- [ ] MC maturity gating: a too-new MC# is excluded. Confirm the exact threshold.
- [ ] Suspended drivers receive zero offers.
- [ ] Capacity buffer: a driver at buffer limit is skipped.
- [ ] Negative test: an eligible driver is never silently dropped from a broadcast. False negatives lose your customers loads.

---

## 7. Offer Lifecycle and Concurrency

The 15-minute countdown plus fan-out creates classic race conditions.

- [ ] **Two drivers accept the same load within the same second. Exactly one wins. The loser gets a clear "already taken."** This is the single most important concurrency test in the app. DynamoDB conditional writes (`attribute_not_exists` or a status condition) should enforce it. Verify under real parallelism using `Promise.all`.
- [ ] Accept after the countdown expires. Must reject.
- [ ] Decline, then attempt accept. Must reject.
- [ ] Offer TTL: an unaccepted offer actually expires and frees the load for re-broadcast.
- [ ] The frontend countdown matches the server's authoritative expiry. No client-clock drift lets a stale accept through.

---

## 8. Load State Machine

Lifecycle: `DRAFT` → `BROADCAST` → `ACCEPTED` → `PICKED_UP` → `IN_TRANSIT` → `DELIVERED`.

- [ ] Every illegal transition is rejected (for example DELIVERED back to BROADCAST, or PICKED_UP without ACCEPTED).
- [ ] `DELETE /api/shipper/loads/:loadId` works only on DRAFT, never on a live load.
- [ ] Admin `PUT /api/admin/loads/:loadId/status` override works, is bounded, and is logged.
- [ ] Driver `pickup` and `deliver` are valid only in the correct prior state and only by the assigned driver.

---

## 9. BOL and Digital Signature

- [ ] Only DRIVER and RECEIVER can sign. SHIPPER cannot.
- [ ] Sign an already-signed BOL. Define and test the behavior (reject vs co-sign).
- [ ] Signature is bound to the correct load and signer identity. No replay onto another BOL.
- [ ] `GET /api/bol/loads/:loadId/pdf` produces a valid file that matches the signed record.
- [ ] BOL attachments in S3 bucket `loadlead-pod-uploads` are not publicly readable. Access is via signed URLs only.

---

## 10. GPS Tracking and Privacy

- [ ] Only the assigned driver can post location via `POST /api/driver/location`.
- [ ] Tracking is visible only to that load's shipper, receiver, and admin. A random user cannot pull `/api/shipper/loads/:loadId/tracking`.
- [ ] Garbage coordinates (0,0 / out of range / non-numeric) are rejected.
- [ ] Driver location is never exposed to drivers or parties on unrelated loads.

---

## 11. DynamoDB-Specific Behaviors

- [ ] GSI eventual consistency: write a load, then immediately query `status-index` or `shipperId-index`. Confirm the code tolerates the brief read lag. Do not assume read-after-write on GSIs.
- [ ] No auth via scan: confirm no handler uses `scan` then filters in a way that could leak across tenants or inflate cost.
- [ ] Expression injection: pass crafted strings into filter and key inputs. Confirm parameterization via the Document Client. Malformed expressions fail safe.
- [ ] Throttling: burst writes to a single partition (for example a load with hundreds of offers) and confirm graceful handling under on-demand limits.

---

## 12. Input Validation and Uploads

- [ ] express-validator coverage on every POST and PUT body. Missing required fields, wrong types, and oversized payloads all rejected with clean 400s.
- [ ] File uploads (BOL attachments, headshots): enforce a content-type allowlist and a size cap. Test a renamed executable, an oversized file, and a zero-byte file.
- [ ] PostLoad bad data: negative weight, pickup window after dropoff window, same origin and destination, mixed units.

---

## 13. Infrastructure and Secrets

- [ ] Verify `.env` is genuinely absent from the deployed EB bundle. Add a deploy-time assertion that fails the build if `.env` is present in the zip.
- [ ] Confirm `DYNAMODB_ENDPOINT` is unset in production. If set, it falls back to localhost:8000 and silently breaks.
- [ ] CORS: a request from an origin not in `ALLOWED_ORIGINS` is blocked.
- [ ] **XSS pass:** JWT in localStorage means a stored XSS equals full account takeover. Test every field that renders user input (load notes, names, org details, BOL fields). One stored XSS here is catastrophic given the token storage choice.

---

## 14. Failure Modes

- [ ] Resend down: signup, offer, and reset still succeed at the data layer and degrade gracefully or queue. A failed email must not roll back a created account.
- [ ] Google Maps Routes API down or over quota: load posting and tracking handle the missing distance and duration without crashing.
- [ ] Partial write: an offer row is created but push or email fails. No orphaned or half-broadcast state.
- [ ] Push subscription expired or invalid: pruned, does not block the flow.

---

## 15. Frontend

- [ ] Role-based route guards in `App.tsx`: deep-link to a driver page as a shipper and confirm the redirect.
- [ ] Countdown timer accuracy and the expiry edge: a click at 0:00 that the server rejects is handled cleanly.
- [ ] Mobile: drivers live on phones. Test core accept and decline plus GPS flows on a real small viewport with flaky connectivity.
- [ ] Token expiry mid-session: a 401 redirects to login rather than white-screening.
- [ ] ErrorBoundary actually catches render failures.

---

## 16. Performance and Scale

- [ ] Broadcast fan-out to a large eligible-driver set (100+): measure latency and confirm every eligible driver gets exactly one offer and one notification.
- [ ] Geohash proximity query performance as driver count grows.
- [ ] EB autoscaling and DynamoDB throttle behavior under a load-posting burst. Measure p95 latency, not average.

---

## 17. Regression and CI Gate

Wire the following into CI as blocking checks. A red build blocks the deploy.

- [ ] Authorization matrix (Section 2), auto-generated from the route table.
- [ ] Admin bootstrap race (Section 4).
- [ ] Double-accept race (Section 7).

These three are where a regression does real damage. Everything else can run as a fuller nightly or pre-release suite.

---

## Suggested Tooling

- **API and integration:** Jest + supertest against the Express app.
- **Concurrency:** `Promise.all` to force real races (double-accept, bootstrap).
- **Local data layer:** `amazon/dynamodb-local` via Docker for isolated, repeatable runs.
- **Frontend:** Vitest + React Testing Library for guards and components; Playwright for the critical end-to-end flows (signup wizard, post load, accept offer, sign BOL).
- **Load:** k6 or Artillery for the fan-out and burst scenarios in Section 16.
