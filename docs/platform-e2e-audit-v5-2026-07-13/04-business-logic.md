# LoadLead E2E Audit v5 — Dimension 04: BUSINESS-LOGIC CORRECTNESS

Date: 2026-07-12
Scope: backend/src — money/cents integrity, compliance five-state machine, payee routing,
negotiation + e-sign gate, Canopy cross-reference + verification decision, accessorials/factoring
ledger, timestamp units, idempotency. Logic was traced (inputs → output), not just read.

Severity: CRITICAL (money error / data corruption / security bypass), HIGH (wrong business
outcome / missing guard / race), MEDIUM (edge-case bug), LOW (hygiene).

---

## BL-1 — Mandatory-COI gate is satisfied by an EXPIRED (or REJECTED) certificate — HIGH

**Where:** `backend/src/services/canopy/verificationDecision.ts:111-114`; interacts with
`backend/src/services/complianceDocumentService.ts:311-324` (`getCurrent`) and
`backend/src/services/compliance/coiService.ts:159-176` (`expireDueCois`).

**Evidence:**
```ts
// verificationDecision.ts:111
const coiDoc = await ComplianceDocumentService.getCurrent('HAULER', carrierId, 'COI');
const coiPresent = Boolean(coiDoc);
...
const verified = evalPass && fmcsaPass && !unresolvedCritical && coiPresent;
```
`getCurrent` returns the current-version COI regardless of `verificationStatus` — it filters only
on `documentType === 'COI' && isCurrentVersion` (complianceDocumentService.ts:316-322). An
EXPIRED or REJECTED COI is still `isCurrentVersion=true` (nothing supersedes it until a *new*
upload), so `coiPresent` is `true`.

`expireDueCois` flips a due COI to `EXPIRED` (coiService.ts:165-171) but does **not** re-run the
insurer-policy decision. So there is no path that downgrades the INSURER_POLICY when the COI lapses,
and even if one fired, the gate would still pass.

**Failure scenario:** Canopy-connected hauler is VERIFIED (insurer liability + FMCSA + COI present).
The COI's expiry date passes → nightly `expireDueCois` sets COI `EXPIRED`. INSURER_POLICY stays
`VERIFIED`; the hauler continues hauling as "insurance verified" with a lapsed certificate. The audit
requirement "verification holds PENDING until a *current* COI exists" is violated — the check tests
existence, not validity.

**Impact:** A hauler can be booked on loads as insurance-verified with an expired/rejected COI.
Compliance/legal exposure for a freight platform.

**COA:** In the decision, require the COI to be currently valid, e.g.
`coiPresent = !!coiDoc && coiDoc.verificationStatus !== 'EXPIRED' && coiDoc.verificationStatus !==
'REJECTED' && (!coiDoc.expiresAt || coiDoc.expiresAt > now)`. Additionally have `expireDueCois` call
`reevaluateCarrierInsurerPolicy(ownerId)` for HAULER COIs so a lapse actively holds the record.

---

## BL-2 — E-sign-at-assign gate is satisfied by a stale / foreign CARRIER_ACCEPT signature — HIGH

**Where:** `backend/src/routes/negotiations.ts:156-165` (`requireCarrierAcceptForAssignment`),
called from the three assign paths (negotiations.ts:289, 313, 345). Signature source:
`backend/src/services/attestation/signatureService.ts:154-163` (`getChain` is per-**load**),
`backend/src/services/attestation/requireSignature.ts:30-31` (newest matching wins).

**Evidence:**
```ts
// negotiations.ts:156
async function requireCarrierAcceptForAssignment(loadId: string): Promise<void> {
  const { requireSignature } = await import('../services/attestation/requireSignature');
  const sig = await requireSignature(loadId, 'CARRIER_ACCEPT');
  if (sig.signerRole !== 'CARRIER_ADMIN' && sig.signerRole !== 'OWNER_OPERATOR') { ... 409 }
}   // sig.assignedDriverId is IGNORED
```
The gate checks only that *some* CARRIER_ACCEPT signature with a carrier role exists in the load's
chain. The signature carries `assignedDriverId` (signatureService.ts:122-125) but the gate never
compares it to the negotiation's `haulerDriverId`, and the chain is per-load append-only (never
cleared on reject/expire/rebroadcast).

**Failure scenario:** Load L is engaged by hauler A (driver D_A); A signs CARRIER_ACCEPT
(assignedDriverId=D_A) then lets the 20-min window expire (or rejects). Lock releases, L rebroadcasts,
A's signature row stays in L's chain. Hauler B (driver D_B) engages L, bids, shipper accepts
(`/:id/shipper/accept`). `requireCarrierAcceptForAssignment(L)` finds A's signature (role
OWNER_OPERATOR → passes) and the assignment proceeds — **B is assigned with no attestation of their
own**; the only CARRIER_ACCEPT on file binds D_A at A's terms.

**Impact:** The shipped e-sign-at-assign compliance gate is bypassable server-side for any load that
has ever carried a CARRIER_ACCEPT signature (routine after a failed/expired negotiation). Assignments
complete without a valid UETA/ESIGN attestation from the assigned party — the legal evidence is wrong.
(The correct engaged driver is still assigned — `requireHauler` + `requireVerifiedCarrier` hold — so
this is an attestation-integrity/enforcement gap, not an authorization bypass.)

**COA:** Have `requireCarrierAcceptForAssignment` take the negotiation and assert
`sig.assignedDriverId === neg.haulerDriverId`; optionally require the signature's `signedAt` to fall
within the negotiation window (`>= neg.startedAt`). requireSignature already returns the sig for
exactly this cross-check (see its doc comment).

---

## BL-3 — "One charge per stop" is only enforced per policy-hash; a policy change spawns a second billable charge — MEDIUM

**Where:** `backend/src/services/accessorialChargeService.ts:96-99, 156-168, 185-216`; charge id
keyed on the policy snapshot hash from `accessorialPolicyService.ts:234-250`.

**Evidence:**
```ts
// accessorialChargeService.ts:96
function deterministicChargeId(loadId, stopId, policyHash) {
  const h = createHash('sha256').update(`${loadId}|${stopId}|${policyHash}`...)...
  return `charge_${h}`;
}
// computeForStop:161
const chargeId = deterministicChargeId(load.loadId, stopId, snapshot.policyHash);
const existing = await this.getCharge(chargeId);   // keyed on the NEW hash only
```
The idempotency/dedup and the "never regress"/"preserve reviewed status" guards (lines 166, 185-187)
all key off the *new* `chargeId`. If `snapshot.policyHash` differs from a prior compute (policy
edited → `updatePolicy` bumps version → new canonical hash, accessorialPolicyService.ts:221-231),
`getCharge(newId)` is null and a **brand-new charge row is created for the same (loadId, stopId)**.
The old charge (old hash) is untouched and still billable (`isBillable` = APPROVED|SETTLED,
line 92-94). `listForLoad` returns both; settlement/advance sum both.

Propagation: the supplemental advance key is `key('supp', invoiceId, charge.chargeId)`
(reconciliationService.ts:157) and the advance idempotency key includes `chargeId`
(fundingAdvanceService.ts:61-62) — two chargeIds ⇒ two advances for one stop.

**Failure scenario:** Detention charge computed & auto-APPROVED under policy v1 (hash H1). The
load's accessorial policy is re-frozen/edited (v2, hash H2). A recompute (`POST
/loads/:loadId/stops/:stopId/compute`, accessorials.ts:108-124, open to shipper/mover/admin) now
writes charge_H2, also APPROVED. Stop is billed twice; if factored, advanced twice.

**Reachability caveat:** Today the only code path that changes a load's accessorial policy hash is
`freezeAndAgreeAtPosting` (routes/shipper.ts:101) at posting — before transit/charges — so the double
charge is currently gated by *workflow ordering*, not by code. `snapshotPolicyOntoLoad`
(shipperPolicyService) is the *shipper-compliance* policy, unrelated to the accessorial hash. The
defect is latent: any future mid-load edit route, a re-post after booking, or a compute call racing
the posting freeze makes it live.

**Impact:** Potential accessorial double-bill and double-advance for one stop.

**COA:** Make the charge identity per (loadId, stopId) not per policy hash: look up an existing charge
for the stop regardless of hash and update it in place (carrying the frozen snapshot forward), or
block `updatePolicy` once a non-ACCRUING charge exists for the load. Contrast: the charge status
machine already has a proper `assertTransition` (lines 343-355); the identity layer lacks the
equivalent cross-hash guard.

---

## BL-4 — Payout intercepts (garnishment/levy/lien) are skipped whenever the payee is a factor/partner — MEDIUM

**Where:** `backend/src/services/reconciliationService.ts:200-209`;
`backend/src/services/payoutInterceptService.ts:131-184`.

**Evidence:**
```ts
// reconciliationService.ts:200
if (args.payee.type === 'CARRIER' && payeeAmount > 0) {
  const { PayoutInterceptService } = await import('./payoutInterceptService');
  const applied = await PayoutInterceptService.applyAtSettlement({...});
  payeeAmount = applied.carrierNetCents;
}
```
Intercepts run only on the `CARRIER`-payee branch. When an active factoring assignment or partner
funding redirects the payee to `FACTOR`/`PARTNER` (payeeRoutingService.ts:52-73), the intercept
service is never invoked at settlement, and the earlier advance to the carrier is never intercepted
either.

**Failure scenario:** A carrier subject to an ACTIVE garnishment/levy assigns its receivables to a
factor (account-level assignment). Every debtor payment routes to the factor; the carrier already
received the factor's advance. No intercept ever applies — the levy is structurally evaded.

**Impact:** The stated invariant "intercepts can't be bypassed" does not hold for factored carriers.
(May be an accepted limitation once a receivable is legally sold — flag for product/legal judgment.)

**COA:** Decide policy explicitly. If intercepts must reach factored carriers, apply the intercept at
advance issuance (against the carrier's advance) and/or against the factor payout when the underlying
carrier is under an active intercept, and record it append-only as today.

---

## BL-5 — `setVerificationStatus` has no state-machine guard; terminal protection is ad-hoc per caller — LOW/MEDIUM

**Where:** `backend/src/services/complianceDocumentService.ts:345-354`.

**Evidence:**
```ts
static async setVerificationStatus(documentId, status, event, actorOrSource, detail) {
  await Database.updateItem(this.docsTable, { documentId }, { verificationStatus: status });
  await this.recordVerificationEvent(documentId, event, actorOrSource, detail);
}
```
No check of the current status; any state → any state. The "five-state machine" is enforced only by
each caller remembering to guard. The Canopy decision path *does* guard (verificationDecision.ts:98-101),
but others do not:
- `coiService.decideCoi` (coiService.ts:144-153) sets VERIFIED/REJECTED with no terminal check — an
  admin can move a `REJECTED` COI straight to `VERIFIED` (may be an intended override, but unbounded).
- `expireDueCois` skips only `EXPIRED` (coiService.ts:163), so a `REJECTED` COI can be moved to
  `EXPIRED`, losing the rejection.
- `letterOfAuthorityService.ts:83`, `routes/compliance.ts:396` — direct writes, no terminal re-check.

**Impact:** Terminal states (EXPIRED/REJECTED) can be overwritten by a mis-ordered call; the audit
trail stays intact (append-only events) but the live status can be resurrected/regressed. Contrast:
`accessorialChargeService.assertTransition` (accessorialChargeService.ts:343-355) does this correctly.

**COA:** Add a centralized transition table to `setVerificationStatus` (reject illegal transitions;
treat EXPIRED/REJECTED as terminal except via an explicit re-submission that creates a new version).

---

## BL-6 — Canopy decision: terminal check is read-once before async work; a concurrent EXPIRED can be overwritten to VERIFIED — LOW (race)

**Where:** `backend/src/services/canopy/verificationDecision.ts:98-101` vs `123-134`.

**Evidence:** The terminal guard reads `existing` at line 98 and returns if EXPIRED/REJECTED. It then
awaits `evaluateForDecision`, `runFmcsaCheck`, `hasUnresolvedCriticalCrossReference`, and the COI
read, then re-reads `current` at line 123 and writes VERIFIED if `current.verificationStatus !==
'VERIFIED'` — **without re-checking terminal**. If monitoring flips the doc to `EXPIRED`
(canopyMonitoringService.ts:115) between lines 98 and 123, a `verified===true` outcome overwrites the
EXPIRED with VERIFIED (EXPIRED !== VERIFIED ⇒ the write fires).

**Impact:** Narrow race resurrecting a monitoring-EXPIRED insurer policy. Requires concurrent
monitoring expiry during a decision run.

**COA:** Re-assert the terminal check against the freshly-read `current` (line 123) before writing, or
use a conditional update that fails if the status changed to a terminal value.

---

## BL-7 — `resolveInvoicePayee` routes to FACTOR only when status === 'SUBMITTED'; a FUNDED opt-in falls through to CARRIER — LOW (verify)

**Where:** `backend/src/services/factoring.ts:171-184`.

**Evidence:**
```ts
const optIn = await getOptInByLoad(loadId);
if (optIn && optIn.status === 'SUBMITTED') return { payee: 'FACTOR', optIn };
... return { payee: 'CARRIER', ... };
```
`FactoringOptIn.status` includes `'FUNDED'`. Once a partner marks the opt-in FUNDED, this resolver
returns `CARRIER`. Also, an unaffiliated assigned driver returns `{ payee: 'CARRIER' }` with **no**
`carrier` entity (line 183 spreads `carrier` only when truthy) — settlement gets no destination.

**Impact:** Possible misroute of a debtor payment to the carrier after the factor has funded. Likely
benign because the integrated model is "data-only, funds never route through the platform," but the
`SUBMITTED`-only check is suspicious. (Note: the real settlement path uses
`PayeeRoutingService.resolvePayee`, which is separate and correct — CARRIER/FACTOR/PARTNER via the
assignment log; OO self-haul is handled by `resolveCarrierOfRecord`'s `ownedByOperatorId`
short-circuit, carrierOfRecord.ts:42-47.)

**COA:** Include `'FUNDED'` in the FACTOR branch (or document why FUNDED reverts to CARRIER), and
decide the unaffiliated-carrier destination explicitly.

---

## BL-8 — DynamoDB TTL unit inconsistency: some `expiresAt` written in ms, one in seconds — LOW (cross-cutting; verify infra)

**Where:** ms: `orgService.ts:239,522,574,605`, `ownerOperatorService.ts:125`,
`securityService.ts:19`. seconds: `notificationOutboxService.ts:61`
(`Math.floor(now/1000) + days*86400`).

**Evidence:** Invite/token/fleet rows set `expiresAt: now + N*60*60*1000` (epoch **ms**), while the
outbox sets a seconds-based value — the correct unit for a DynamoDB TTL attribute. If the ms tables
have TTL enabled on `expiresAt`, DynamoDB interprets the ms integer as seconds (≈ year 50,000+) and
the rows never auto-expire.

**Impact:** Stale invite/token rows never TTL-reaped if those tables rely on TTL. Application-level
expiry checks (`expiresAt > now`, all ms-consistent) still enforce correctness where present; this is
storage hygiene, not a logic bug in the app path. Needs a table-definition check to confirm which
tables have TTL on `expiresAt`.

**COA:** Standardize TTL attributes to unix seconds across tables that enable TTL; keep app-logic
timestamps in ms.

---

## BL-9 — Canopy auto-populate rounds cents→dollars with Math.round on a stored field — LOW (cosmetic)

**Where:** `backend/src/services/canopy/canopyIngestionService.ts:199-214`.

**Evidence:**
```ts
updates.liabilityInsuranceAmount = Math.round(data.autoLiabilityCents / 100);
updates.cargoInsuranceAmount     = Math.round(data.cargoCents / 100);
```
The OO profile stores whole dollars (documented). The **decision** logic reads
`data.autoLiabilityCents` directly in integer cents (complianceEvaluator.ts:68, verificationDecision.ts:71),
so this rounding does not affect verification. But e.g. $750,000.50 (75_000_050 cents) stores as
750,001 dollars — the displayed/stored dollar figure drifts from the cents truth by up to 99c and
rounds a hair *up*.

**Impact:** Display-only drift; no decision or money-movement impact. Flagged for completeness since
the audit called out the Canopy auto-populate write.

**COA:** Store the cents value (or round-half-down / floor) and format on read; or accept as display
rounding and document it.

---

## Paths verified CORRECT (no defect found)

- **Money primitives** (`utils/money.ts`): integer-cents throughout, `assertIntegerCents` guards,
  `dollarsToCents`/`applyBps` deterministic half-up. `accessorialCalc.ts` computes either DETENTION
  **or** LAYOVER (never both), integer cents, `assertIntegerCents` on every amount.
- **Negotiation state machine** (`negotiationService.ts`): conditional-write `transition` enforces
  status + turn (`currentOfferParty`); no state skip; engage lock is `attribute_not_exists(loadId)`;
  idempotent accept re-reads and returns the same result; assignment happens before lock release so a
  load is never both unlocked and unassigned; 20-min window enforced server-side via `expireIfOverdue`
  (checked at the top of every action); `maxRounds:0` = unlimited caps as specified.
- **Timestamps**: `Helpers.getCurrentTimestamp/getFutureTimestamp/isExpired` are all `Date.now()`
  ms; negotiation `deadlineAt`, offer `expiresAt` (offerService.ts) are ms-consistent — no
  seconds/ms comparison bug on the offer path.
- **Canopy webhook signature** (`canopySignature.ts:78-86`): `t` unix-seconds → ms via
  `tsNum < 1e12 ? tsNum*1000 : tsNum`; `±5min` replay window; constant-time compare; signed payload
  `${t}.${rawBody}` over raw bytes.
- **Idempotency**: funding advances (`fundingAdvanceService.ts` deterministic `advance_<sha>` +
  `attribute_not_exists`), reconciliation outcomes (deterministic `recon_<key>` + conditional put),
  payout intercepts (`intercept|id|invoice`), Canopy ingestion/monitoring (keyed on pull id) — replays
  write nothing twice.
- **Funding advance invariant**: accessorial advances require `chargeStatus === 'APPROVED'`
  (fundingAdvanceService.ts:83-87); no advance against a non-APPROVED charge, so a later dispute needs
  no clawback.
- **Payout intercept math**: counsel sign-off gated (payoutInterceptService.ts:144); `Math.min(remaining,
  requested)` caps at gross; percentage via `applyBps` (integer cents).
- **Canopy decision core**: `verified = evalPass && fmcsaPass && !unresolvedCritical && coiPresent`;
  FMCSA always runs and is recorded append-only; CRITICAL cross-reference holds PENDING + "contact
  LoadLead" notification; uploading a COI re-runs cross-reference then re-decides; a fresh CRITICAL
  correctly downgrades a VERIFIED record to PENDING (except the narrow race in BL-6); terminal
  EXPIRED/REJECTED are protected at entry (except BL-6). Mapper stays in integer cents (no float).
- **Compliance single-current invariant**: `healCurrentVersions` deterministically converges concurrent
  submits to exactly one `isCurrentVersion` row.
