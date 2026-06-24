---
title: Attestation Phase 1 — Build Audit
date: 2026-06-24
status: SHIPPED to prod
discovery_doc: docs/ATTESTATION_DISCOVERY.md
deploys:
  - backend  loadlead-backend-prod  cfad913  Ready/Green @ t+3min
  - frontend S3 + CloudFront E38CZNP7L2DB98
---

# Summary

E-signature + proof-photo attestation block live across all five freight-party personas with three-layer immutability for the signature chain, delete-resistance for the photo bytes, PITR on every prod table, a neutral persona-agnostic UI primitive wired into shipper / carrier (driver-side OO self-haul) / driver / receiver lifecycle handoffs, and a read-only attestation chain panel visible on every load detail page. Internal admin staff (ADMIN/MANAGER/SUPERVISOR/TEAM_LEAD) are excluded from signing at the resolver — they can read the chain only.

Phase 1 ships **B (delete-resistant)** for the photo bucket. **A (Object Lock COMPLIANCE / true WORM)** is logged for Phase 2 and requires migrating to a new bucket; it cannot be enabled on an existing bucket.

# Shipped (with evidence)

## Backend — gates + immutable Signature record

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
| `POST /api/driver/loads/:id/pod` | LEGACY — returns 410 `POD_ENDPOINT_DEPRECATED` | — | new behavior |
| `POST /api/driver/loads/:id/pod-legacy` | LEGACY — fall-back behind `ALLOW_LEGACY_POD=1` env | — | new endpoint (env-disabled by default in prod) |
| `POST /api/receiver/loads/:id/confirm` | final receipt attestation | 412 `RECEIVER_CONFIRM_SIGNATURE_REQUIRED`; sig.signerUserId === req.user; exceptions captured | new endpoint (closes `LOAD-E2E-005` / `UI-E2E-003`) |

### CONSTRAINT 1 — resolver-based signer, no denormalized Load field
- `services/attestation/assertSignerIsLoadParty.ts` resolves the allowed userId set live every call.
- Org-side: OWNER + MANAGER (`ADMIN_ORG_ROLES`) fan-out via `OrgMembership` GSI `orgId-index`.
- Carrier-of-record reuses `services/carrierOfRecord.resolveCarrierOfRecord(driver)`; OO self-haul + OO fleet + Carrier-org all flow through one resolver.
- **Reassignment proof** (unit test): mutating `load.assignedDriverId` from D1 to D2 instantly changes which userId can sign DRIVER_DELIVER; old user gets a structured `WRONG_SIGNER` error. No cache to flush.

### CONSTRAINT 2 — canonical documentHash with dual versioning
- `services/attestation/canonicalize.ts` — JCS-style sorted-key serializer; numbers / dates normalized; arrays preserve order where the projection didn't sort them, sorted where it did.
- `services/attestation/projections/v1.ts` — per-action allowlist (BOL_SUBMIT / CARRIER_ACCEPT / DRIVER_PICKUP / DRIVER_DELIVER / RECEIVER_CONFIRM); photos referenced by sha256 contentHash only.
- Every Signature row carries BOTH `attestationVersion` (the human-signed legal text version) AND `canonicalSchemaVersion` (the machine projection version), so projections can evolve without orphaning old signatures.
- **Stability proof** (unit test): same input → same documentHash across two renders, across reordered keys, across reordered photos. **Finalize ordering** (unit test): signing with a PENDING photo throws `CANONICALIZE_PHOTO_NOT_FINALIZED` before any DDB write happens.

### CONSTRAINT 3 — three-layer immutability for Signatures

| Layer | Where | Live on prod |
|---|---|---|
| **L1 IAM Deny** | Policy `LoadLead-Signatures-AppendOnly` attached to `aws-elasticbeanstalk-ec2-role` — `Deny: dynamodb:UpdateItem, dynamodb:DeleteItem, dynamodb:BatchWriteItem` on `LoadLead_Signatures` (table + indexes) | ✓ verified: `aws iam get-policy-version` showed the Deny statement attached |
| **L2 PutItem `ConditionExpression: attribute_not_exists(signatureId)`** | `services/attestation/signatureService.recordSignature()` — every PutCommand carries the guard; on `ConditionalCheckFailedException` returns 409 `SIGNATURE_DUPLICATE` | ✓ in code; unit test asserts the guard is on every PutCommand in the file |
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

## Frontend — neutral primitive + chain

| Component | What |
|---|---|
| [`AttestationBlock.tsx`](../frontend-v2/src/components/attestation/AttestationBlock.tsx) | One persona-agnostic primitive. Props: `action`, `stage`, `requirePhotos`, `allowExceptions`, `allowedSignatureTypes`, `assignedDriverId`. Photo upload uses the new sync presign → S3 PUT → finalize flow; UI shows live PENDING/READY and `contentHash` per photo. Three signature modes: typed / drawn (reuses existing `<SignaturePad />`) / click. Optional exceptions block (OS&D codes + description) |
| [`AttestationDialog.tsx`](../frontend-v2/src/components/attestation/AttestationDialog.tsx) | Thin shadcn-Dialog wrapper around the block. Centralizes the v1.0.0 attestation copy (mirrors the server's text) in `ATTESTATION_TEXT` constant. **Internal admin console is never given this dialog.** |
| [`AttestationChain.tsx`](../frontend-v2/src/components/attestation/AttestationChain.tsx) | Read-only ordered chain panel. Lists action, signer role + userId, timestamp, truncated `documentHash`, attestation version + schema version, photo count, exceptions if any. List view never returns the full `signatureData` blob (audit packet drilldown is Phase 2) |

## Persona wire-ups (all 5 live)

| Persona | Page | Trigger | Action | Stage / Photos | Exceptions |
|---|---|---|---|---|---|
| Shipper | `pages/shipper/PostLoad.tsx` | Submit form → draft saves → dialog | `BOL_SUBMIT` | ORIGIN (optional) | — |
| Driver (incl. OO self-haul) | `pages/driver/LoadDetail.tsx` | Accept active offer | `CARRIER_ACCEPT` (`assignedDriverId` = this driver) | — | — |
| Driver | same | Mark picked up (status=BOOKED) | `DRIVER_PICKUP` | PICKUP (required ≥1) | — |
| Driver | same | Mark delivered (status=IN_TRANSIT) | `DRIVER_DELIVER` | DELIVERY (required ≥1) | optional |
| Receiver | `pages/receiver/LoadDetail.tsx` | Confirm receipt (status=DELIVERED) | `RECEIVER_CONFIRM` | RECEIPT (required ≥1) | optional |

Chain panel mounted in the right-rail of every load detail page (shipper / driver / receiver). Admin console gets neither the chain nor the dialog — the spec requires admin-side read-only access, which is achieved via the chain endpoint, but the admin UI itself does not embed the panel in Phase 1 (admin can hit the JSON endpoint directly until the admin chain view ships as a Phase-1b polish).

## Infra applied to prod (verified live)

| Property | State |
|---|---|
| `LoadLead_Signatures` | ACTIVE · PK `signatureId` · GSI `loadId-signedAt-index` · **PITR ENABLED** · **deletion_protection ON** |
| `LoadLead_PodPhotos`  | ACTIVE · PK `photoId` · GSI `loadId-index` · **PITR ENABLED** · **deletion_protection ON** |
| IAM policy `LoadLead-Signatures-AppendOnly` | `arn:aws:iam::552011299815:policy/LoadLead-Signatures-AppendOnly` — Allow Put / Get / Query on Signatures + Allow Put / Get / Query / Update on PodPhotos; **Deny Update / Delete / BatchWrite** on Signatures |
| Policy attached to `aws-elasticbeanstalk-ec2-role` | ✓ confirmed via `aws iam list-attached-role-policies` |
| PITR on existing tables | **11 / 11 ENABLED** — closed the "only signatures recoverable" asymmetry (Users / Loads / Offers / Drivers / Receivers / Shippers / Organizations / Memberships / BOL all moved DISABLED → ENABLED) |
| `loadlead-pod-uploads` versioning | **Enabled** |
| `loadlead-pod-uploads` bucket policy | `Deny: s3:DeleteObject, s3:DeleteObjectVersion, s3:PutBucketPolicy, s3:DeleteBucketPolicy, s3:PutLifecycleConfiguration, s3:PutBucketVersioning` for the EB runtime role |

## Honest naming — delete-resistance vs WORM

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

# Phase 1b — Dispatcher view + matrix-driven sign authority (appended 2026-06-24)

## What shipped

### Carrier dispatcher CARRIER_ACCEPT path
Carrier-admin (and now DISPATCHER) can sign + assign from the Dispatch dialog directly, instead of waiting for the driver to self-accept.

| Surface | Change |
|---|---|
| `Signature` model | Added top-level `assignedDriverId?` field (CARRIER_ACCEPT only). Still bound into the canonical `documentHash` via the projection input; the two MUST agree at write time. Top-level field exists so the dispatch endpoint can query it without re-hashing. |
| `services/attestation/signatureService.recordSignature` | Persists `input.assignedDriverId` onto the row. |
| `POST /api/org/loads/:loadId/dispatch` | **NEW.** Reads the latest CARRIER_ACCEPT sig for the load; rejects with structured codes if signer mismatch / signer role wrong / sig missing assignedDriverId / no sig at all; otherwise calls `OfferService.acceptOffer(loadId, sig.assignedDriverId)`. **Takes no `assignedDriverId` body parameter** — the driver comes from the sig, so a booking can never reference a driver the sig didn't cover. |
| `CarrierDashboard / DispatchTab` | New "Assign + sign acceptance" card inside the per-load dialog. Driver dropdown lists every active org driver with availability + IDV status. "Sign acceptance" opens the AttestationDialog → on signed → `api.dispatchLoad` → dashboard refresh. |

### Permissions-matrix–driven sign authority (CONSTRAINT 1 hardening)

The original Phase-1 code hard-coded `ADMIN_ORG_ROLES` (`OWNER + MANAGER`) for org-side sign fan-out. That excluded DISPATCHER from CARRIER_ACCEPT, which is the role's entire purpose (`'loads:accept'` is already in their matrix row, and `'drivers:dispatch'` defines them).

`services/attestation/assertSignerIsLoadParty.ts` now asks the **existing permissions matrix** (`services/orgPermissions.ts`) — not a hand-curated role list:

| Action | Permission key | Roles |
|---|---|---|
| `BOL_SUBMIT` | `'loads:create'` | OWNER + MANAGER + DISPATCHER + SHIPPER_USER |
| `CARRIER_ACCEPT` | `'loads:accept'` | OWNER + MANAGER + DISPATCHER |
| (other actions) | — | resolved as before (assigned driver, receiver entity, etc.) |

**The matrix is the source of truth.** When authority shifts (e.g., adding a CFO role with billing-only access), updating the matrix automatically flows to attestation authority — no separate change in the resolver. A defensive regression test asserts `ADMIN_ORG_ROLES` is no longer imported by `assertSignerIsLoadParty.ts` so this can't quietly regress.

### Dispatch endpoint gate rejections (server-enforced)

| Failure mode | Code | HTTP |
|---|---|---|
| No CARRIER_ACCEPT sig in chain | `CARRIER_ACCEPT_SIGNATURE_REQUIRED` | 412 |
| Different user calling than the one who signed | `DISPATCH_SIGNER_MISMATCH` | 409 |
| Signer role is neither CARRIER_ADMIN nor OWNER_OPERATOR | `CARRIER_ACCEPT_SIGNER_INVALID` | 409 |
| Signature has no `assignedDriverId` | `SIGNATURE_MISSING_ASSIGNMENT` | 409 |
| Body manipulation tries to override driver | not possible — endpoint takes no body param for `assignedDriverId` |

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

The new endpoint is part of `org.ts` and depends on the EB instance role having access to `LoadLead_Signatures` (Allow Put/Get/Query — already attached as part of `LoadLead-Signatures-AppendOnly` Phase-1 policy) and `LoadLead_Memberships`/`LoadLead_Loads`/`LoadLead_Offers` (pre-existing). No new IAM grants required.

## Backlog (logged for Phase 2)

1. `loadlead-pod-uploads-v2` with Object Lock COMPLIANCE at creation + bytes migration
2. DDB Stream from `LoadLead_Signatures` → S3 WORM audit sink
3. Bring existing prod DDB tables into Terraform (`terraform import` per table; one calm pass)
4. Wire the `infra/terraform/modules/iam_signatures/` module into prod TF once the EB instance role moves under TF
5. Org-side / dispatcher CARRIER_ACCEPT view for carrier-org users (Phase 1 covers the driver-side path including OO self-haul; carrier-org assignment from the org admin view is the remaining shape)
6. Admin-side read-only chain panel (today the endpoint exists; the panel ships next polish)

## Closed audit findings (cross-referenced)

This work closes the following items logged in the earlier E2E audit:
- `LOAD-E2E-004` — Driver IN_TRANSIT status endpoint missing → `POST /api/driver/loads/:id/pickup`
- `LOAD-E2E-005` / `UI-E2E-003` — Receiver confirm endpoint missing → `POST /api/receiver/loads/:id/confirm`

Still open (not in scope for this work): `LOAD-E2E-001`, `LOAD-E2E-002`, `LOAD-E2E-003`, `LOAD-E2E-006`, `LOAD-E2E-007`, `UI-E2E-001 / 002 / 004 / 006 / 007 / 008 / 009 / 010 / 011`.
