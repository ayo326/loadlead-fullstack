---
title: Cross-Persona Contract & UAT BDD
status: authored
owner: platform
audience: engineering + QA
related:
  - LoadLead_Reference_Refactored.md
  - LoadLead_Carrier_OO_Dashboard_Spec.md
  - LoadLead_Admin_Carrier_IAM_Spec.md
connie-publish: true
connie-page-id: '2129924'
---

# Cross-persona contract testing + UAT BDD

The five public personas (shipper / carrier / OO / driver / receiver) and
the internal admin console are CONSUMERS of one PROVIDER: the Express
API. The independence rule (personas built separately, sharing the API)
means a change for one persona's contract MUST NOT silently break another
persona's expectations. This document is the authored source of truth for
the cross-persona contract suite (@H5..@H11) and its manual UAT sign-off
companion (UAT-CT-*).

## Tagging convention

Each test interaction in `frontend-v2/tests/contract/*.pact.test.ts`
carries one bracket tag (`[Hn]`) so the existing test-dashboard sync
picks it up:
- `[H5]` shipper-web   - all interactions in `shipper-web.pact.test.ts`
- `[H6]` carrier-web   - all interactions in `carrier-web.pact.test.ts`
- `[H7]` oo-web        - all interactions in `oo-web.pact.test.ts`
- `[H8]` driver-web    - all interactions in `driver-web.pact.test.ts`
- `[H9]` receiver-web  - all interactions in `receiver-web.pact.test.ts`
- `[H10]` admin-console - all interactions in `admin-console.pact.test.ts`
- `[H11]` cross-persona gate - the provider-verification + can-i-deploy run

Test-results aggregation: if ANY interaction in the persona's file fails,
the dashboard records the whole `[Hn]` as fail (sync-tracker.js
takes-the-worst). To find which interaction broke a persona, read the
vitest output directly.

## @H5 - shipper-web contract

```gherkin
Feature: shipper-web contract with loadlead-api

  As shipper-web, the loadlead-api must satisfy these shapes/behaviors:

  Scenario: posting a new load returns the server-assigned shape
    Given the authenticated shipper has a complete profile
    When  shipper-web POSTs /api/shipper/loads with taxonomy fields
    Then  the response is 201 with { loadId, status: DRAFT, shipperId }

  Scenario: own-loads list is scoped to the shipper
    Given the authenticated shipper has at least one posted load
    When  shipper-web GETs /api/shipper/loads
    Then  the response is 200 with { loads: [{ loadId, shipperId, status, ... }] }
    And   only the shipper's own loads appear

  Scenario: cross-shipper access returns 404 (not 403)
    Given a load exists belonging to a different shipper
    When  shipper-web GETs /api/shipper/loads/:id for that load
    Then  the response is 404 (existence-leak protection)
```

## @H6 - carrier-web contract

```gherkin
Feature: carrier-web contract with loadlead-api

  Scenario: dispatcher dashboard shape
    Given a carrier org has 3 active drivers and 5 loads in flight
    When  carrier-web GETs /api/org/:orgId/dashboard
    Then  the response includes { orgId, activeLoads, drivers[], revenue }
    And   drivers carry { driverId, firstName, lastName, idvStatus, status }

  Scenario: invite a team member via the IAM matrix
    Given a carrier org owner is logged in
    When  carrier-web POSTs /api/org/:orgId/invitations with role=DISPATCHER
    Then  the response is 201 with { invitation: { token, email, orgRole, expiresAt } }

  Scenario: ORG_DRIVER cannot read the carrier dashboard
    Given an ORG_DRIVER is a member but lacks dashboard:read permission
    When  carrier-web GETs /api/org/:orgId/dashboard as ORG_DRIVER
    Then  the response is 403 (not 200 with empty data)
    And   the carrier UI routes 403 to the insufficient-permission empty state
```

## @H7 - oo-web contract

```gherkin
Feature: oo-web contract with loadlead-api

  Scenario: blended dashboard mixes self-driver + fleet
    Given an owner operator has 1 self-driver and 2 fleet drivers
    When  oo-web GETs /api/owner-operator/dashboard
    Then  the response includes { operatorId, selfDriver, fleetDrivers[], activeLoads, grossRevenue }
    And   selfDriver.isSelf === true while fleetDrivers[].isSelf === false

  Scenario: two-gate authority status (FMCSA + KYB, separate from IDV)
    Given an owner operator has submitted FMCSA + KYB but not IDV
    When  oo-web GETs /api/owner-operator/verification
    Then  the response is 200 with { entityType: OWNER_OPERATOR, verificationStatus, fmcsaStatus, kybStatus }

  Scenario: pending fleet driver invitations
    Given an owner operator has 2 pending fleet driver invitations
    When  oo-web GETs /api/owner-operator/fleet/invites
    Then  the response is 200 with { invites: [{ inviteId, email, token, expiresAt }] }
```

## @H8 - driver-web contract

```gherkin
Feature: driver-web contract with loadlead-api

  Scenario: matched loadboard returns offers with full shape
    Given the authenticated driver has at least one OFFERED load matched to their truck
    When  driver-web GETs /api/driver/loadboard
    Then  the response is 200 with { loads: [{ load:{...}, offer:{...} }] }

  Scenario: affiliation status truth table
    Given the authenticated driver is affiliated with an owner operator
    When  driver-web GETs /api/driver/affiliation
    Then  the response is 200 with { status: AFFILIATED|UNAFFILIATED|NO_PROFILE, carrier? }

  Scenario: unaffiliated driver loadboard is empty (not 403)
    Given the authenticated driver has NO carrier of record
    When  driver-web GETs /api/driver/loadboard
    Then  the response is 200 with { loads: [] }
    And   the dashboard relies on this to render the "Awaiting affiliation" banner
```

## @H9 - receiver-web contract

```gherkin
Feature: receiver-web contract with loadlead-api

  Scenario: inbound shipments scoped to the receiver
    Given a receiver has 2 in-transit shipments assigned to their facility
    When  receiver-web GETs /api/receiver/incoming
    Then  the response is 200 with { loads: [{ loadId, status, pickupCity, deliveryCity, assignedDriverId }] }

  Scenario: confirm delivery without the chain signature is rejected
    Given a load IN_TRANSIT to this receiver has no RECEIVER_CONFIRM signature yet
    When  receiver-web POSTs /api/receiver/loads/:id/confirm
    Then  the response is 412 with { message containing "RECEIVER_CONFIRM signature is required", statusCode: 412 }

  Scenario: cross-receiver access returns 404
    Given a load exists destined for a different receiver facility
    When  receiver-web GETs /api/receiver/loads/:id for that load
    Then  the response is 404 (existence-leak protection)
```

## @H10 - admin-console contract

```gherkin
Feature: admin-console contract with loadlead-api

  Scenario: paginated orgs with member counts + suspension state
    Given the admin org list has at least one active and one suspended org
    When  admin-console GETs /api/admin/orgs?status=all&limit=50
    Then  the response is 200 with { orgs: [{ orgId, name, capabilities, memberCount, isSuspended }], cursor }

  Scenario: suspend org with a valid reason returns audited shape
    Given a STAFF_ADMIN is logged in and an active org exists
    When  admin-console POSTs /api/admin/orgs/:id/suspend with reason >= 6 chars
    Then  the response is 200 with { ok: true, orgId, suspended: true }

  Scenario: suspend org without a reason is rejected
    Given a STAFF_ADMIN is logged in and an active org exists
    When  admin-console POSTs /api/admin/orgs/:id/suspend with no reason
    Then  the response is 400 (the 400 IS the audit-trail enforcement mechanism)
```

## @H11 - cross-persona gate (the core value)

```gherkin
Feature: provider can deploy ONLY when every persona contract is satisfied

  Scenario: clean provider satisfies all 6 consumer contracts
    Given the loadlead-api provider has been verified against every persona pact in the Broker
    And   all 6 consumers (driver/shipper/carrier/oo/receiver/admin) are deployed in production
    When  can-i-deploy is queried for loadlead-api at the candidate version
    Then  it returns "✅ Computer says yes" with exit code 0

  Scenario: deliberate cross-persona break blocks the deploy AND names the broken consumer
    Given the deliberate-break flag is set so the provider satisfies one persona but breaks another
    When  provider verification is run with publishVerificationResult=true
    Then  the verification publishes a "failed" result for the broken consumer only
    When  can-i-deploy is queried for that broken provider version
    Then  it returns "❌ Computer says no" with exit code 1
    And   the output names the specific broken consumer (e.g. oo-web)

  Scenario: reverting the deliberate break unblocks the deploy
    Given the deliberate-break flag is unset
    When  provider verification is re-run and can-i-deploy re-queried
    Then  it returns "✅ Computer says yes" with exit code 0
```

The deliberate break for @H11 is implemented as an env-controlled fixture
inside `backend/tests/contract/verify-provider.ts`, NOT a source-code
edit. To reproduce:
```
PACT_DELIBERATE_BREAK=oo-web npx tsx tests/contract/verify-provider.ts
```
Unsetting the env var restores the provider to the clean shape. The flag
is intentionally only honored when explicitly set, so main never ships
with the break active.

## UAT-CT-* manual sign-off

The automated contracts above prove that the API matches every persona's
expectations. The UAT-CT-* items below record a HUMAN's confirmation
that "yes, the contract the automation enforces is the contract this
persona's real users actually want." Different layer; both are needed.

Register these in the UAT tracker (`docs/UAT_CT_Checklist.md`) with blank
Tester / Date / Result, each linked to its @Hn:

| ID         | Linked to | What the tester confirms |
|------------|-----------|---------------------------|
| UAT-CT-S   | @H5       | Shipper-web's contract reflects how a real shipper expects to post and track |
| UAT-CT-C   | @H6       | Carrier-web's contract reflects a real dispatcher's dashboard + members flow |
| UAT-CT-O   | @H7       | OO-web's contract reflects how a real OO sees their blended dashboard |
| UAT-CT-D   | @H8       | Driver-web's contract reflects the offer/accept/POD loop a real driver runs |
| UAT-CT-R   | @H9       | Receiver-web's contract reflects how a real receiver confirms delivery |
| UAT-CT-A   | @H10      | Admin-console's contract reflects a real platform operator's destructive flow |
| UAT-CT-X   | @H11      | The cross-persona break demo + can-i-deploy gate are what we want as the deploy guardrail |

Tester answers PASS / FAIL / NEEDS-WORK on each. PASS means the persona
team agrees their automated pact is the right contract. FAIL means the
automated pact diverges from what the persona team actually wants and
needs an authored update.

## Reproducing the suite

```
# Broker
cd pact && docker compose up -d

# 1. Consumer pacts (all 18 interactions; emits test-results into vitest.json)
cd frontend-v2 && npx vitest run tests/contract/

# 2. Publish to broker
SHA=$(git rev-parse --short HEAD)
npx pact-broker publish pact/pacts \
  --consumer-app-version="$SHA" --branch=main \
  --broker-base-url=http://localhost:9292 -u pact -p pact

# 3. Provider verification (writes results back to broker)
cd backend && PACT_BROKER_PUBLISH_VERIFICATION_RESULTS=true \
  PROVIDER_VERSION="$SHA" npx tsx tests/contract/verify-provider.ts

# 4. Reproduce the @H11 break
PACT_DELIBERATE_BREAK=oo-web PROVIDER_VERSION="$SHA-break" \
  PACT_BROKER_PUBLISH_VERIFICATION_RESULTS=true \
  npx tsx tests/contract/verify-provider.ts

# 5. can-i-deploy (must BLOCK and NAME the broken consumer)
npx pact-broker can-i-deploy \
  --pacticipant loadlead-api --version "$SHA-break" \
  --to-environment production \
  --broker-base-url=http://localhost:9292 -u pact -p pact
```
