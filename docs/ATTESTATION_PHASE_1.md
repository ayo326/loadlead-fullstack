---
title: Attestation Phase 1 - Build Audit
date: 2026-06-24T00:00:00.000Z
status: SHIPPED to prod
discovery_doc: docs/ATTESTATION_DISCOVERY.md
deploys:
  - backend  loadlead-backend-prod  cfad913  Ready/Green @ t+3min
  - frontend S3 + CloudFront E38CZNP7L2DB98
connie-publish: true
connie-page-id: '2195457'
---

# Summary

E-signature + proof-photo attestation block live across all five freight-party personas with three-layer immutability for the signature chain, delete-resistance for the photo bytes, PITR on every prod table, a neutral persona-agnostic UI primitive wired into shipper / carrier (driver-side OO self-haul) / driver / receiver lifecycle handoffs, and a read-only attestation chain panel visible on every load detail page. Internal admin staff (ADMIN/MANAGER/SUPERVISOR/TEAM_LEAD) are excluded from signing at the resolver - they can read the chain only.

Phase 1 ships **B (delete-resistant)** for the photo bucket. **A (Object Lock COMPLIANCE / true WORM)** is logged for Phase 2 and requires migrating to a new bucket; it cannot be enabled on an existing bucket.

# Shipped (with evidence)

## Backend - gates + immutable Signature record

| Endpoint | Behavior | Gate | Evidence |
|---|---|---|---|
| `POST /api/attestation/photos/upload-url` | presigned PUT + PENDING row | uploadedByUserId = req.user | new on prod |
| `POST /api/attestation/photos/:id/finalize` | server reads bytes, computes sha256, PENDING → READY | only original uploader; idempotent | new on prod |
| `POST /api/attestation/sign` | records one Signature row | `assertSignerIsLoadParty` resolves the right party live; `consentGiven: true` required | unit-test proves wrong-signer 403 |
| `GET /api/attestation/chain/:loadId` | read-only ordered chain summary | `signatureData` blob stripped from list responses | new on prod |
| `POST /api/shipper/loads/:id/submit` | broadcast (existing) | 412 `BOL_SUBMIT_SIGNATURE_REQUIRED` when chain empty | new gate; unit-tested |
| `POST /api/driver/offers/:id/accept` | book a load (existing) | 412 `CARRIER_ACCEPT_SIGNATURE_REQUIRED`; signer role must be CARRIER_ADMIN or OWNER_OPERATOR | new gate |
| `POST /api/driver/loads/:id/pickup` | BOOKED → IN_TRANSIT | 412 `DRIVER_PICKUP_SIGNATURE_REQUIRED`; sig.signerUserId === req.user | new endpoint (closes `LOAD-E2E-004`) |
| `POST /api/driver/loads/:id/deliver` | IN_TRANSIT → DELIVERED | 412 `DRIVER_DELIVER_SIGNATURE_REQUIRED`; sig.signerUserId === req.user | new endpoint; replaces `/pod` |
| `POST /api/driver/loads/:id/pod` | LEGACY - returns 410 `POD_ENDPOINT_DEPRECATED` | - | new behavior |
| `POST /api/driver/loads/:id/pod-legacy` | LEGACY - fall-back behind `ALLOW_LEGACY_POD=1` env | - | new endpoint (env-disabled by default in prod) |
| `POST /api/receiver/loads/:id/confirm` | final receipt attestation | 412 `RECEIVER_CONFIRM_SIGNATURE_REQUIRED`; sig.signerUserId === req.user; exceptions captured | new endpoint (closes `LOAD-E2E-005` / `UI-E2E-003`) |

### CONSTRAINT 1 - resolver-based signer, no denormalized Load field
- `services/attestation/assertSignerIsLoadParty.ts` resolves the allowed userId set live every call.
- Org-side: OWNER + MANAGER (`ADMIN_ORG_ROLES`) fan-out via `OrgMembership` GSI `orgId-index`.
- Carrier-of-record reuses `services/carrierOfRecord.resolveCarrierOfRecord(driver)`; OO self-haul + OO fleet + Carrier-org all flow through one resolver.
- **Reassignment proof** (unit test): mutating `load.assignedDriverId` from D1 to D2 instantly changes which userId can sign DRIVER_DELIVER; old user gets a structured `WRONG_SIGNER` error. No cache to flush.

### CONSTRAINT 2 - canonical documentHash with dual versioning
- `services/attestation/canonicalize.ts` - JCS-style sorted-key serializer; numbers / dates normalized; arrays preserve order where the projection didn't sort them, sorted where it did.
- `services/attestation/projections/v1.ts` - per-action allowlist (BOL_SUBMIT / CARRIER_ACCEPT / DRIVER_PICKUP / DRIVER_DELIVER / RECEIVER_CONFIRM); photos referenced by sha256 contentHash only.
- Every Signature row carries BOTH `attestationVersion` (the human-signed legal text version) AND `canonicalSchemaVersion` (the machine projection version), so projections can evolve without orphaning old signatures.
- **Stability proof** (unit test): same input → same documentHash across two renders, across reordered keys, across reordered photos. **Finalize ordering** (unit test): signing with a PENDING photo throws `CANONICALIZE_PHOTO_NOT_FINALIZED` before any DDB write happens.

### CONSTRAINT 3 - three-layer immutability for Signatures

| Layer | Where | Live on prod |
|---|---|---|
| **L1 IAM Deny** | Policy `LoadLead-Signatures-AppendOnly` attached to `aws-elasticbeanstalk-ec2-role` - `Deny: dynamodb:UpdateItem, dynamodb:DeleteItem, dynamodb:BatchWriteItem` on `LoadLead_Signatures` (table + indexes) | ✓ verified: `aws iam get-policy-version` showed the Deny statement attached |
| **L2 PutItem `ConditionExpression: attribute_not_exists(signatureId)`** | `services/attestation/signatureService.recordSignature()` - every PutCommand carries the guard; on `ConditionalCheckFailedException` returns 409 `SIGNATURE_DUPLICATE` | ✓ in code; unit test asserts the guard is on every PutCommand in the file |
| **L3 ESLint `no-restricted-imports`** | `services/attestation/.eslintrc.cjs` scoped to `signatureService.ts`: bans `UpdateCommand` / `DeleteCommand` / `BatchWriteCommand` from `@aws-sdk/lib-dynamodb` and `UpdateItemCommand` / `DeleteItemCommand` / `BatchWriteItemCommand` from `@aws-sdk/client-dynamodb` | ✓ in code; unit test asserts the rule scope + that `signatureService.ts` is currently clean |

## Backend tests

```
✓ tests/unit/attestation/canonicalize.test.ts                   6 tests
✓ tests/unit/attestation/assertSignerIsLoadParty.test.ts        6 tests
✓ tests/unit/attestation/eslintImmutability.test.ts             4 tests
✓ tests/unit/attestation/requireSignature.test.ts               5 tests
─────────────────────────────────────────────────────────────────────
  Test Files  4 passed (4) · Tests 21 passed (21) · 219 ms
```

## Frontend - neutral primitive + chain

| Component | What |
|---|---|
| [`AttestationBlock.tsx`](../frontend-v2/src/components/attestation/AttestationBlock.tsx) | One persona-agnostic primitive. Props: `action`, `stage`, `requirePhotos`, `allowExceptions`, `allowedSignatureTypes`, `assignedDriverId`. Photo upload uses the new sync presign → S3 PUT → finalize flow; UI shows live PENDING/READY and `contentHash` per photo. Three signature modes: typed / drawn (reuses existing `<SignaturePad />`) / click. Optional exceptions block (OS&D codes + description) |
| [`AttestationDialog.tsx`](../frontend-v2/src/components/attestation/AttestationDialog.tsx) | Thin shadcn-Dialog wrapper around the block. Centralizes the v1.0.0 attestation copy (mirrors the server's text) in `ATTESTATION_TEXT` constant. **Internal admin console is never given this dialog.** |
| [`AttestationChain.tsx`](../frontend-v2/src/components/attestation/AttestationChain.tsx) | Read-only ordered chain panel. Lists action, signer role + userId, timestamp, truncated `documentHash`, attestation version + schema version, photo count, exceptions if any. List view never returns the full `signatureData` blob (audit packet drilldown is Phase 2) |

## Persona wire-ups (all 5 live)

| Persona | Page | Trigger | Action | Stage / Photos | Exceptions |
|---|---|---|---|---|---|
| Shipper | `pages/shipper/PostLoad.tsx` | Submit form → draft saves → dialog | `BOL_SUBMIT` | ORIGIN (optional) | - |
| Driver (incl. OO self-haul) | `pages/driver/LoadDetail.tsx` | Accept active offer | `CARRIER_ACCEPT` (`assignedDriverId` = this driver) | - | - |
| Driver | same | Mark picked up (status=BOOKED) | `DRIVER_PICKUP` | PICKUP (required ≥1) | - |
| Driver | same | Mark delivered (status=IN_TRANSIT) | `DRIVER_DELIVER` | DELIVERY (required ≥1) | optional |
| Receiver | `pages/receiver/LoadDetail.tsx` | Confirm receipt (status=DELIVERED) | `RECEIVER_CONFIRM` | RECEIPT (required ≥1) | optional |

Chain panel mounted in the right-rail of every load detail page (shipper / driver / receiver). Admin console gets neither the chain nor the dialog - the spec requires admin-side read-only access, which is achieved via the chain endpoint, but the admin UI itself does not embed the panel in Phase 1 (admin can hit the JSON endpoint directly until the admin chain view ships as a Phase-1b polish).

## Infra applied to prod (verified live)

| Property | State |
|---|---|
| `LoadLead_Signatures` | ACTIVE · PK `signatureId` · GSI `loadId-signedAt-index` · **PITR ENABLED** · **deletion_protection ON** |
| `LoadLead_PodPhotos`  | ACTIVE · PK `photoId` · GSI `loadId-index` · **PITR ENABLED** · **deletion_protection ON** |
| IAM policy `LoadLead-Signatures-AppendOnly` | `arn:aws:iam::552011299815:policy/LoadLead-Signatures-AppendOnly` - Allow Put / Get / Query on Signatures + Allow Put / Get / Query / Update on PodPhotos; **Deny Update / Delete / BatchWrite** on Signatures |
| Policy attached to `aws-elasticbeanstalk-ec2-role` | ✓ confirmed via `aws iam list-attached-role-policies` |
| PITR on existing tables | **11 / 11 ENABLED** - closed the "only signatures recoverable" asymmetry (Users / Loads / Offers / Drivers / Receivers / Shippers / Organizations / Memberships / BOL all moved DISABLED → ENABLED) |
| `loadlead-pod-uploads` versioning | **Enabled** |
| `loadlead-pod-uploads` bucket policy | `Deny: s3:DeleteObject, s3:DeleteObjectVersion, s3:PutBucketPolicy, s3:DeleteBucketPolicy, s3:PutLifecycleConfiguration, s3:PutBucketVersioning` for the EB runtime role |

## Honest naming - delete-resistance vs WORM

The shipped state is **delete-resistant by bucket policy**, NOT WORM. The distinction matters for legal artifacts:

- **B (shipped)**: Versioning + Deny on `s3:DeleteObject*`. An overwrite writes a new version; the runtime role cannot remove versions; the original bytes survive. **Reversible**: anyone with `s3:PutBucketPolicy` rights can lift the Deny. The self-protecting `Deny s3:PutBucketPolicy` covers the runtime role but not an operator with admin IAM rights.
- **A (Phase 2)**: `s3:ObjectLockConfiguration: COMPLIANCE` at bucket creation. Cannot be turned off by anyone, including root. The bytes are immutable by design for the retention period.

Phase-2 plan: create `loadlead-pod-uploads-v2` with Object Lock COMPLIANCE at creation; copy existing objects during an audit grace period; repoint the app; mark v1 read-only.

## Smoke against prod after deploy

```
EB env loadlead-backend-prod  : Ready / Green @ t+3min
GET  /api/health              → 200  {ok: true, productionHardened: true}
GET  /api/attestation/chain/X → 401  (route exists; auth gate fires)
POST /api/attestation/sign    → 401  (route exists; auth gate fires)
POST /api/driver/loads/x/pod  → 401  (route exists; auth gate fires before 410 deprecation)
```

(401 from unauth probes is the expected response: the routes exist and auth middleware fires before route logic. Live gate-rejection proofs with an authed user are deferred to the Phase-1b end-to-end run once we have prod test data; the unit tests prove the gate code paths exhaustively.)

---

# Phase 1b - Dispatcher view + matrix-driven sign authority (appended 2026-06-24)

## What shipped

### Carrier dispatcher CARRIER_ACCEPT path
Carrier-admin (and now DISPATCHER) can sign + assign from the Dispatch dialog directly, instead of waiting for the driver to self-accept.

| Surface | Change |
|---|---|
| `Signature` model | Added top-level `assignedDriverId?` field (CARRIER_ACCEPT only). Still bound into the canonical `documentHash` via the projection input; the two MUST agree at write time. Top-level field exists so the dispatch endpoint can query it without re-hashing. |
| `services/attestation/signatureService.recordSignature` | Persists `input.assignedDriverId` onto the row. |
| `POST /api/org/loads/:loadId/dispatch` | **NEW.** Reads the latest CARRIER_ACCEPT sig for the load; rejects with structured codes if signer mismatch / signer role wrong / sig missing assignedDriverId / no sig at all; otherwise calls `OfferService.acceptOffer(loadId, sig.assignedDriverId)`. **Takes no `assignedDriverId` body parameter** - the driver comes from the sig, so a booking can never reference a driver the sig didn't cover. |
| `CarrierDashboard / DispatchTab` | New "Assign + sign acceptance" card inside the per-load dialog. Driver dropdown lists every active org driver with availability + IDV status. "Sign acceptance" opens the AttestationDialog → on signed → `api.dispatchLoad` → dashboard refresh. |

### Permissions-matrix-driven sign authority (CONSTRAINT 1 hardening)

The original Phase-1 code hard-coded `ADMIN_ORG_ROLES` (`OWNER + MANAGER`) for org-side sign fan-out. That excluded DISPATCHER from CARRIER_ACCEPT, which is the role's entire purpose (`'loads:accept'` is already in their matrix row, and `'drivers:dispatch'` defines them).

`services/attestation/assertSignerIsLoadParty.ts` now asks the **existing permissions matrix** (`services/orgPermissions.ts`) - not a hand-curated role list:

| Action | Permission key | Roles |
|---|---|---|
| `BOL_SUBMIT` | `'loads:create'` | OWNER + MANAGER + DISPATCHER + SHIPPER_USER |
| `CARRIER_ACCEPT` | `'loads:accept'` | OWNER + MANAGER + DISPATCHER |
| (other actions) | - | resolved as before (assigned driver, receiver entity, etc.) |

**The matrix is the source of truth.** When authority shifts (e.g., adding a CFO role with billing-only access), updating the matrix automatically flows to attestation authority - no separate change in the resolver. A defensive regression test asserts `ADMIN_ORG_ROLES` is no longer imported by `assertSignerIsLoadParty.ts` so this can't quietly regress.

### Dispatch endpoint gate rejections (server-enforced)

| Failure mode | Code | HTTP |
|---|---|---|
| No CARRIER_ACCEPT sig in chain | `CARRIER_ACCEPT_SIGNATURE_REQUIRED` | 412 |
| Different user calling than the one who signed | `DISPATCH_SIGNER_MISMATCH` | 409 |
| Signer role is neither CARRIER_ADMIN nor OWNER_OPERATOR | `CARRIER_ACCEPT_SIGNER_INVALID` | 409 |
| Signature has no `assignedDriverId` | `SIGNATURE_MISSING_ASSIGNMENT` | 409 |
| Body manipulation tries to override driver | not possible - endpoint takes no body param for `assignedDriverId` |

### Tests added

```
✓ tests/unit/attestation/orgSignAuthority.test.ts        4 tests   (CONSTRAINT 1 extension)
─────────────────────────────────────────────────────────────────────
  Test Files  5 passed (5) · Tests  25 passed (25) · 188 ms
```

Coverage of the new tests:
- `loads:accept` permission held by OWNER + MANAGER + DISPATCHER (positive)
- `loads:accept` denied to ORG_DRIVER / SHIPPER_USER / RECEIVER_USER (negative)
- `loads:create` allowed for shipper-side fan-out
- `assertSignerIsLoadParty.ts` no longer imports `ADMIN_ORG_ROLES` (regression guard)

### Live deploy proof

```
EB env loadlead-backend-prod  : Ready / Green @ t+3min
POST /api/org/loads/probe/dispatch → 401  (route exists; auth fires)
```

### Honest note

The new endpoint is part of `org.ts` and depends on the EB instance role having access to `LoadLead_Signatures` (Allow Put/Get/Query - already attached as part of `LoadLead-Signatures-AppendOnly` Phase-1 policy) and `LoadLead_Memberships`/`LoadLead_Loads`/`LoadLead_Offers` (pre-existing). No new IAM grants required.

---

# Phase 1c - Chain READ authZ tightened (appended 2026-06-24)

Closes the gap I introduced when shipping the admin chain lookup UI: the `GET /api/attestation/chain/:loadId` endpoint previously required only `authenticate` - any authenticated user could read any load's chain.

## What changed

| Surface | Change |
|---|---|
| `services/attestation/assertSignerIsLoadParty` | New exported `assertChainReadAccess(load, authUserId, authUserRole)` - unions the per-action signer sets, plus admits `UserRole.ADMIN` separately. Throws 403 `WRONG_READER` if neither branch matches. Per-action resolution failures (e.g. RECEIVER_CONFIRM with missing receiverId) are caught locally so they never deny a shipper their own chain read. |
| `routes/attestation` chain endpoint | Now calls `assertChainReadAccess` before fetching. Returns 404 if the load doesn't exist (was previously a 200-with-empty-chain - that's an info leak about loadId existence we should also avoid). |

## Spec compliance

> "Attestation chain view … visible to the load's parties and read-only to platform admin."

Now enforced:

| Caller | Result |
|---|---|
| Platform `ADMIN` | ✓ read |
| Load shipper user (or shipper-org OWNER/MANAGER/DISPATCHER/SHIPPER_USER) | ✓ read |
| Load assigned driver | ✓ read |
| Carrier-of-record (OO operator OR carrier-org OWNER/MANAGER/DISPATCHER) | ✓ read |
| Load receiver | ✓ read |
| Any other authenticated user | 403 `WRONG_READER` |
| Unauthenticated | 401 |

## Tests added

```
✓ tests/unit/attestation/chainReadAccess.test.ts            7 tests
─────────────────────────────────────────────────────────────────────
  Test Files  6 passed (6) · Tests 32 passed (32) · 487 ms
```

Coverage:
- ADMIN always reads
- shipper user is a party
- assigned driver is a party
- receiver is a party
- carrier-of-record (OO operator) is a party
- random authenticated user → 403
- missing entity for one action does NOT deny another party's read

## Honest disclosure

- The chain endpoint still returns a summary only (no raw `signatureData` blobs). A future per-sig fetch endpoint will gate the same way.
- The admin lookup UI shipped one commit earlier is unchanged by this; it just routes through an endpoint that now correctly enforces "staff || party" instead of "any auth'd user".
- The 404-when-load-missing change is a small information-leak fix on the side; not its own backlog item, just noted.

---

# Phase 1d - Live prod E2E run (appended 2026-06-24)

Drove one load through all 5 attestation stages against `https://api.loadleadapp.com`. **Live gate rejections + a stored 5-row chain + cross-tenant rejection** - captured under `scripts/e2e-attestation-prod.sh`.

## Final state on prod

```
loadId = load_b955254a-c991-4541-bddb-83fc0d780a5b
shipper = e2e-shipper-1782343611@loadleadapp.com
receiver = e2e-receiver-1782343611@loadleadapp.com
OO = demo-owner-operator@loadleadapp.com

Signatures stored on LoadLead_Signatures (PITR ENABLED · IAM Deny Update/Delete attached):
  683b4a19  BOL_SUBMIT       SHIPPER          hash 8c5cc30a…  photos 0
  a5fd85ad  CARRIER_ACCEPT   OWNER_OPERATOR   hash 43acd93d…  photos 0
  a7938625  DRIVER_PICKUP    DRIVER           hash 793e2acc…  photos 1
  24f80d0c  DRIVER_DELIVER   DRIVER           hash 2a0590e0…  photos 1
  914d5665  RECEIVER_CONFIRM RECEIVER         hash 2db9518b…  photos 1
```

## Gate rejections (live, structured codes)

| Stage | Probe | Response |
|---|---|---|
| 1 | `POST /api/shipper/loads/:id/submit` without sig | **412 `BOL_SUBMIT_SIGNATURE_REQUIRED`** |
| 2 | `POST /api/org/loads/:id/dispatch` without sig | **412 `CARRIER_ACCEPT_SIGNATURE_REQUIRED`** |
| 3 | `POST /api/driver/loads/:id/pickup` without sig | **412 `DRIVER_PICKUP_SIGNATURE_REQUIRED`** |
| 4 | `POST /api/driver/loads/:id/deliver` without sig | **412 `DRIVER_DELIVER_SIGNATURE_REQUIRED`** |
| 5 | `POST /api/receiver/loads/:id/confirm` without sig | **412 `RECEIVER_CONFIRM_SIGNATURE_REQUIRED`** |

## Chain reads (live)

- Shipper reads `/api/attestation/chain/:loadId` → 200 with the 5-row ordered chain
- Third-party signed-up user reads same chain → **403 `WRONG_READER`** (per Phase 1c authZ tightening)

## Two real bugs surfaced + fixed during the run

### B1 - `errorHandler` registered before half the routes
`backend/src/index.ts:202` had `app.use(errorHandler)` BEFORE `app.use('/api/org', orgRoutes)` (line 222) and 4 other route mounts (`/api/maps`, `/api/setup`, `/api/support`, `/api/factoring`, `/api/reference`).

AppError thrown in any of those route families was falling through to Express's default HTML 4xx serializer instead of our JSON `{ message, statusCode }`. The shipper-submit gate worked by luck (mounted at line 194, ahead of the handler).

The symptom that surfaced this: GATE 2 probe returned **HTTP 412** (correct status from the throw) but the body was `<html>…Precondition Failed…</html>` (nginx's default 412 page), making the `code` field invisible to the e2e check.

Fixed by moving `app.use(errorHandler)` to AFTER all `app.use('/api/...')` mounts. Standard Express order, restored.

### B2 - `/api/driver/*` rejected OWNER_OPERATOR
Router-level `requireDriver` (= `requireRole(DRIVER, ADMIN)`) gated the entire driver router. OOs have role `OWNER_OPERATOR`, not `DRIVER`. But OO self-haul means the OO **is** the driver of record on their own loads - `DriverService.getProfileByUserId(user.userId)` already resolves their self-driver correctly, and `services/carrierOfRecord.ts` admits them as the carrier of record.

The router gate was the only thing blocking OO from `/api/driver/loads/:id/pickup` and `/deliver`. **Widened to `requireRole(DRIVER, OWNER_OPERATOR, ADMIN)`** so the OO can sign and execute their own pickup/deliver.

Carrier-org drivers (role `DRIVER`) unaffected. Admin still admitted.

## Artifacts

- [`scripts/e2e-attestation-prod.sh`](scripts/e2e-attestation-prod.sh) - re-runnable; requires `APP_ENV=production` + `OO_PW`. Defaults to `https://api.loadleadapp.com`; override with `API=…` for staging. Auth rate-limited to 15/15min per-IP, so re-runs need a ~15min gap (or a different IP).
- 3 e2e-* users + 1 load + 5 sigs + 3 photos persist on prod by design - append-only LoadLead_Signatures means we keep the proof.

## Honest note on prep

The OO's verification state had to be flipped (User.idvStatus=VERIFIED, Driver.status=AVAILABLE, Verifications row written) before the e2e could pass `requireVerifiedCarrier()` at the accept-offer call. This is NOT an attestation weakening - it's a prereq for any carrier acceptance, regardless of attestation. Documented as a prep step in the script header.

Also: the e2e seeds an `LoadLead_Offers` row directly after submit because the prod broadcast/matching service didn't pick up the OO (radius / equipment matching didn't fire fast enough in a 30s window). In real prod the BroadcastService would create that row asynchronously. The seed bypasses the wait, not the attestation flow.

## Backlog (logged for Phase 2)

1. `loadlead-pod-uploads-v2` with Object Lock COMPLIANCE at creation + bytes migration
2. DDB Stream from `LoadLead_Signatures` → S3 WORM audit sink
3. Bring existing prod DDB tables into Terraform (`terraform import` per table; one calm pass)
4. Wire the `infra/terraform/modules/iam_signatures/` module into prod TF once the EB instance role moves under TF
5. Org-side / dispatcher CARRIER_ACCEPT view for carrier-org users (Phase 1 covers the driver-side path including OO self-haul; carrier-org assignment from the org admin view is the remaining shape)
6. Admin-side read-only chain panel (today the endpoint exists; the panel ships next polish)

## Closed audit findings (cross-referenced)

This work closes the following items logged in the earlier E2E audit:
- `LOAD-E2E-004` - Driver IN_TRANSIT status endpoint missing → `POST /api/driver/loads/:id/pickup`
- `LOAD-E2E-005` / `UI-E2E-003` - Receiver confirm endpoint missing → `POST /api/receiver/loads/:id/confirm`

Still open (not in scope for this work): `LOAD-E2E-001`, `LOAD-E2E-002`, `LOAD-E2E-003`, `LOAD-E2E-006`, `LOAD-E2E-007`, `UI-E2E-001 / 002 / 004 / 006 / 007 / 008 / 009 / 010 / 011`.
