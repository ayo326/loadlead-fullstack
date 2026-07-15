# Platform E2E Audit v6 (2026-07-14) - Dimension 1: Backend test suite + flake analysis

## Headline
| Metric | Value |
|---|---|
| Command | `npm test` (vitest 4.1.9, `vitest run`) |
| Test files | 95 / 95 passed |
| Total tests | 772 |
| Passed / Failed / Skipped | 772 / 0 / 0 |
| Flake count | 0 (3 consecutive identical green runs) |
| Duration | 3.84s / 3.98s / 4.37s |

Suite is genuinely healthy: zero failures, zero skips, zero `.only`/`.todo`/`xit`, zero flakes, no unhandled promise rejections. All findings below are coverage-gap / hygiene items, not failures. Deps are hoisted to the repo-root workspace `node_modules` (610 pkgs); no lockfile exists, so `npm ci` would fail today.

## Findings

### F1 - HIGH: SNS webhook signature verifier has ZERO test coverage
- Evidence: `src/services/snsVerify.ts` (`verifySnsMessage`, `confirmSnsSubscription`, `isAmazonHost`) has no test references. It is live: mounted at `POST /api/support/inbound/ses` (`src/routes/support.ts:111`, calls verify at :120 and `confirmSnsSubscription(SubscribeURL)` at :127). Support tests only exercise the Resend path, never SNS.
- Impact: security-critical. Validates X.509 signatures on inbound AWS SNS and enforces an SSRF allowlist (`isAmazonHost`, snsVerify.ts:23-29) before fetching the signing cert and hitting `SubscribeURL`. A regression to the `endsWith('.amazonaws.com')` check, SignatureVersion handling (SHA1 vs SHA256), or canonical-string reconstruction would silently allow forged bounce/complaint events or an SSRF, uncaught.
- COA: unit test snsVerify: (a) `isAmazonHost` allow/deny table; (b) valid sig verifies, tampered Message fails, for SignatureVersion 1 and 2; (c) SubscriptionConfirmation vs Notification signing-field sets. Mock the https cert fetch.

### F2 - MEDIUM: Canopy webhook route untested end-to-end (raw-body path)
- Evidence: `src/routes/canopyWebhook.ts` (118 lines) has no supertest coverage. `verifyCanopySignature` IS unit-tested (`tests/unit/canopy/canopyConnect.test.ts:141`), but the route raw-body capture, the 401 branch (:70-73), and the sandbox-no-secret bypass (:61-68) are not exercised.
- Impact: raw-body handling is the most error-prone part of HMAC webhook verification (any middleware re-parsing the body breaks the signature). Memory flags this signature as the open Canopy blocker.
- COA: supertest posting raw body with valid/invalid `canopy-signature`, asserting 200 vs 401, plus the sandbox accept-with-warning path.

### F3 - MEDIUM: Hauler-capacity route untested (recently shipped)
- Evidence: `src/routes/capacity.ts` (mounted `/api/capacity`, `src/index.ts:251`) has no HTTP-level test. The service `HaulerCapacityService` is well covered (20 tests).
- Impact: route-layer logic unverified: auth + requireRole gate, driver resolution, `weightLbs` Number() parsing (no NaN/negative test), declareEmpty/declareLoaded dispatch, carrier resolution via cross-module `resolveCarrierIdForUser`.
- COA: supertest for GET/POST `/api/capacity` covering role gate, missing-driver 404, bad weightLbs, empty/loaded declarations.

### F4 - MEDIUM: Untested services used across modules
- Evidence: `capacityService.ts` (`calcUsableVolume` geometry, consumed by driver/admin/broadcast/equipment/loadService) and `complianceGather.ts` (`gatherForLoad`, `gatherCaseFileRecords`, consumed by adminCompliance) have no dedicated tests.
- Impact: calcUsableVolume is deterministic math feeding load-matching capacity decisions; complianceGather sits on the legal-hold / law-enforcement surface. Both only exercised incidentally.
- COA: focused unit tests for calcUsableVolume (dimension/edge cases) and complianceGather (record assembly + empty/partial inputs).

### F5 - MEDIUM: "False-green" risk - negotiation tests hit real DynamoDB and swallow the failure
- Evidence: `tests/unit/payments/negotiationDispatch.test.ts` and `negotiationEsign.test.ts` emit `DynamoDB putItem error: connect ECONNREFUSED 127.0.0.1:8000`. The bid/accept routes call `NotificationOutboxService.deliver` (`src/routes/negotiations.ts:202`), unmocked; `deliver` awaits `Database.putItem` (`notificationOutboxService.ts:64`) against a local DynamoDB that is not running, then catches and logs ("never throws").
- Impact: these tests assert on `res.status` and `NegotiationService.bid` only; the outbox persistence path is silently no-op'd and never verified. A regression to the outbox row schema/delivery would not fail them. Real network I/O per test is the sole source of run-to-run noise (9 vs 18 ECONNREFUSED lines; pass/fail unaffected).
- COA: mock `NotificationOutboxService` in both files (as `negotiation.test.ts` mocks its deps). Outbox is separately covered by `notificationOutbox.test.ts`.

### F6 - LOW: Admin routes lack route-level tests
- Evidence: no supertest for `adminBeta.ts`, `adminLiquidity.ts`, `adminStaff.ts`, `reference.ts`; service layers are tested.
- COA: thin supertest smoke asserting the role gate + one happy path each.

### F7 - LOW: AWS SDK v3 node-version deprecation (future-dated)
- Evidence: 23 NodeVersionSupportWarning lines/run on node v20.20.0. AWS SDK JS v3 requires node >= 22 after early Jan 2027.
- COA: plan a CI/runtime bump to node 22 before Jan 2027.

### F8 - LOW (hygiene): no lockfile
- Evidence: no package-lock.json; `npm ci` would fail. Workspace ignores backend `.npmrc legacy-peer-deps`.
- COA: commit a root lockfile for reproducible CI installs.

## Recently-shipped coverage verdict
Service-layer coverage is strong: payments 218, compliance 97, canopy 23, hauler capacity 20. The real gaps are at the route/integration layer (SNS, canopy webhook, capacity routes), not the core business logic.
