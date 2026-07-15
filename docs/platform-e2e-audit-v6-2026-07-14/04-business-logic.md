# Platform E2E Audit v6 (2026-07-14) - Dimension 4: Adversarial business-logic audit

## Overall
The codebase is unusually well-defended (HS256 pinned, conditional-write state machines, integer-cents money, deterministic idempotency keys, prior fixes SEC-2/5/6/9, BL-2). Most remaining defects are latent scale/correctness bombs and config-fail-open seams rather than naive logic errors. The single highest-impact issue is systemic.

## CRITICAL

### C1 - Database.scan / Database.query return only the first ~1 MB page (no pagination): silently truncate garnishment intercepts, factor payee routing, and legal-hold checks
- Evidence: `config/database.ts:117-137` (scan) and `:94-115` (query) issue a single ScanCommand/QueryCommand and return `result.Items`, ignoring `LastEvaluatedKey`. DynamoDB caps each page at 1 MB. Every "scan the whole append-only table" helper is correct only until the table exceeds one page, then silently drops rows with no error. Worst-hit consumers:
  - Garnishment/levy/lien silently skipped: `payoutInterceptService.ts:186 scanAll` -> `activeFor:114` -> `applyAtSettlement:142`. Once `payout_intercepts` exceeds 1 MB, an ACTIVE counsel-signed intercept on a later page is not seen -> nothing intercepted -> carrier paid the full net in violation of a court order.
  - Funds misrouted: `factoringAssignmentService.ts:151 scanAll` -> `getActiveAssignment:129` -> `payeeRoutingService.resolvePayee:72`. The supersession set is computed over only the first page: a RELEASE on page 2 fails to drop the ACTIVE row on page 1 (money keeps flowing to a bought-back factor), or an active assignment on page 2 is missed (factor's money paid to the carrier).
  - Legal holds silently not enforced (or falsely enforced): `legalHoldService.ts:119 scanAll` -> `isOnHold:68`. The newest PLACE/RELEASE for an entity can be on a later page; `isOnHold` returns the wrong answer -> a held load/invoice/carrier becomes deletable.
- Failure scenario: production runs for months; payout_intercepts crosses 1 MB. A carrier under an active federal levy gets an invoice settled; `activeFor` returns [] because the levy row is on page 2; carrier paid in full. No log, no error.
- COA: make scan and query loop on LastEvaluatedKey (do/while) before returning; add carrierId/invoiceId/entityId GSIs and switch these hot resolvers to query. Until fixed, these three paths cannot be considered correct at scale.

## HIGH

### H1 - Didit identity/KYB webhook fails OPEN when the secret is unset (public, unauthenticated)
- Evidence: `services/verification.ts:382-390` handler mounted PUBLIC at `index.ts:349` (`app.post('/api/webhooks/didit', diditWebhookHandler)`, no JWT). When `DIDIT_WEBHOOK_SECRET` is absent the handler only console.warns and proceeds to recomputeAndPersist with attacker-controlled body. Contrast Canopy (`routes/canopyWebhook.ts:61-64`) which rejects in production when its secret is missing.
- Failure scenario: with the env var unset, an attacker POSTs `{"vendor_data":"<victim entityId>","status":"Approved","webhook_type":"business.status.updated"}` -> sets kybStatus 'pass'; a non-business. type sets idvStatus 'pass'. Combined with a genuinely-active FMCSA MC, deriveStatus flips the entity to VERIFIED, defeating Gate 1 of requireVerifiedCarrier.
- COA: reject (401) when DIDIT_WEBHOOK_SECRET is unset in production, mirroring Canopy. Never skip signature verification on a state-mutating public endpoint.

### H2 - Driver profile lookup is a filtered full-table Scan on the hot auth path; returns null as data grows
- Evidence: `services/driverService.ts:121-127` (getProfileByUserId) uses `Database.scan(drivers, 'userId = :userId')`. DynamoDB applies the FilterExpression after the 1 MB page read, so once the drivers table exceeds ~1 MB the matching row can lie beyond the scanned page and the function returns null for a driver that exists. Backs requireVerifiedCarrier (`verification.ts:167`), haulerActor (`negotiations.ts:88`), the capacity routes, the loadboard, BOL access.
- Failure scenario: as drivers grow, a legitimate hauler intermittently gets "Driver profile not found" (404) on engage/accept/loadboard/capacity, nondeterministically by scan order. Fail-closed (no security bypass) but a creeping functional outage. getDriversByStatus:223 has the same shape.
- COA: add a userId GSI and query it (a code comment at driverService.ts:221 already acknowledges the scan is a stopgap).

## MEDIUM

### M1 - AML gate treats "never screened" as passing
- Evidence: `services/verification.ts:93` `const amlOk = v.amlStatus === undefined || v.amlStatus === 'pass';`. submitCarrierDocs sets kybStatus 'pending' but never initializes amlStatus; screenCarrierAml is a separate call. If never made, amlStatus stays undefined -> amlOk true -> a carrier reaches VERIFIED on FMCSA+KYB alone, despite the gate docs asserting FMCSA + KYB + AML. Sanctions screening silently skippable.
- COA: for carrier entities require amlStatus === 'pass' (or an explicit policy opt-out), not undefined.

### M2 - maxCapacityLbs unvalidated on PUT /driver/profile (breaks the integer-pounds invariant and the capacity board)
- Evidence: `routes/driver.ts:87-108` has no validate() middleware; `services/driverService.ts:143-175` (updateProfile) spreads req.body straight to Database.updateItem. A hauler can PUT maxCapacityLbs 45000.5, -1, or 1e9. That value becomes ratedWeightLbs throughout haulerCapacityService.foldSnapshot, violating the integer invariant in capacityPolicy.ts:15 and haulerCapacityService.ts:14. The audit event is gated on Number.isInteger (driver.ts:99) so the audit trail skips the bad value while the float/huge value is still persisted and used. Huge rated -> effectively unlimited board (applyCapacityFilter fit check at haulerCapacityService.ts:153), defeating hard/soft capacity matching.
- COA: validate maxCapacityLbs as a non-negative integer with a sane max at the route and in updateProfile; reject non-integers instead of silently storing them.

### M3 - Accessorial double-charge when a load's policy is edited after a charge is computed
- Evidence: chargeId is sha256(loadId|stopId|policyHash) (`accessorialChargeService.ts:96-99`). AccessorialPolicyService.updatePolicy bumps version and thus policyHash (`accessorialPolicyService.ts:227,242`). A computeForStop after a policy edit produces a new chargeId -> a second charge row for the same stop. If the pre-edit charge is already APPROVED/SETTLED and the recomputed one also auto-approves, both satisfy isBillable and any settlement summing a load's billable charges double-counts that stop.
- COA: when aggregating for settlement, dedupe billable charges by stopId (latest policyHash wins), or supersede prior-hash charges for the stop on policy change.

## LOW

### L1 - Capacity fold nondeterministic for same-millisecond declarations
- Evidence: haulerCapacityService.ts:51 and :304 sort events by createdAt only, no tiebreaker. legalHoldService.ts:26,71 and stopEventService add a monotonic seq for exactly this. Two hauler declarations (or a DEDUCT+RESTORE of one loadId) in the same millisecond fold in arbitrary order -> declState/remaining can differ between reads. The platform component is otherwise order-independent (set/delete), so this is the one non-deterministic corner.
- COA: add a monotonic seq (or eventId) as secondary sort key, mirroring legalHoldService.

### L2 - Legal-hold assertDeletable coverage thin; RetentionService unwired
- Evidence: assertDeletable has one caller (`routes/shipper.ts:276`, soft load-cancel). Other destructive endpoints (ownerOperator.ts:235 fleet driver, org.ts:347/586, admin deletes) never consult it; RetentionService.purge (legalHoldService.ts:134) has no caller. Latent today (held types only reachably deleted via the guarded path), but any new hard-delete of LOAD/INVOICE/CARRIER/SHIPPER bypasses holds silently.
- COA: enforce assertDeletable in the data-layer delete (or each destructive route); route real purges through RetentionService.

### L3 - BOL driver auto-populate reads a nonexistent field
- Evidence: routes/bol.ts:77 `if ((load as any).driverId)`; the Load model uses assignedDriverId. Always undefined, so BOL creation never auto-fills the assigned driver. Correctness only.
- COA: use load.assignedDriverId.

## Verified-clean (adversarially checked, no defect found)
- Negotiation: first-accept-wins via conditional lock put; terminal transitions conditional + idempotent read-back; assignment-before-lock-release; e-sign gate binds assignedDriverId (BL-2) on all three assign paths; identity from auth not body (no IDOR); integer cents; Load row never mutated.
- Capacity deduct/restore idempotency: double-BOOKED, double-DELIVERED, cancel-then-redeliver all safe; platform fold uses set/delete so duplicate DEDUCT rows collapse to one; no reassignment path leaks capacity; remaining floored/integer-safe as long as M2 is fixed; missing-table ResourceNotFoundException tolerated; capacity never blocks registration/login/claim.
- Money primitives (utils/money.ts): integer-cents assertions, deterministic half-up rounding, single sanctioned dollar->cents boundary.
- Reconciliation/intercepts: deterministic outcomeId from sha256 keys + attribute_not_exists conditional put with read-back-the-winner; audit-first, fail-closed.
- Canopy: raw-body HMAC over `${t}.${rawBody}`, constant-time compare, length-guarded, replay window; fails closed in production; re-retrieves the pull by id.
- Auth: JWT alg pinned HS256; requireStaffTier/requireComplianceRole re-read the DB and never trust the JWT for tier/role; ownership checks derive identity from the authenticated user.

## Note (latent, not yet reachable)
reconciliationService.reconcileDebtorPayment has no live caller. When wired, its idempotency keys `pay|invoiceId` / `reserve|invoiceId` are keyed by invoice only, so a second/partial debtor payment on the same invoice would be silently swallowed as a duplicate. Fix the key to include a payment/attempt id before wiring.
