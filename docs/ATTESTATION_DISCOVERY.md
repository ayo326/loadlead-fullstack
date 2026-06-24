---
title: E-Signature + Proof-Photo Attestation — Phase 0 Discovery
date: 2026-06-24
revised: 2026-06-24 (against the expanded scope: resolver / canonical hash / data-layer immutability)
status: DISCOVERY ONLY — gate per the build prompt
build_locked: true
---

# TL;DR

A partial signature + POD system **already exists** (BOL flow: shipper, driver, receiver). It is **not ESIGN/UETA-grade**, it does not gate the lifecycle, and it is wired to the **`BillOfLading` record**, not the **`Load`**, which the rest of the lifecycle drives off. There are also **two parallel POD paths** — a per-load `podSignature`/`podPhotoKey` field set by the driver, and a per-BOL `podPhotos[]` array — that need to be reconciled before we layer a real attestation chain on top.

Headline: this is largely an **EXTEND**, not a **BUILD-NEW**. Reuse the existing `SignaturePad` + presigned-URL uploader; build a new immutable `Signature` record (separate from `BOLSignature`), build the gates, and resolve the two POD code paths.

---

# What exists today (with evidence)

## A. Photo upload — single uploader, single bucket

- **S3 bucket**: `loadlead-pod-uploads` (`backend/src/routes/driver.ts:21` reads `POD_S3_BUCKET`)
- **Presigned-URL endpoint**: `POST /api/driver/loads/:loadId/pod/upload-url` ([driver.ts:184](backend/src/routes/driver.ts:184)) — returns `{ uploadUrl, key, publicUrl }`; client uploads direct to S3
- **Headshot reuses the same shape**: `POST /api/driver/headshot/upload-url` ([driver.ts:169](backend/src/routes/driver.ts:169))
- **Frontend client wrapper**: `api.getPodUploadUrl()` / `api.submitPOD()` in [`frontend-v2/src/lib/api.ts:206-207`](frontend-v2/src/lib/api.ts:206)
- **Photo type** (the thing that ends up on the BOL):
  ```ts
  // backend/src/types/index.ts:733
  export interface PodPhoto {
    key: string;         // S3 key in loadlead-pod-uploads
    capturedAt: string;  // ISO 8601
    lat?: number;
    lng?: number;
  }
  ```

## B. POD recording — there are TWO paths today (conflict)

### Path 1 — driver `pod` endpoint (Load-scoped)
`POST /api/driver/loads/:loadId/pod` ([driver.ts:198](backend/src/routes/driver.ts:198)) writes to the **Load** record:
```ts
podPhotoKey   // single key (not an array)
podSignature  // base64 PNG, no signer identity attached
podNotes
podSubmittedAt
podDriverId
status: 'DELIVERED'  // auto-marks delivered in the same call
```

### Path 2 — BOL `sign` endpoint (BOL-scoped)
`POST /api/bol/:bolId/sign` ([bol.ts:106](backend/src/routes/bol.ts:106)) writes to the **BillOfLading** record. The BOL has its own status enum and three signature slots: `shipperSignature`, `carrierSignature`, `consigneeSignature` (each a `BOLSignature`).

`BOLSignature` shape ([types/index.ts:761](backend/src/types/index.ts:761)):
```ts
{ signedBy: string; signatureData: string; signedAt: ISO; location?: string; ipAddress?: string; }
```
Driver signs as 'DRIVER' (carrier role on the BOL); receiver signs as 'RECEIVER'. **Shipper is ALSO allowed by the model, but the route REJECTS SHIPPER role today** ([bol.ts:118](backend/src/routes/bol.ts:118)): `"Only Driver or Receiver can sign a BOL"`.

### Why this matters
- The `Load` status is the lifecycle clients track. The `BillOfLading` status (`DRAFT|ISSUED|PICKED_UP|IN_TRANSIT|DELIVERED|DISPUTED`) is a parallel state machine **not bound to the Load** transitions.
- A driver who calls `/api/driver/loads/:id/pod` flips **Load.status** to `DELIVERED` but does NOT touch the BOL, so `BOLService.assertPodComplete()` (which requires `bol.consigneeSignature` AND `bol.podPhotos.length >= MIN_POD_PHOTOS`) can still fail — meaning factoring can be blocked despite the Load showing delivered.
- The two POD photo stores diverge: `load.podPhotoKey` (singular) vs `bol.podPhotos[]` (array). No upload path writes to both.

## C. POD gate already exists — but only on the BOL path

`backend/src/services/pod.ts` `assertPodComplete(loadId)` ([pod.ts:1-…](backend/src/services/pod.ts:1)) is real and gates factoring (per `IMPLEMENTATION.md §9`). It checks:
1. `load.status === 'DELIVERED'`
2. `bol.consigneeSignature?.signedAt` exists
3. `bol.podPhotos.length >= MIN_POD_PHOTOS` (default 1)
4. Optional geofence within `POD_GEOFENCE_METERS` (default 1609 m) of `load.deliveryLat/Lng`

Used by `routes/factoring.ts`. **Not used by the lifecycle transitions themselves** — i.e. the driver's POD POST does not run this gate; the BOL's sign route does not run this gate either.

## D. Signature UI — already reusable

- `frontend-v2/src/components/SignaturePad.tsx` — draw-on-canvas signature primitive (single component)
- Used by `frontend-v2/src/pages/bol/BillOfLadingPage.tsx:88` to capture pickup + delivery signatures
- Returns a base64 PNG (`signatureData`)

No typed-signature mode, no consent checkbox, no attestation text rendered. The page collects only the signature and a `signedBy` string.

## E. Lifecycle today

`Load.status` enum ([types/index.ts:37](backend/src/types/index.ts:37)):
```
OPEN → BOOKED → IN_TRANSIT → DELIVERED   (only 4 states)
```
A second enum exists but is mostly unused: `LoadStatusV2 = TENDERED|ACCEPTED|DISPATCHED|IN_TRANSIT|DELIVERED|POD_RECEIVED|INVOICED` ([types/index.ts:690](backend/src/types/index.ts:690)).

Transition entry points:
| Action | Endpoint | Where set | Today's gates |
|---|---|---|---|
| Shipper submits load for broadcast | `POST /api/shipper/loads/:loadId/submit` ([shipper.ts:94](backend/src/routes/shipper.ts:94)) | `LoadService.submitLoad()` | **None.** No attestation. No consent. |
| Driver accepts offer (carrier-of-record gate) | `POST /api/driver/offers/:loadId/accept` ([driver.ts:111](backend/src/routes/driver.ts:111)) | `OfferService.acceptOffer()` → BOOKED | `requireVerifiedCarrier()` runs; **no signature**. |
| Driver records POD (path 1) | `POST /api/driver/loads/:loadId/pod` ([driver.ts:198](backend/src/routes/driver.ts:198)) | `LoadService.updateLoad({status: 'DELIVERED', podSignature, podPhotoKey})` | **None — accepts an empty body** (`req.body` deconstruct, no validation). |
| BOL signature (path 2) | `POST /api/bol/:bolId/sign` ([bol.ts:106](backend/src/routes/bol.ts:106)) | `BOLService.sign()` → BOL status moves DRAFT→ISSUED→PICKED_UP→DELIVERED | Only role check; signer identity == authenticated user is **not verified** against load/BOL ownership. |
| Receiver final confirm | **does not exist** | — | UI-E2E-003 finding from prior audit |
| Driver IN_TRANSIT update | **does not exist** | — | LOAD-E2E-004 finding from prior audit |

## F. Internal staff signing — already excluded by accident

Server gates on shipper/driver/receiver roles; ADMIN/MANAGER paths don't reach these routes via the permissions matrix. We still need to **make this explicit** in the new attestation gate so it's not just a side effect of routing.

---

# Stages captured today vs the prompt's required chain

| Required handoff | Required signature | Required photos | What exists | Gap |
|---|---|---|---|---|
| Shipper → BOL submit (broadcast) | **SHIPPER signs** | optional condition-at-origin | BOL model has `shipperSignature` slot, **but route rejects SHIPPER role**; submit endpoint takes none | **EXTEND**: add SHIPPER to BOL sign route; **BUILD**: wire BOL sign into `/api/shipper/loads/:id/submit` as a gate; **EXTEND**: PodPhoto already has `stage`-less keys — add `stage` field |
| Carrier/OO accept + assign | CARRIER_ADMIN / OWNER_OPERATOR signs | no photo | Acceptance route has zero signing | **BUILD**: signature gate on `POST /api/driver/offers/:id/accept` |
| Driver pickup | DRIVER signs (optional per prompt) | **pickup photos required** | Neither pickup signature nor pickup photos exist as a stage; BOL `carrierSignature` is conceptually pickup but isn't tied to a Load transition or to pickup photos | **BUILD**: pickup endpoint with signature + photos; **EXTEND**: `PodPhoto.stage` so the same uploader supports `ORIGIN | PICKUP | DELIVERY | RECEIPT` |
| Driver delivery | **DRIVER signs** | **delivery photos required** | Path 1: a single `podPhotoKey` + base64 signature, no consent, no document hash. Path 2: BOL `consigneeSignature` (set by RECEIVER, not driver). | **REPLACE** the path-1 POD endpoint with a real attestation gate; the existing photo uploader is reused as-is |
| Receiver final confirm | **RECEIVER signs** | **receipt photos required**, exceptions allowed | `bol.consigneeSignature` partially fills this; route exists but no receiver-side endpoint, no exceptions/damage path on the Load, no gate | **BUILD**: `POST /api/receiver/loads/:id/confirm` (closes UI-E2E-003 / LOAD-E2E-005) |

---

# Gap vs the prompt's spec

What the prompt requires that **does not exist anywhere today**:

| Requirement | State |
|---|---|
| Append-only `Signature` record keyed by `signatureId` | ❌ Today's sigs are embedded fields on the BOL or Load — mutable, overwritable |
| `signerUserId` + `signerRole` on the signature | ❌ `BOLSignature.signedBy` is a free-text name; no userId binding |
| `action` enum on the signature (`BOL_SUBMIT|CARRIER_ACCEPT|DRIVER_PICKUP|DRIVER_DELIVER|RECEIVER_CONFIRM`) | ❌ |
| `attestationText` + `attestationVersion` recorded with the sig | ❌ |
| `signatureType` (`typed|drawn|click`) | ❌ Only drawn |
| Explicit `consentGiven: true` (ESIGN/UETA intent + attribution) | ❌ |
| `documentHash` (hash of load/BOL state at signing) | ❌ |
| `proofPhotoIds[]` linkage from sig to its photos | ❌ |
| `ipAddress + userAgent` on every sig | ⚠ `BOLSignature.ipAddress` exists; userAgent does not |
| `exceptions` field for OS&D on delivery/receipt sigs | ⚠ `bol.deliveryExceptions` exists as free text; not tied to a signature record |
| `PodPhoto.stage` (`ORIGIN|PICKUP|DELIVERY|RECEIPT`) | ❌ Today's `PodPhoto` has `key + capturedAt + lat/lng` only |
| `PodPhoto.uploadedByUserId` + `contentHash` | ❌ |
| Server-side **gate** on broadcast (signature required) | ❌ submit has no gate |
| Server-side **gate** on accept (signature required) | ❌ accept has no gate |
| Server-side **gate** on pickup (photos required) | ❌ no endpoint |
| Server-side **gate** on delivery (photos + sig required) | ❌ POD endpoint accepts empty body |
| Server-side **gate** on receipt (photos + sig required) | ❌ no endpoint |
| Wrong-party rejection (signer == authenticated user with the right role **for this load**) | ❌ BOL sign route checks role enum but not "this user is THIS load's shipper/driver/receiver" |
| Ordered attestation chain view | ❌ BOL has a `timeline` but it's BOL-scoped, not the full chain across both records |

---

# Build plan — REUSE / EXTEND / BUILD-NEW

## REUSE (do not rewrite)
1. **S3 presigned-URL uploader** — `POST /api/driver/loads/:loadId/pod/upload-url` ([driver.ts:184](backend/src/routes/driver.ts:184)) is the only upload primitive we need. Same endpoint name, same response shape; we'll just route the resulting `key` into a richer `PodPhoto` record.
2. **`<SignaturePad />`** ([frontend-v2/src/components/SignaturePad.tsx](frontend-v2/src/components/SignaturePad.tsx)) — the draw-canvas UX is solid; new `<AttestationBlock />` consumes it as a child for `signatureType === 'drawn'`.
3. **`POD_BUCKET` env + AWS client setup** — already wired (`backend/src/routes/driver.ts:21-…`).
4. **`assertPodComplete()`** ([backend/src/services/pod.ts](backend/src/services/pod.ts)) — keep as the factoring gate; we'll **add a new `assertSignatureChainComplete()`** that calls it as one of its checks.

## EXTEND (modify in place)
1. **`PodPhoto` type** — add `stage: 'ORIGIN'|'PICKUP'|'DELIVERY'|'RECEIPT'`, `uploadedByUserId`, `contentHash`. ([backend/src/types/index.ts:733](backend/src/types/index.ts:733))
2. **`POST /api/driver/loads/:loadId/pod/upload-url`** — accept `stage` in the request body; route is unchanged but the resulting key is namespaced `pod/<stage>/<loadId>/<ts>.jpg` so the photos are bucketed by stage in S3.
3. **`BOL sign route`** — allow `SHIPPER` (currently rejected); enforce that `req.user.userId === load.shipperId` (or driver/receiver equivalents) before accepting.
4. **Permissions matrix** — extend to gate the new attestation endpoints; explicitly deny ADMIN/MANAGER/SUPERVISOR/TEAM_LEAD on every sign route so the exclusion is an explicit guard, not a coincidence of routing.
5. **`/api/driver/loads/:loadId/pod`** — rewrite this as the **delivery attestation gate** (path 1 collapses into the new chain; old field shape kept for back-compat read).

## BUILD-NEW
1. **`Signature` model** (append-only DDB table `LoadLead_Signatures`):
   ```ts
   {
     signatureId, loadId, bolId?,
     signerUserId, signerRole,
     action: 'BOL_SUBMIT'|'CARRIER_ACCEPT'|'DRIVER_PICKUP'|'DRIVER_DELIVER'|'RECEIVER_CONFIRM',
     attestationText: string, attestationVersion: string,
     signatureType: 'typed'|'drawn'|'click',
     signatureData: string,     // base64 PNG (drawn) or typed name or "I AGREE"
     consentGiven: boolean,     // must be true
     signedAt: ISO,
     ipAddress, userAgent,
     documentHash: string,      // SHA-256(canonical-JSON of relevant load+bol state)
     proofPhotoIds: string[],
     exceptions?: { code: 'OSD'|'DAMAGE'|'SHORT'|'OTHER', description: string },
     createdAt
   }
   ```
   Write-only after creation; never updated/deleted; a correction is a new record with `correctsSignatureId`.
2. **`AttestationService`**:
   - `requireSignature(loadId, action, userId, expectedRole)` — gate helper used by every transition route
   - `recordSignature(...)` — computes `documentHash`, persists, returns `signatureId`
   - `getChain(loadId)` — returns the ordered chain for the load detail view
3. **`AttestationStatement` versioned catalog** — file `backend/src/services/attestationStatements.ts` keyed by `action` + `version`. Update creates a new version, never overwrites.
4. **Transition gates**:
   - `/api/shipper/loads/:id/submit` → require `BOL_SUBMIT` signature (signer == load.shipperId)
   - `/api/driver/offers/:id/accept` → require `CARRIER_ACCEPT` signature (signer == accepting CARRIER_ADMIN or OWNER_OPERATOR for this load)
   - **NEW** `/api/driver/loads/:id/pickup` → require ≥1 pickup photo + `DRIVER_PICKUP` signature, signer == assigned driver
   - `/api/driver/loads/:id/pod` (REWRITTEN) → require ≥1 delivery photo + `DRIVER_DELIVER` signature, signer == assigned driver
   - **NEW** `/api/receiver/loads/:id/confirm` → require ≥1 receipt photo + `RECEIVER_CONFIRM` signature, signer == load.receiverId (closes UI-E2E-003 / LOAD-E2E-005)
5. **`<AttestationBlock />`** (frontend) — neutral primitive:
   - Props: `action`, `loadId`, `attestationText`, `attestationVersion`, `allowedSignatureTypes`, `requirePhotos`, `stage`, `onSigned`
   - Children flow: photo upload (reuses existing presigned uploader) → consent checkbox → signature input (typed / drawn) → submit
   - No persona branching, no carrier/OO/driver/receiver-specific copy inside the primitive
6. **Load detail "Attestation chain" panel** — read-only ordered list of signatures (who/what/when/photos) visible to load's parties + ADMIN read-only.

## What I'll NOT do (out of scope per the prompt)
- Internal-staff signing UX (excluded by rule)
- Modifying `assertPodComplete()` for factoring (kept; it just becomes one input to the broader chain check)
- A receipt for the `LOAD-E2E-001` aux-table provisioning blocker — that's separate; `Signature` will be its own new table

---

# Risks + things to confirm

1. **Two POD records will be in flight during the migration window.** Driver clients on the old code path call `/api/driver/loads/:id/pod` and set `Load.podPhotoKey`. New code path writes a `Signature` row with `proofPhotoIds[]`. Plan: keep the legacy field readable, mark it deprecated in the response, point all clients at the new endpoints before deleting.
2. **`shipperId === userId`?** Need to confirm by reading; the prompt's wrong-party rejection depends on a stable map from `load.shipperId` / `load.assignedDriverId` / `load.receiverId` to authenticated `userId`. From earlier seed work the convention is `shipperId = "shipper_…"`, `userId = "user_…"`. We need a resolution helper, not direct equality.
3. **`documentHash` canonical form.** Need to pick the subset of load+bol fields hashed at sign time, and freeze the serialization. Proposal: `canonicalJSON({ loadId, status, pickupAddr, deliveryAddr, totalWeight, rate, commodity, assignedDriverId, ...action-specific })` — same fields for the same `action` across renders, sorted keys.
4. **Append-only DDB**. Use IAM that forbids `DeleteItem` + `UpdateItem` on `LoadLead_Signatures`; corrections must use `correctsSignatureId`.
5. **PII handling.** Signatures contain names + IPs + handwriting. Restrict read of `LoadLead_Signatures` to the load's parties + ADMIN (server-side check, not just middleware).

---

# Gate

**Build is paused.** Phase 1+ is unblocked once this discovery is approved and any of the three "things to confirm" are resolved.

---

# Addendum — review against the expanded scope (CONSTRAINTS 1–3)

The original prompt and the expanded scope are aligned on intent; the expansion makes three rules explicit. Each is verified against actual code/AWS state below.

---

## CONSTRAINT 1 — Resolver-based signer (NO denormalized signer field on Load)

### What I verified
`resolveCarrierOfRecord(driver: Driver)` lives at [`backend/src/services/carrierOfRecord.ts:39`](backend/src/services/carrierOfRecord.ts:39). It takes a **Driver** (not a Load) and returns `{ entityType, entityId, displayName? }`:

- Precedence: **OO fleet** (`driver.ownedByOperatorId`) → **Carrier org** (first ACTIVE membership in an org with `OrgCapability.CARRIER`) → **null** (unaffiliated, no haul).
- OO self-driver is a regular OO-fleet hit (the OO's self-driver has `ownedByOperatorId === operator's own id`).

Signing authority for org-side parties: the existing **`OrgRole`** enum + `MATRIX` in [`backend/src/services/orgPermissions.ts:41`](backend/src/services/orgPermissions.ts:41) already defines who can do what. The **org-side signers** are:
- **OWNER** + **MANAGER** (already captured as `ADMIN_ORG_ROLES` at [`backend/src/types/index.ts:207`](backend/src/types/index.ts:207))
- **DISPATCHER** dispatches but does NOT sign on behalf of the org (matches `members:transfer_ownership`-style gravitas)
- **ORG_DRIVER / SHIPPER_USER / RECEIVER_USER** never sign as the org

### Plan for `assertSignerIsLoadParty(load, action, authUserId)`

Pure function over services; **no field added to `Load`**:

| Action | Resolver | Allowed-userId set |
|---|---|---|
| `BOL_SUBMIT` | `OrgMembershipService.findActiveOrg(load.shipperUserId)` → all OWNER+MANAGER memberships in that org | If no shipper-side org, fall back to `authUserId === load.shipperUserId` (single-user shipper account) |
| `CARRIER_ACCEPT` | Look up the **accepting** Driver (the one the caller is trying to assign) → `resolveCarrierOfRecord(driver)` → if OWNER_OPERATOR return `[operator.userId]`; if CARRIER_ORG return all OWNER+MANAGER `userId`s | record `signerUserId` for which specific member signed |
| `DRIVER_PICKUP` / `DRIVER_DELIVER` | `DriverService.getProfileById(load.assignedDriverId)` → `driver.userId` | resolved live, so reassignment instantly changes who can sign |
| `RECEIVER_CONFIRM` | `ReceiverService.getProfileById(load.receiverId)` → `receiver.userId`; if receiver is org-scoped (future), apply OWNER+MANAGER fan-out same as shipper | — |

A wrong-party rejection is then a simple set-membership check. **Reassignment proof** is trivial: if dispatch reassigns `load.assignedDriverId` from D1 to D2 between pickup and delivery, the next call to `assertSignerIsLoadParty(load, 'DRIVER_DELIVER', D2.userId)` passes and `D1.userId` is rejected — no cached field to flush.

### Required gate before this works
`OrgMembershipService` exists (per IAM-1/IAM-2 epic) but I should verify the GSI it uses, since the resolver path will hit it on every transition. If it's slow, cache the **resolution result** in-memory per request only (never persist).

---

## CONSTRAINT 2 — Canonical `documentHash` with dual schema versioning

### Per-action canonical projections (exact field-by-field allowlist)

Sorted keys, normalized numeric forms (no `1.0` vs `1`), ISO-8601 dates with `Z` suffix, **no `updatedAt` / `createdAt` / derived fields**. Photos are referenced by `contentHash` of the bytes — not URL, not S3 key.

```ts
// canonicalize(action, load, photos) → string (canonical JSON)
// schema: { canonicalSchemaVersion: "1", action, fields: { … } }
```

| Action | Allowlist fields (exact) |
|---|---|
| `BOL_SUBMIT` | `loadId`, `bolId?`, `shipperOrgId?`, `shipperUserId`, `commodityDescription`, `totalWeightLbs`, `pickupAddress`, `pickupCity`, `pickupState`, `pickupZip`, `pickupLat`, `pickupLng`, `pickupDate`, `deliveryAddress`, `deliveryCity`, `deliveryState`, `deliveryZip`, `deliveryLat`, `deliveryLng`, `deliveryDate`, `equipmentType`, `acceptedEquipmentTypes[]`, `minMcMaturityDays`, `minCargoInsurance`, `minLiabilityInsurance`, `hazmat`, `originPhotoContentHashes[]` |
| `CARRIER_ACCEPT` | `loadId`, `carrierOfRecord.entityType`, `carrierOfRecord.entityId`, `assignedDriverId`, `rateAmount`, `rateType` |
| `DRIVER_PICKUP` | `loadId`, `stage: "PICKUP"`, `pickupActualAt` (ISO from server), `pickupGeo: { lat, lng } | null`, `photoContentHashes[]` (sorted) |
| `DRIVER_DELIVER` | `loadId`, `stage: "DELIVERY"`, `deliveredActualAt` (ISO), `deliveryGeo: { lat, lng } | null`, `photoContentHashes[]` (sorted) |
| `RECEIVER_CONFIRM` | `loadId`, `stage: "RECEIPT"`, `receivedActualAt` (ISO), `photoContentHashes[]` (sorted), `exceptions: { code, description } | null` |

### Why dual versions
- `attestationVersion` versions the **legal text the human signed** ("I, the shipper, certify…"). Bumping fixes a typo without invalidating prior signatures.
- `canonicalSchemaVersion` versions the **machine projection** (which fields go into the hash). If we add `commodityHazmatClass` to the BOL_SUBMIT projection later, old signatures stay verifiable against the v1 projection they were signed under.

Both stamped on the signature. **The canonical projection itself is checked into the repo and treated as a legal artifact**: `backend/src/services/attestation/projections/v1.ts` + a `CHANGELOG.md` describing the bump.

### Stability test (one of the acceptance proofs)
```
documentHash = sha256(canonicalize('BOL_SUBMIT', load, photos))
```
must return the **same bytes** across:
- Two consecutive renders of the same load
- A render after `updatedAt` ticks because the row was re-saved
- Two different processes / Node versions

Achieved by: sorted keys (JCS-style), explicit type normalization, no Date.now() / Math.random() / Object iteration order dependence.

### Photo content hash
- **Server-side**: when the presigned URL is consumed and the upload completes, we issue a `HEAD` (or use the S3-returned `ETag` when bucket is **not** server-side-encrypted with KMS — which it isn't today; default SSE-S3 keeps ETag = MD5 of bytes). For consistency with future bucket changes, we'll compute `sha256(bytes)` server-side via a `s3:ObjectCreated:*` Lambda or via an explicit "finalize-upload" step. **Decision needed**: which path do we want?

---

## CONSTRAINT 3 — Immutability at the data layer

### Live state today (verified against AWS)

| Property | Required by constraint | Live state |
|---|---|---|
| `LoadLead_Signatures` table | exists with IAM Deny on Update/Delete | **does not exist yet** |
| PITR on existing tables | required for the new table | `DISABLED` on `LoadLead_Users / Loads / Offers / Drivers` (verified live) |
| Existing tables in Terraform | required so the new table inherits the module's defaults | **None of the prod tables are in TF** — `infra/terraform/envs/*` has no `module "ddb_*"` block. The TF module DOES set `point_in_time_recovery { enabled = true }` by default ([`infra/terraform/modules/dynamodb_table/main.tf:36`](infra/terraform/modules/dynamodb_table/main.tf:36)) — that's why the new table can inherit it cleanly once we add it to the env stack. |
| `loadlead-pod-uploads` bucket versioning | required for delete-recovery | empty (= disabled) — verified `s3api get-bucket-versioning` returns no `Status` |
| `loadlead-pod-uploads` Object Lock | required for WORM | **`ObjectLockConfigurationNotFoundError`** — Object Lock was NOT enabled at bucket creation. **It is impossible to enable Object Lock on an existing bucket retroactively.** |
| IAM policy on runtime role for the new table | Deny `UpdateItem`/`DeleteItem`/`BatchWriteItem`-delete | no policy IaC files exist; the EB instance profile lives only in the AWS console |

### Decision (approved) — Option C: ship B now, schedule A; do NOT call B "WORM"
**B is delete-resistant by policy. A is immutable by design.** Important enough to repeat:

- **B** = versioning + a bucket policy `Deny` (incl. `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:PutBucketPolicy`, `s3:PutLifecycleConfiguration`) on the runtime role. An overwrite writes a new version, the original bytes survive, and the runtime role cannot remove versions. **Reversible**: anyone who can edit the bucket policy can lift the Deny, so the policy itself must be protected — the `s3:PutBucketPolicy` Deny is the meaningful self-protection; whoever holds policy-edit IAM rights is the threat model.
- **A** = `s3:ObjectLockConfiguration` in `COMPLIANCE` mode at bucket creation. **Cannot be turned off by anyone, including root**. Bytes for a stored retention period cannot be deleted or modified by any principal. This is the artifact an auditor / litigant actually wants.

Internal docs, the audit doc, and any future legal artifact must use the terms "delete-resistant" (B) vs "WORM" (A) — never call B WORM. The state during the C window is "policy-deletion-resistant; WORM scheduled."

### Hard finding — Object Lock cannot be enabled on the existing bucket
This forces a decision. Three workable options:

| Option | Implication |
|---|---|
| **A. Best — new bucket `loadlead-pod-uploads-v2` with Object Lock at creation + Governance/Compliance mode, then migrate** | Two-stage: copy existing objects (audit grace period), repoint app, schedule old bucket for read-only after retention horizon. Cost: a few weeks of dual-bucket reads. Provides the strongest legal artifact. |
| **B. Acceptable — keep current bucket; enable versioning + bucket policy `Deny: s3:DeleteObject + s3:DeleteObjectVersion + s3:PutBucketLifecycleConfiguration` for the runtime role** | No WORM but no overwrite/delete by the app. Operators with admin can still nuke. Lower legal strength but achievable today without a migration. |
| **C. Hybrid — Option B now; Option A scheduled** | Ship soon; harden later. Probably what we want. |

I'd recommend **C**, gated on you. The build plan below assumes B as the immediate target and notes A as the scheduled follow-up so we don't ship the feature with no integrity controls at all.

### `LoadLead_Signatures` provisioning

Adds an entry to the existing TF DDB module — the module already sets PITR + `deletion_protection_enabled` to true. New stack add (per env):

```hcl
module "ddb_signatures" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_Signatures"
  hash_key            = "signatureId"
  attributes          = [
    { name = "signatureId", type = "S" },
    { name = "loadId",      type = "S" },
    { name = "signedAt",    type = "S" },
  ]
  global_secondary_indexes = [
    { name = "loadId-signedAt-index", hash_key = "loadId", range_key = "signedAt", projection_type = "ALL" },
  ]
  deletion_protection = true   # cannot be deleted in prod even by TF; needs explicit two-step
  tags                = local.tags
}
```

### IAM policy for the EB runtime role (excerpt)
```json
{
  "Sid": "SignaturesAppendOnly",
  "Effect": "Allow",
  "Action": ["dynamodb:PutItem", "dynamodb:Query", "dynamodb:GetItem"],
  "Resource": [
    "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_Signatures",
    "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_Signatures/index/*"
  ]
},
{
  "Sid": "SignaturesNeverMutate",
  "Effect": "Deny",
  "Action": [
    "dynamodb:UpdateItem", "dynamodb:DeleteItem",
    "dynamodb:BatchWriteItem"
  ],
  "Resource": "arn:aws:dynamodb:us-east-1:552011299815:table/LoadLead_Signatures"
}
```

`BatchWriteItem` is fully denied because it carries deletes; the app simply doesn't use it for this table. Explicit Deny beats Allow, so even a wider grant elsewhere cannot bypass it.

### App-layer defense in depth
Every `PutItem` carries `ConditionExpression: "attribute_not_exists(signatureId)"` — so a duplicate Put with the same id is rejected at the DDB API even before IAM, which makes overwrite-by-replay impossible. App code never imports `DeleteCommand` / `UpdateCommand` for this table — enforced by an ESLint rule (`no-restricted-imports` scoped to the file path) so a future drive-by edit is rejected at lint.

### PITR + WORM audit sink
- PITR on `LoadLead_Signatures` (TF default).
- DDB Stream → S3 (Object Lock bucket `loadlead-audit-signatures-worm`) for off-table durability. **Defer to Phase 2** of the build — Phase 1 ships with PITR alone, Phase 2 adds the WORM sink. Document this so the audit trail captures the intent.

---

# Revised build plan — additions over the original

The plan in the body of this doc is mostly correct; the expansion adds these explicit deliverables. Items are **new** unless flagged as a refinement.

| Bucket | Deliverable |
|---|---|
| BUILD-NEW | `backend/src/services/attestation/projections/v1.ts` (canonical projections, per-action allowlist) + `projections/CHANGELOG.md` |
| BUILD-NEW | `backend/src/services/attestation/canonicalize.ts` (JCS-style sorted-key serializer, numeric/date normalization, photo contentHashes by sha256) |
| BUILD-NEW | `backend/src/services/attestation/assertSignerIsLoadParty.ts` — resolver, no denormalized Load field; reuses `resolveCarrierOfRecord` for CARRIER_ACCEPT; reuses `OrgMembershipService` + `ADMIN_ORG_ROLES` for org-side parties |
| BUILD-NEW | `LoadLead_Signatures` table in `infra/terraform/envs/{dev,staging,prod}/main.tf` |
| BUILD-NEW | IAM policy patch for the EB instance profile (Allow Put+Get+Query, Deny Update+Delete+BatchWriteItem on the table) — TF if the role is already terraformed; documented runbook + manual console step if not |
| BUILD-NEW | Photo finalize-upload endpoint that records `contentHash` (sha256) so it can flow into the canonical projection; decide between S3 event trigger vs synchronous finalize call |
| EXTEND | `loadlead-pod-uploads` bucket: enable versioning + add bucket policy denying `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:PutBucketPolicy`, `s3:PutLifecycleConfiguration` to the runtime role; document Phase-2 migration to `loadlead-pod-uploads-v2` with Object Lock COMPLIANCE mode at creation. Per-decision: this is "policy-deletion-resistant" not WORM. |
| EXTEND | Enable PITR on existing prod tables (`LoadLead_Users / Loads / Offers / Drivers` + any others) — single `update-continuous-backups` per table, zero downtime. The asymmetry of "only signatures are recoverable" is indefensible; close it as part of Phase 1. |
| BACKLOG | Phase-2 follow-ups: (1) `loadlead-pod-uploads-v2` + Object-Lock COMPLIANCE migration, (2) DDB Stream → S3 WORM audit sink, (3) Import all prod DDB tables into Terraform. Logged so they don't drift quietly. |
| BUILD-NEW | `eslint` rule scoped to `services/signatures*.ts` denying imports of `UpdateCommand` / `DeleteCommand` / `BatchWriteCommand` (defense in depth) |
| BUILD-NEW | Cypress + integration tests proving: (1) reassign-driver flips the allowed signer; (2) two renders → same documentHash; (3) duplicate-Put → 400; (4) Object-Lock / delete-deny holds (bucket policy probe) |

---

# Things to confirm before Phase 1 (revised)

The three from the original doc remain. The expanded scope adds two more:

4. **Object-Lock migration path** — Option B now / Option A scheduled, or jump straight to A? (B is fastest; A is the strongest legal artifact.)
5. **Photo `contentHash` write path** — synchronous "finalize upload" endpoint the client calls after the S3 PUT (simpler, tighter sequencing), or async `s3:ObjectCreated:*` Lambda (no extra client round-trip)? Phase-1 default: synchronous; revisit if the client UX is poor.

Gate still holds: **no build until these answers land.**
