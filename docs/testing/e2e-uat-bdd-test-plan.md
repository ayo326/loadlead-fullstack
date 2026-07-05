---
connie-title: Testing - E2E / System / UAT / BDD Test Plan
connie-publish: true
connie-page-id: '196849'
---

# LoadLead - E2E, System, UAT & BDD Test Plan

_Generated June 2026. Companion to `LoadLead_Test_Spec.md` (unit + integration matrix). This layer covers full-journey and acceptance testing. Attach to Claude Code; run against a seeded staging stack._

## 0. How to read this

| Layer | Question it answers | Primary tool |
|---|---|---|
| **Horizontal E2E** | Does a whole business journey work across every module? (breadth) | Playwright (UI) + API |
| **Vertical E2E** | Does one feature work through every layer UI→API→service→DB→external? (depth) | Playwright + network/DB asserts |
| **System** | Does the integrated system meet functional + non-functional requirements? | Playwright, k6, ZAP, manual |
| **UAT** | Would each real persona accept this as fit for purpose? | Scripted manual + Playwright assist |
| **BDD** | Do behaviors match the spec, in plain language, executably? | Cucumber.js + step defs |

"Perform" for this plan = author + make runnable. Execution needs the staging environment in section 1. Defects route to the tracker (section 8) by matrix ID.

---

## 1. Test environment & tooling

**Stack:** a dedicated `staging` deployment (EB + DynamoDB) OR a local full stack (API on localhost + DynamoDB Local + the Vite dev server). Never run destructive E2E against production.

**External dependencies - use sandboxes, never live:**
- Didit: sandbox workflow IDs; drive KYB/IDV/AML outcomes via sandbox controls; webhooks delivered to staging with valid HMAC.
- FMCSA QCMobile: test WebKey; seed known-active and known-inactive MC/DOT numbers.
- Google Maps: test key with quota; assert geocode/distance calls are made and cached.
- Resend + Web Push: capture outbound (test inbox / push capture), assert content, never spam real users.

**Tooling:**
```bash
npm i -D @playwright/test @cucumber/cucumber @cucumber/pretty-formatter
npx playwright install
# load/perf: k6 (separate binary).  security: OWASP ZAP (containerized).
```

**Seed data (per run, idempotent `tests/e2e/seed.ts`):** test users for every role; one verified Carrier org with two drivers; one verified Owner Operator with a self-driver and one fleet driver; one unaffiliated driver; one shipper org; one receiver location; a handful of loads in assorted states; a factoring partner.

**Test accounts** are tagged `@e2e` and cleaned between suites.

---

## 2. Horizontal E2E (breadth - full journeys)

Each scenario is one complete journey crossing many modules. Run on UI where a screen exists; fall back to API for unbuilt screens (e.g., the OO second IDV step).

| ID | Journey | Modules crossed | Key assertions |
|---|---|---|---|
| HE2E-1 | **Carrier-org load, happy path** | shipper → broadcast → offer → verify gate → BOL → invoice → notify | Posted load reaches a verified org driver; accept succeeds; POD + receiver signature complete the BOL; invoice payee = org; push/email fired at each milestone |
| HE2E-2 | **Owner Operator self-haul** | OO signup → self-driver → verify (KYB+IDV) → broadcast → self-accept → POD → invoice | Self-driver auto-created; broadcast reaches solo OO; accept with no driverId assigns self; invoice payee = operatorId |
| HE2E-3 | **OO fleet-driver load** | OO invite → driver IDV → OO assigns → deliver → invoice | Driver inherits OO authority; identity is the driver's own IDV; invoice payee = operatorId |
| HE2E-4 | **Carrier-org onboarding both ways** | org create → direct driver setup + invite driver → IDV → authority verify → accept | Direct-setup driver and invited driver both reach haul-ready; org KYB on orgId; each driver IDV on own userId |
| HE2E-5 | **Factoring end-to-end** | verified carrier → deliver → POD-complete gate → opt-in → debtor AML → payee=FACTOR | Opt-in blocked until DELIVERED + signature + min photos; AML runs on debtor; payee resolves FACTOR; LoadLead never holds funds |
| HE2E-6 | **Authority expiry mid-life** | verified carrier → 90-day expiry → attempt new accept | EXPIRED authority blocks new acceptance; in-flight load unaffected; re-verify restores |
| HE2E-7 | **Unaffiliated → affiliated** | self-signup → IDV → blocked accept → join carrier → accept | Unaffiliated driver can sign up and IDV, cannot accept; after joining a carrier, can accept |
| HE2E-8 | **Receiver delivery confirmation** | assigned load → receiver incoming → consignee signature → BOL closed | Receiver only sees loads for its location; signature closes BOL; shipper notified |
| HE2E-9 | **Shipper cannot self-haul** | shipper org (capabilities incl SHIPPER) attempts carrier actions | Every carrier action denied end to end; org can't hold CARRIER capability alongside SHIPPER |
| HE2E-10 | **Admin verification queue** | carrier submits → admin reviews → approve / reject | Approve flips VERIFIED and unblocks; reject flips REJECTED and blocks (regression of the deriveStatus bug) |

**HE2E-1 expanded (template for the rest):**
1. Seed a verified Carrier org with one IDV-verified driver; a shipper org.
2. Shipper posts a load (full tender fields); assert it persists with `status=BROADCAST` and a Maps route is attached.
3. Assert the load appears on the org driver's loadboard (broadcast eligibility: radius, equipment, CDL, verified).
4. Driver accepts; assert `requireVerifiedCarrier` passes both gates, a conditional write claims the load, an offer is `ACCEPTED`, and a push/email fired.
5. Driver marks pickup → in-transit → delivery (status transitions valid; invalid skips rejected).
6. Driver uploads POD photos to S3; receiver signs BOL; assert `assertPodComplete` true and BOL closed.
7. `resolveInvoicePayee` returns CARRIER_ORG / orgId; shipper sees delivered + BOL.

---

## 3. Vertical E2E (depth - one feature through every layer)

Each slice is exercised top to bottom with an assertion at every tier.

| ID | Feature slice | Layers asserted |
|---|---|---|
| VE2E-1 | **Carrier verification** | UI form → `POST /verification/submit` → verification service → FMCSA call (active?) → Didit KYB + IDV session create → `diditUrl` to UI → Didit webhook (HMAC verified) → `recomputeAndPersist` → DynamoDB Verifications + `User.idvStatus` → UI shows VERIFIED |
| VE2E-2 | **Load acceptance** | loadboard UI → `POST /offers/:loadId/accept` → `requireVerifiedCarrier` (resolveCarrierOfRecord → DDB queries) → conditional write Loads/Offers → push → UI reflects claimed |
| VE2E-3 | **POD upload + signature** | camera/file UI → S3 presigned PUT → POD service → `assertPodComplete` (count + DELIVERED) → BOL update → receiver signature capture → DynamoDB BOL |
| VE2E-4 | **Org creation w/ capabilities** | capability multiselect UI → `POST /api/org` → `assertCapabilities` (reject SHIPPER+CARRIER) → DynamoDB Organizations |
| VE2E-5 | **Routing** | load create → `googleMapsService` geocode + distance matrix → route persisted → shown on UI |
| VE2E-6 | **Factoring opt-in** | opt-in UI → `POST /factoring/loads/:id/opt-in` → `assertPodComplete` + debtor AML (Didit) → FactoringOptIns → `resolveInvoicePayee` |
| VE2E-7 | **Auth session** | login UI → JWT httpOnly cookie set → middleware validates → protected route 200 → token expiry → refresh → logout clears cookie |
| VE2E-8 | **Fleet invite** | OO invite UI → token email (captured) → driver accept-invite UI → `ownedByOperatorId` set + `fleetDriverIds[]` updated → one-parent invariant enforced → DynamoDB |

**Per-slice rule:** assert the *boundary crossings*, not just the endpoints - e.g., VE2E-1 must prove the FMCSA call happened, the webhook signature was checked, and the identity landed on `User`, not the carrier record.

---

## 4. System testing

### 4.1 Functional coverage
The system satisfies every role flow in sections 2-3 with no regressions against `LoadLead_Test_Spec.md` (unit/integration). Run that suite green first; system testing assumes it passes.

### 4.2 Performance & load (k6)
Targets are to be set and measured - suggested starting SLAs in parentheses.

| ID | Scenario | Measure | Suggested target |
|---|---|---|---|
| PERF-1 | Loadboard query under 5k active loads | p95 latency | < 400 ms |
| PERF-2 | Broadcast fan-out to N eligible drivers | time to all notified | < 5 s for N≤500 |
| PERF-3 | 50 concurrent accepts on distinct loads | error rate / throttle | 0 errors, no DDB throttle |
| PERF-4 | 20 concurrent accepts on the SAME load | exactly one success | 1×200, 19×409 |
| PERF-5 | POD upload (5 MB photo) | upload + process | < 8 s |
| PERF-6 | Sustained 30 rps for 10 min | p99 latency drift, 5xx | stable, 0 5xx |

Check DynamoDB GSI hot partitions (`status-index`, `shipperId-index`, `loadId-index`) under skewed load; verify pagination on loadboard/history.

### 4.3 Security

| ID | Check | Expected |
|---|---|---|
| SEC-1 | Full authZ/IDOR matrix (role × route) | every cross-tenant/role access denied (mirrors §4G of the unit spec at HTTP level) |
| SEC-2 | JWT: httpOnly, Secure, SameSite, expiry, refresh rotation | tokens not readable by JS; expired tokens rejected; refresh rotates |
| SEC-3 | Rate limiting on `/api/auth/*` (15/15min) | 16th request in window → 429 |
| SEC-4 | Didit webhook signature | unsigned / bad-HMAC webhook → rejected; test events bypass only via documented header |
| SEC-5 | Input validation (Zod) on every body | malformed/oversized/injection payloads → 400, no crash |
| SEC-6 | S3 POD bucket | objects not publicly listable; access via presigned only |
| SEC-7 | Secrets & PII | no secrets in responses/logs; no PII (CDL, IDV data) in logs or URLs |
| SEC-8 | CORS / Helmet | only `ALLOWED_ORIGINS`; security headers present; HTTPS redirect |
| SEC-9 | Capability/parent invariants can't be bypassed via direct API | SHIPPER+CARRIER and dual-parent rejected at the route, not just the UI |
| SEC-10 | Double-broker / identity | a carrier's verified status cannot be used by a driver whose own `idvStatus` ≠ VERIFIED |

Run an automated ZAP baseline scan against staging for the OWASP top-10 surface.

### 4.4 Reliability & resilience

| ID | Fault injected | Expected behavior |
|---|---|---|
| REL-1 | Didit API down at submit | submit fails gracefully with retry guidance; no half-created verification |
| REL-2 | Didit webhook delivered twice (same event) | idempotent; status not corrupted |
| REL-3 | FMCSA timeout | verification held PENDING, not falsely VERIFIED; surfaced to admin |
| REL-4 | Google Maps quota exceeded | load still posts; route marked unresolved + retried, not lost |
| REL-5 | Resend failure | core action (accept/deliver) still succeeds; notification queued/retried |
| REL-6 | DynamoDB conditional-write contention | loser gets 409, no duplicate assignment, no orphaned offer |
| REL-7 | Partial POD (photos < min) at opt-in | opt-in blocked, clear reason |

### 4.5 Data integrity & invariants (the ones this refactor introduced)
- One-parent invariant holds under all onboarding paths and under concurrency (no driver with both `ownedByOperatorId` and an active CARRIER membership).
- OrgCapability exclusivity (no SHIPPER+CARRIER) on create AND update.
- Verification state machine: only valid transitions (`UNVERIFIED→PENDING→VERIFIED|REJECTED→EXPIRED`); identity mirrored to `User`.
- Carrier-of-record resolution deterministic for every driver shape.
- OO self-driver: exactly one, never removable, never re-parented.
- No double-accept (conditional writes).

### 4.6 Compatibility
- Browsers: latest Chrome, Safari, Firefox, Edge; iOS Safari + Android Chrome for the driver POD/camera flow.
- Web Push support varies by browser/OS - assert graceful fallback (email) where push is unsupported.
- Responsive: driver flows usable on a phone; shipper/admin on desktop.

### 4.7 Observability
- `/api/health` returns healthy; structured error responses (no stack traces to client); errors logged with correlation but without PII.

---

## 5. UAT (persona acceptance)

Each scenario: **Persona · Goal · Preconditions · Steps · Acceptance criteria (binary) · Sign-off**. Run as scripted manual passes (Playwright can assist), with a business owner signing off.

### 5.1 Shipper
- **UAT-S1 Post & track a load.** Pre: shipper org verified. Steps: create load with full tender details → watch it broadcast → see a carrier accept → track to delivered → view signed BOL. Accept: load reaches delivered with a closed BOL; shipper was notified at accept and delivery; no carrier PII exposed beyond what's needed.
- **UAT-S2 Shipper cannot haul.** Accept: no UI path lets a shipper accept/haul; API refuses.

### 5.2 Carrier-org admin
- **UAT-C1 Create carrier org & onboard drivers.** Accept: org created with CARRIER capability; can add a driver directly and by invite; each driver must complete IDV before first acceptance; SHIPPER capability is unavailable to this org.
- **UAT-C2 Company verification.** Accept: submitting MC/DOT + KYB drives the org to VERIFIED; an inactive MC is rejected with a clear reason.

### 5.3 Owner Operator
- **UAT-O1 Self-haul.** Accept: after signup the OO can verify (KYB+IDV) and accept a load *for themselves* with no fleet driver; gets paid to the operator account.
- **UAT-O2 Run a fleet.** Accept: OO invites a driver, assigns a load to that driver, and sees it through delivery; invoice pays the OO.
- **UAT-O3 Factoring.** Accept: OO configures BYO or integrated factoring; on a delivered load, opting in routes the invoice to the factor.

### 5.4 Driver
- **UAT-D1 Onboard & haul.** Accept: a driver can sign up or accept an invite, complete IDV, see eligible loads, accept one, navigate, and upload POD from a phone.
- **UAT-D2 Unaffiliated wall.** Accept: an unaffiliated driver sees a clear "join a carrier to start hauling" state and cannot accept until affiliated.

### 5.5 Receiver
- **UAT-R1 Confirm delivery.** Accept: receiver sees only inbound loads for its location and can capture a consignee signature that closes the BOL.

### 5.6 Admin
- **UAT-A1 Verification queue.** Accept: admin sees pending carriers, can approve (unblocks) or reject (blocks), and overrides are audit-logged.

UAT exit: every acceptance criterion passes and is signed off; no open Sev-1/Sev-2 defects.

---

## 6. BDD (executable Gherkin)

### 6.1 Wiring
- `@cucumber/cucumber` runs `.feature` files in `features/`; step defs in `features/steps/`.
- **Tag every scenario with its matrix ID** (`@A1`, `@H1`, …) and include `[ID]` in the scenario name, so the Cucumber JSON formatter feeds the same `sync-tracker.js` → dashboard round-trip from `LoadLead_Test_Spec.md` §8. One feature ID per scenario.
- `cucumber.js` profile:
```js
module.exports = { default: {
  require: ['features/steps/**/*.ts'],
  requireModule: ['ts-node/register'],
  format: ['json:tests/.out/cucumber.json', '@cucumber/pretty-formatter'],
}};
```
- A shared `World` holds the API client (supertest or fetch against staging), seeded ids, and the last response.

### 6.2 Feature files

```gherkin
# features/carrier_of_record.feature
Feature: Carrier of record resolution
  The system always resolves a haulable driver to a single carrier parent.

  Background:
    Given an Owner Operator "OP1" exists
    And a Carrier organization "ORG1" with capabilities ["CARRIER"] exists

  @A1
  Scenario: [A1] A fleet driver resolves to its Owner Operator
    Given a driver "D1" owned by operator "OP1"
    When the carrier of record is resolved for "D1"
    Then it is an OWNER_OPERATOR with id "OP1"

  @A2
  Scenario: [A2] An Owner Operator self-driver resolves to the Owner Operator
    Given "OP1" has a self-driver "OP1-self"
    When the carrier of record is resolved for "OP1-self"
    Then it is an OWNER_OPERATOR with id "OP1"

  @A3
  Scenario: [A3] A carrier-org member resolves to the organization
    Given a driver "D2" with an active membership in "ORG1"
    When the carrier of record is resolved for "D2"
    Then it is a CARRIER_ORG with id "ORG1"

  @A5
  Scenario: [A5] An unaffiliated driver resolves to nothing
    Given an unaffiliated driver "D3"
    When the carrier of record is resolved for "D3"
    Then there is no carrier of record

  @A6
  Scenario: [A6] Owner Operator takes precedence over a carrier-org membership
    Given a driver "D4" owned by operator "OP1"
    And "D4" also has an active membership in "ORG1"
    When the carrier of record is resolved for "D4"
    Then it is an OWNER_OPERATOR with id "OP1"
```

```gherkin
# features/verification_gates.feature
Feature: Carrier verification gates
  Accepting a load requires carrier authority AND the driver's own identity.

  @B1
  Scenario: [B1] Both gates pass
    Given driver "D1" whose carrier authority is VERIFIED
    And the user behind "D1" has idvStatus VERIFIED
    When "D1" accepts an open load
    Then the acceptance succeeds

  @B2
  Scenario: [B2] Identity not verified blocks acceptance
    Given driver "D1" whose carrier authority is VERIFIED
    And the user behind "D1" has idvStatus PENDING
    When "D1" accepts an open load
    Then the acceptance is rejected with "Driver identity not verified"

  @B4
  Scenario: [B4] Unaffiliated driver cannot accept
    Given an unaffiliated driver "D3" with idvStatus VERIFIED
    When "D3" accepts an open load
    Then the acceptance is rejected with status "UNAFFILIATED"

  @B8
  Scenario: [B8] An admin-rejected carrier can no longer accept
    Given driver "D1" whose carrier was previously VERIFIED
    When an admin rejects the carrier
    And "D1" accepts an open load
    Then the acceptance is rejected
    And the carrier status is REJECTED
```

```gherkin
# features/org_capability.feature
Feature: Organization capability exclusivity
  An organization may not be both a shipper and a carrier.

  @C4
  Scenario: [C4] Shipper and carrier together are rejected
    When an organization is created with capabilities ["SHIPPER","CARRIER"]
    Then it is rejected with "mutually exclusive"

  @C5
  Scenario: [C5] Shipper and receiver together are allowed
    When an organization is created with capabilities ["SHIPPER","RECEIVER"]
    Then it is created successfully

  @C9
  Scenario: [C9] A carrier-only org cannot post a load
    Given an organization "ORGC" with capabilities ["CARRIER"]
    When "ORGC" posts a load
    Then it is rejected for lacking the shipper capability
```

```gherkin
# features/owner_operator_self_haul.feature
Feature: Owner Operator self-haul
  An Owner Operator can personally pick up a load.

  @D1
  Scenario: [D1] A self-driver is created on signup
    When an Owner Operator "OP9" signs up
    Then "OP9" has exactly one self-driver

  @D4
  Scenario: [D4] Accepting with no driver assigns to self
    Given a verified Owner Operator "OP1" with a self-driver
    And an open load eligible for "OP1"
    When "OP1" accepts the load without naming a driver
    Then the load is assigned to the "OP1" self-driver

  @D6
  Scenario: [D6] The self-driver cannot be removed
    Given a verified Owner Operator "OP1" with a self-driver
    When "OP1" attempts to remove its self-driver
    Then the request is rejected and the self-driver remains
```

```gherkin
# features/load_acceptance_concurrency.feature
Feature: Load acceptance under concurrency
  A load is assigned to exactly one carrier.

  @H1
  Scenario: [H1] Two carriers accept the same load at once
    Given an open load "L1"
    And two verified carriers ready to accept "L1"
    When both accept "L1" simultaneously
    Then exactly one acceptance succeeds
    And the other is rejected with conflict
```

```gherkin
# features/invoice_payee.feature
Feature: Invoice payee resolution
  The payee is the carrier of record, or the factor when opted in.

  @F1
  Scenario: [F1] A fleet driver's load pays the Owner Operator
    Given a delivered load hauled by a fleet driver of "OP1"
    And no factoring opt-in exists for that load
    When the invoice payee is resolved
    Then it is the Owner Operator "OP1"

  @F4
  Scenario: [F4] A factored load pays the factor
    Given a delivered load with a SUBMITTED factoring opt-in
    When the invoice payee is resolved
    Then it is the factor
```

### 6.3 Sample step definitions

```ts
// features/steps/carrier_of_record.steps.ts
import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert';
import { api, seedOwnerOperator, seedOrg, seedDriver } from './world';

Given('an Owner Operator {string} exists', async function (op) {
  this.ids[op] = await seedOwnerOperator(op);
});
Given('a Carrier organization {string} with capabilities {string} exists', async function (org, caps) {
  this.ids[org] = await seedOrg(org, JSON.parse(caps));
});
Given('a driver {string} owned by operator {string}', async function (d, op) {
  this.ids[d] = await seedDriver(d, { ownedByOperatorId: this.ids[op] });
});
When('the carrier of record is resolved for {string}', async function (d) {
  this.res = await api.get(`/api/_test/carrier-of-record/${this.ids[d]}`); // test-only route, staging guard
});
Then('it is an OWNER_OPERATOR with id {string}', function (op) {
  assert.equal(this.res.body.entityType, 'OWNER_OPERATOR');
  assert.equal(this.res.body.entityId, this.ids[op]);
});
Then('there is no carrier of record', function () {
  assert.equal(this.res.body.carrier, null);
});
```

> The `/_test/*` resolver route is gated to non-production and lets BDD assert resolution without reaching into the DB. Equivalent steps drive real routes for the verification, capability, self-haul, concurrency, and payee features.

### 6.4 Running & reporting
```bash
npx cucumber-js                                   # runs all features
npx cucumber-js --tags "@A1 or @B8"               # a subset
node tests/sync-tracker.js                         # parse cucumber.json [ID]s → dashboard
```
Because scenarios carry `[ID]` tags, `sync-tracker.js` (extended to read `cucumber.json` alongside `vitest.json`) flows BDD pass/fail into the same merge-gate dashboard.

---

## 7. Execution order & exit criteria

1. **Unit + integration** (`LoadLead_Test_Spec.md`) green - entry gate for everything below.
2. **Vertical E2E** - prove each feature works through all layers.
3. **Horizontal E2E** - prove the journeys.
4. **BDD** - behavior conformance (can run alongside 2-3; same staging).
5. **System** - performance, security, resilience, compatibility.
6. **UAT** - persona sign-off, last.

**Exit / go-live criteria:** all Tier-1 unit/integration green; all Horizontal E2E pass; no open Sev-1/Sev-2; security checks SEC-1..SEC-10 pass; performance within agreed SLAs; every UAT acceptance criterion signed off.

---

## 8. Traceability

| This plan | Maps back to |
|---|---|
| Horizontal E2E HE2E-1..10 | the full load lifecycle + refactor decisions in `LoadLead_Reference_Refactored.md` |
| Vertical E2E VE2E-1..8 | the services and routes in sections 3-10 of the reference |
| System 4.5 invariants | unit/integration §4A,4C,4D,4E,4H |
| BDD `@A*/@B*/@C*/@D*/@F*/@H*` | the identically-numbered rows of the unit/integration matrix |

Defects are filed by the matrix ID they break, so a failure here points straight at the unit test that should also be failing - and at the line of code that owns the behavior.
