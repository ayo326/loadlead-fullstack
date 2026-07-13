# Audit v5 — Dimension 06: Security, IAM & Compliance-Guard Correctness

Repo: `/Users/ayodejiejidiran/loadlead-fullstack` · Backend `backend/src` + IaC `infra/terraform`
Date: 2026-07-12 · Reviewer: security/IAM/compliance dimension

Severity key: CRITICAL (auth bypass / priv-esc / secret leak / data breach) · HIGH (missing authz / IDOR / compliance-control bypassable / blast-radius) · MEDIUM (hardening gap) · LOW (hygiene).

---

## Summary of findings

| ID | Title | Severity |
|----|-------|----------|
| SEC-1 | JWT signing secret fails open to `dev-secret`; no boot guard | HIGH (CRITICAL if unset in a deployed env) |
| SEC-2 | Factoring assignment `release` — IDOR write, redirects any carrier's payee | HIGH |
| SEC-3 | Factoring per-load `opt-in` — IDOR, factors another carrier's load + leaks BOL/POD | HIGH |
| SEC-4 | BOL `sign`/`update`/`wms`/`dispute` — no party check; forge delivery attestations | HIGH |
| SEC-5 | Legal holds are recorded but never enforced (no delete/payout path consults them) | HIGH |
| SEC-6 | Payout intercepts bypassable — settlement seam (`resolvePayee`) ignores them; applier unwired | HIGH |
| SEC-7 | Admin audit log + legal-hold/adjudication/disclosure/intercept tables lack IAM-Deny + WORM (immutability is app-convention only) | HIGH |
| SEC-8 | Factoring payee/package reads — IDOR info-leak of any load's payee, net settlement, debtor | MEDIUM |
| SEC-9 | Owner-operator `DELETE /fleet/:driverId` orphans another operator's driver | MEDIUM |
| SEC-10 | Shared `github_oidc_role` module → prod deploy-role blast radius on any module edit | MEDIUM (standing risk) |
| SEC-11 | Canopy/Didit secrets set out-of-band on EB (not in tfvars / not code-reviewed) | MEDIUM |
| SEC-12 | `jwt.verify` has no `algorithms` allowlist | LOW |
| SEC-13 | Invitation tokens + factoring handoff payload logged in plaintext | LOW |
| SEC-14 | `GET /api/compliance/policy/load/:loadId` — no party check, any authed user | LOW |

Positives verified (see end): admin bootstrap locked, W9 TIN envelope crypto fail-closed + KMS scoped to one key, W9 full-read ownership+relationship-gated+access-logged, adminCompliance per-role gated with audit-first reads, negotiations party-bound, Canopy webhook signature (HMAC-SHA256 + timing-safe + replay window + prod-reject-unsigned), signatures WORM sink genuinely immutable, no `eval`, parameterized DynamoDB, integer-cents money, EB DynamoDB/S3 scoped by env prefix, OIDC trust per-env `sub`-scoped, no secrets committed to git.

---

## SEC-1 — JWT signing secret fails open to `dev-secret`; no boot guard
**Severity:** HIGH (CRITICAL if `JWT_SECRET` is ever unset in staging/prod)

**Evidence:**
- `backend/src/config/environment.ts:201` — `secret: process.env.JWT_SECRET || 'dev-secret'`
- `backend/src/utils/helpers.ts:22-25` — `generateToken` signs with `config.jwt.secret`
- `backend/src/middleware/auth.ts:32` — `jwt.verify(token, config.jwt.secret)` (same secret verifies)
- `backend/src/services/integrations/bootGuard.ts` — `runBootGuards()` checks integration modes (`assertProductionNotContaminated`, `assertNonProductionSafe`) and table isolation (`assertTablesEnvIsolated`) but **never** validates `JWT_SECRET` presence/strength. There is no fail-closed guard for the platform's most important secret.

**Attack scenario:** If `JWT_SECRET` is missing from the EB environment (fresh env recreate, typo, dropped var — exactly the "out-of-band env var" failure mode this repo has hit before), the process boots happily using the well-known literal `dev-secret`. An attacker mints `jwt.sign({userId:'x',email:'x',role:'ADMIN'}, 'dev-secret')` and is a full platform ADMIN. Every role/tier gate downstream trusts this token's signature.

**Impact:** Complete authentication bypass and privilege escalation to ADMIN; from there, staff-tier/compliance surfaces are one DB-backed grant away, and all tenant data is exposed. Note the mandatory ADMIN 2FA (see positives) does **not** mitigate this: 2FA gates the password-login route only, while a forged token skips login entirely.

**COA:** Add a boot guard (same fail-closed pattern already used for integration modes): refuse to boot when `APP_ENV` is `staging`/`production` and `JWT_SECRET` is empty, equals `dev-secret`, or is shorter than ~32 bytes. Remove the `|| 'dev-secret'` fallback outside local dev. Apply the identical guard to `LOCAL_FIELD_CRYPTO_SECRET`/`CANOPY` nonce fallbacks.

---

## SEC-2 — Factoring assignment `release` is an IDOR write (redirects any carrier's payee)
**Severity:** HIGH

**Evidence:**
- Route `backend/src/routes/factoring.ts:341-348` — `POST /api/factoring/assignments/:assignmentId/release` → `FactoringAssignmentService.release(req.params.assignmentId, req.user!.userId)`. The router only applies `router.use(authenticate)` (line 44); there is **no carrier-ownership check** on `:assignmentId`.
- Service `backend/src/services/factoringAssignmentService.ts:89-110` — `release()` does `scanAll()`, finds the target by `assignmentId` across **all carriers**, and releases `target.carrierId`'s active assignment. The caller's carrier is never compared to `target.carrierId`.
- Effect via `getActiveAssignment` (`:129-149`) + `payeeRoutingService.ts:63-73`: a RELEASED invoice-level row makes the payee resolve back to `CARRIER`.

**Attack scenario:** Any authenticated user enumerates/guesses `assign_*` ids and calls release. A competitor's (or a factor's own carrier's) active factoring assignment is superseded by a RELEASED row.

**Impact:** Payee routing flips from FACTOR to CARRIER — undermines a factor's secured position on receivables and disrupts a competitor's funding relationship. Cross-tenant financial-control mutation.

**COA:** In the route, resolve the caller's `carrierId` (`resolveCarrierId(req)`) and pass it to `release`; in the service, assert `target.carrierId === callerCarrierId` before writing the RELEASED row (or 404). Add an authz unit test.

---

## SEC-3 — Factoring per-load `opt-in` is an IDOR (factors another carrier's load; leaks BOL/POD)
**Severity:** HIGH

**Evidence:**
- Route `backend/src/routes/factoring.ts:152-156` — `POST /loads/:loadId/opt-in` → `optInToFactoring(req.params.loadId, carrierId)` where `carrierId` is the **caller's** resolved carrier.
- Service `backend/src/services/factoring.ts:80-133` — gates only on (a) the caller's own factoring profile being INTEGRATED, (b) `assertPodComplete(loadId)`, (c) debtor AML. **It never verifies the caller is the carrier of record for `loadId`.** It then writes an immutable consent record and `handOffToPartner(optIn, load)` transmits the load + BOL (`bolNumber`, POD photo count, signed timestamps) to the caller's factoring partner (`services/factoring.ts:137-165`).
- Downstream `resolveInvoicePayee` (`:171-184`) then returns `{payee:'FACTOR', optIn}` with the attacker's `carrierId`/`partnerId` for that load.

**Attack scenario:** Any authenticated carrier with an INTEGRATED profile opts-in any delivered (POD-complete) load — including one hauled by a different carrier — into their own factoring.

**Impact:** (1) Confidential handoff of another carrier's load + BOL/POD evidence to the attacker's factor. (2) Payee for that load resolves to the attacker's factor. Cross-tenant data disclosure + financial redirection.

**COA:** Verify carrier-of-record for the load matches the caller before opt-in (`resolveCarrierOfRecord(load's assigned driver) === carrierId`), 403 otherwise.

---

## SEC-4 — BOL `sign`/`update`/`wms`/`dispute` have no party-ownership check
**Severity:** HIGH

**Evidence:** `backend/src/routes/bol.ts` applies the `requireBOLAccess()` party check on the two GET routes (`:46`, `:55`) but **not** on the mutating routes:
- `POST /:bolId/sign` (`:106-129`) — only a role gate (DRIVER/RECEIVER); no check the driver is assigned to / receiver belongs to the load.
- `PUT /:bolId` (`:99-102`), `PUT /:bolId/wms` (`:148-151`), `POST /:bolId/dispute` (`:133-144`) — no ownership/role check.
- Service confirms no internal authz: `backend/src/services/bolService.ts` `sign()` (`:138`), `updateBOL()` (`:178`, only blocks after carrier signature), `updateWMS()` (`:199`), `disputeBOL()` (`:224`) each only load by id and write.

**Attack scenario:** Any authenticated DRIVER calls `POST /api/bol/<anyBolId>/sign` → sets `carrierSignature` and status `PICKED_UP`; any RECEIVER sets `consigneeSignature` and status `DELIVERED`. Any authed user edits BOL fields (pre-carrier-signature) or flags any BOL disputed.

**Impact:** Forged pickup/delivery attestations on loads the actor is not on. Because POD/delivery gates drive factoring eligibility, accessorial detention/layover, and settlement, this is an integrity break with direct financial consequence. BOL field tampering and dispute-griefing compound it.

**COA:** Call `requireBOLAccess(req, bol)` (already written) at the top of every mutating handler, and additionally assert the signer is the load's assigned driver / the load's receiver for `sign`.

---

## SEC-5 — Legal holds are recorded but never enforced
**Severity:** HIGH

**Evidence:**
- `backend/src/services/legalHoldService.ts` provides `isOnHold()` (`:65`), `assertDeletable()` (`:73`, "Call before ANY delete or purge"), and `RetentionService.purge()` (`:131`) which skips held entities. Docstring (`:6-11`): "Under hold, deletion is blocked at the data layer for EVERYONE, including admins."
- Repo-wide grep: **`assertDeletable`, `isOnHold`, and `RetentionService` have zero production callers.** Only `placeHold`/`releaseHold`/`listHolds` are wired (admin routes + `lawEnforcementService.ts:114`).
- Real delete paths do not consult holds: `routes/shipper.ts:269` `DELETE /loads/:loadId` → `LoadService.cancelLoad(loadId)` (ownership check only); `routes/org.ts:347,586` + `services/orgService.ts:396`; `routes/ownerOperator.ts:235`. None call `assertDeletable`.
- No payout/settlement path checks `isOnHold` (factoring opt-in/export/handoff and `resolveInvoicePayee` do not — grep of `services/factoring.ts`, `factoringPacketService.ts`, `factoringSubmissionService.ts`, `routes/factoring.ts` for `isOnHold`/`LegalHold` returns nothing).

**Attack scenario:** A LEGAL_ADMIN places a hold on a load/invoice/carrier under litigation. A shipper (or admin) then cancels/deletes the load, or the carrier factors/exports the invoice — none of it is blocked, because nothing consults the hold registry.

**Impact:** The legal-hold control is a no-op record. Evidence-spoliation / payout-during-hold is possible despite a valid hold — a compliance and legal-exposure failure. (The service is correct in isolation; it is simply not wired to any enforcement point.)

**COA:** Call `LegalHoldService.assertDeletable(entityType, entityId)` in every load/org/driver/invoice delete-or-cancel path, and gate the factoring/payee/export seam on `!isOnHold('LOAD'|'INVOICE'|'CARRIER', id)`. Add tests asserting a held entity cannot be deleted or paid.

---

## SEC-6 — Payout intercepts are bypassable at the real settlement seam
**Severity:** HIGH

**Evidence:**
- `backend/src/services/payeeRoutingService.ts` — docstring (`:1-14`) calls this "the settlement engine … when paying an invoice." `resolvePayee()` (`:47-82`) consults partner funding and factoring assignment but **never** `PayoutInterceptService`. This is the resolver actually used by the app (`routes/factoring.ts:356`).
- `PayoutInterceptService.applyAtSettlement` (`services/payoutInterceptService.ts:131`) is the only place intercepts are applied. Its **only** caller is `reconciliationService.ts:202` (inside `reconcileDebtorPayment`).
- `reconcileDebtorPayment` (`services/reconciliationService.ts:178`) has **no callers anywhere** (grep for `reconcileDebtorPayment` outside its own file returns nothing) — it is not wired to any route or worker.
- Additionally, even there, intercepts apply **only when `args.payee.type === 'CARRIER'`** (`:200`); a carrier under garnishment simply having a factoring assignment (payee = FACTOR) skips intercepts entirely.
- The factoring data handoff/export path (`services/factoring.ts:137`, `factoringPacketService`, `factoringSubmissionService`) does not consult intercepts.

**Attack scenario:** A law-enforcement liaison creates a counsel-signed garnishment intercept on a carrier. The carrier proceeds through the normal factoring/payee flow. Because the seam that emits payee data (`resolvePayee` / factoring export) ignores intercepts, and the intercept applier is unreachable, LoadLead tells the factor/partner to pay the full amount to the carrier's destination.

**Impact:** Garnishment/levy/lien intercepts do not affect the disbursement instruction LoadLead emits — the "cannot be bypassed" property is not met. Legal/regulatory exposure. (Correct service, unwired seam.)

**COA:** Consult `PayoutInterceptService.activeFor(invoiceId, carrierId)` (and counsel-signoff) inside `resolvePayee`/the factoring emit path so an active intercept forces HOLD/REDIRECT regardless of FACTOR/PARTNER/CARRIER routing; wire `reconcileDebtorPayment` (or move the intercept application into the payee resolver). Extend the CARRIER-only condition to cover FACTOR/PARTNER routing.

---

## SEC-7 — Audit log + compliance tables lack IAM-Deny and WORM (immutability is app-convention only)
**Severity:** HIGH

**Evidence:**
- Only the Signatures table gets true immutability: `modules/iam_signatures/main.tf` (explicit Deny on `UpdateItem`/`DeleteItem`/`BatchWriteItem`) + `envs/prod/worm-sink.tf` (DDB-stream → S3 Object-Lock COMPLIANCE, 7-yr). And even the Signatures **DDB** Deny is applied out-of-band, not via TF: `envs/prod/main.tf:106-109` — "IAM Deny … applied OUT-OF-BAND via attestation-bootstrap-ops.sh … When the role is brought under TF (Phase 2), wire modules/iam_signatures/." The module is instantiated nowhere (grep).
- The compliance tables `LoadLead_AdminAuditLog`, `LoadLead_Adjudications`, `LoadLead_LegalHolds`, `LoadLead_Disclosures`, `LoadLead_PayoutIntercepts` (`envs/prod/main.tf:229-279`) are created with only `deletion_protection` (table-level) + PITR. **No IAM Deny on item Update/Delete, and no WORM sink.**
- The EB app role grants item mutation across every table by prefix: `modules/backend_eb/main.tf:37-42` — `Action` includes `dynamodb:UpdateItem`,`dynamodb:DeleteItem` on `table/${prefix}*` (+ indexes). So the app identity can update/delete audit and legal-hold rows.
- App code is currently append-only by convention only: `adminAuditService.ts` (`record` only `putItem`), `legalHoldService.ts` (`recordEvent` only `putItem`) — nothing enforces it below the app.

**Attack scenario:** A compromised backend, a malicious insider with the instance role, or a future buggy code path issues `UpdateItem`/`DeleteItem` against `LoadLead_AdminAuditLog` or `LoadLead_LegalHolds` — rewriting the "audit of the auditors" or silently clearing a legal hold. PITR is a recovery mechanism, not tamper-prevention; deletion protection only blocks dropping the table.

**Impact:** The core compliance-oversight guarantee (immutable audit trail; immutable hold registry) is not enforced at the infra layer for the one set of tables whose immutability is the entire point.

**COA:** Bring the EB role under TF and attach an `iam_signatures`-style append-only Deny to `AdminAuditLog`/`LegalHolds`/`Adjudications`/`Disclosures`/`PayoutIntercepts` (deny `UpdateItem`/`DeleteItem`/`BatchWriteItem`). Extend the DDB-stream→Object-Lock WORM sink to at least `AdminAuditLog`. Narrow the EB role's blanket `UpdateItem`/`DeleteItem` so append-only tables are excluded.

---

## SEC-8 — Factoring payee/package reads leak any load's financials (IDOR info-disclosure)
**Severity:** MEDIUM

**Evidence (all `router.use(authenticate)` only, no ownership check):**
- `routes/factoring.ts:159-162` `GET /loads/:loadId/payee` → `resolveInvoicePayee(loadId)` returns the `optIn` (with `carrierId`, `partnerId`) or the resolved `CarrierOfRecord` for any load.
- `routes/factoring.ts:366-374` `GET /invoices/:invoiceId/package` → `buildPackageForInvoice(invoiceId, callerCarrierId)` (`:211`) loads any invoice and returns net settlement (`carrierNetCents`), debtor id + verified flag, POD status, charges — the load is never checked to belong to the caller.
- `routes/factoring.ts:165-168` `GET /loads/:loadId/pod` → POD-completeness for any load.

**Attack scenario:** Any authenticated user enumerates loadIds and reads who factors each load, the net carrier pay, and the debtor (shipper) identity.

**Impact:** Cross-tenant disclosure of financial relationships, net pay, and debtor identities. Lower than the write IDORs but still a tenant-isolation break.

**COA:** Gate each on carrier-of-record / party membership for the load; 404 for non-parties.

---

## SEC-9 — `DELETE /api/owner-operator/fleet/:driverId` orphans another operator's driver
**Severity:** MEDIUM

**Evidence:** `routes/ownerOperator.ts:235-259`. After a self-driver guard, it calls `OwnerOperatorService.removeFleetDriver(profile.operatorId, driverId)` (`services/ownerOperatorService.ts:108-113` — safely filters only the **caller's** list, a no-op if the driver isn't theirs), then **unconditionally** runs `Database.updateItem(driversTable, { driverId }, { ownedByOperatorId: null })` on the caller-supplied `driverId` with no check it belonged to the caller's operator.

**Attack scenario:** An owner-operator passes a `driverId` from a different operator's fleet (not `isSelf`). The link-clear runs against the victim driver, nulling `ownedByOperatorId`.

**Impact:** Severs another operator's fleet ownership; that driver no longer resolves to its carrier-of-record, potentially breaking dispatch, factoring/settlement carrier resolution, and verification for the victim. Cross-tenant tampering.

**COA:** Before the `ownedByOperatorId: null` write, assert `target.ownedByOperatorId === profile.operatorId` (or that `driverId ∈ profile.fleetDriverIds`); 404/403 otherwise.

---

## SEC-10 — Shared `github_oidc_role` module → prod deploy-role blast radius
**Severity:** MEDIUM (standing risk, per audit scope)

**Evidence:** `modules/github_oidc_role/main.tf` renders one role per env (`loadlead-${var.env}-github-deploy`) with a per-env trust `sub` (`:25-33`) and per-env-scoped permissions (EB app/env, frontend bucket, dynamodb prefix). The isolation **today is correct** — a dev-branch run cannot assume staging/prod (AWS-enforced OIDC `sub`). The standing risk is module-sharing: dev, staging, and prod all instantiate this same module, so any permission added to the module to unblock a lower env (e.g., a broad `Action`/`Res="*"`) is inherited by the **prod** deploy identity on the next apply.

**Impact:** A well-intentioned staging-focused edit silently widens the production deploy role. Change-management blast radius on a CI/CD identity.

**COA:** Keep per-env permission sets parameterized (pass allowed actions/resources as variables) so a lower-env grant can't leak into prod; require a prod plan review whenever this module changes; consider splitting the prod role's policy into its own reviewed file.

---

## SEC-11 — Canopy/Didit secrets set out-of-band on EB (not in tfvars / not code-reviewed)
**Severity:** MEDIUM

**Evidence:** `config/canopyConfig.ts:58-61` reads `CANOPY_CLIENT_ID/CLIENT_SECRET/WEBHOOK_SECRET` from env. The committed `backend/.env.staging` is an empty-value template and does not even list the `CANOPY_*` keys, confirming these secrets exist only in the EB environment, applied out-of-band (matches the project memory note). `.gitignore` correctly excludes `*.tfvars`/`.env`/`CREDENTIALS.md` (no secrets are git-tracked — verified via `git ls-files`).

**Impact:** (1) Recreate risk — an env rebuild loses the webhook/client secrets (the same class of failure that motivates SEC-1's guard); a missing webhook secret then fails closed in prod (`canopyWebhook.ts:61-64`, good) but a missing client secret silently disables Canopy. (2) These secrets bypass code review and IaC drift detection.

**COA:** Manage Canopy/Didit secrets via SSM Parameter Store / Secrets Manager referenced from TF (or `*.tfvars` in the secure backend), not hand-set EB vars; add a boot check that logs (never the value) which required integration secrets are present.

---

## SEC-12 — `jwt.verify` has no `algorithms` allowlist
**Severity:** LOW

**Evidence:** `middleware/auth.ts:32` — `jwt.verify(token, config.jwt.secret)` with no options; `helpers.ts:24` signs with default HS256. No `algorithms` pin anywhere (grep). With a symmetric string secret `jsonwebtoken` rejects `alg:none` and defaults to the HMAC family, so exploitability is low, but the allowlist should be explicit (defense-in-depth against future key-type changes / library defaults).

**COA:** `jwt.verify(token, secret, { algorithms: ['HS256'] })`.

---

## SEC-13 — Invitation tokens and factoring handoff payload logged in plaintext
**Severity:** LOW

**Evidence:**
- `services/orgService.ts:653,675,720` — `Logger.info('Invitation revoked/accepted: ${token} …')` writes org/self-signup invitation **bearer tokens** to logs.
- `services/factoring.ts:163` — `console.info('[factoring] handoff to partner …', JSON.stringify(payload))` writes load + BOL number + rate to logs.
Other integration logs reference secret **names** only, not values (checked `canopyWebhook.ts:63`, `didit.ts`, `fmcsa.ts` — all safe).

**Impact:** Anyone with log access can replay a still-valid invitation token (grant themselves an org membership) or read load/BOL business data.

**COA:** Log an invitation id / hashed token, not the raw token; drop or redact the factoring payload log.

---

## SEC-14 — `GET /api/compliance/policy/load/:loadId` has no party check
**Severity:** LOW

**Evidence:** `routes/compliance.ts:358-366` — under `router.use(authenticate)` only (no `requireShipper`/`requireOwnerOperator`, no party check). Returns the shipper policy attached to any load plus a signed document URL. Comment says "both parties," but any authenticated user can read any load's attached policy doc.

**Impact:** Minor cross-tenant disclosure of a shipper's compliance-policy document.

**COA:** Restrict to parties on the load (shipper owner / assigned hauler / admin).

---

## Positives confirmed (no action)
- **ADMIN MFA mandatory + non-bypassable**: `routes/auth.ts:132-146` — an ADMIN with no 2FA is hard-refused at login (`MFA_REQUIRED`, no token); any 2FA user gets only a short-lived ticket, and a session token is minted solely after `exchangeTwoFactorTicket(ticket, code)` at `/2fa/login` (`:154-163`). No cookie/token is issued pre-second-factor.
- **Admin bootstrap** locked: `routes/setup.ts` — 404 when `ALLOW_ADMIN_BOOTSTRAP!=='true'` (default off; staging/prod don't set it), 5/15min rate limit, atomic singleton via conditional put, every attempt audited.
- **W9 TIN crypto** fails closed: `utils/fieldCrypto.ts:80-83` throws in live mode without a key id; local key path is non-prod only (mode is production-locked). KMS scoped to exactly `GenerateDataKey`+`Decrypt` on the one key: `modules/backend_eb/main.tf:82-95`.
- **W9 full read** ownership + relationship gated + access-logged: `routes/compliance.ts:189-199` (owner `doc.ownerId===operatorId`), `:297-324` (shipper via `resolveShipperHaulerRelationship`, `openFullW9` writes the access log).
- **adminCompliance** (`routes/adminCompliance.ts`): `/me` inline ADMIN check; every surface gated by `requireStaffTier`/`requireComplianceRole` (fresh DB reads, never the JWT — `middleware/auth.ts:75-116`); sensitive reads via `AdminAuditService.withAudit` (audit-first, fail-closed — `services/adminAuditService.ts:43-70`); LE disclosure counsel-gated (`:193-206`).
- **Negotiations** party-bound: `services/negotiationService.ts:662-669` `requireHauler`/`requireActor` throw 403 on driver/shipper mismatch; e-sign gate at assign (`routes/negotiations.ts:156`).
- **Canopy webhook** signature: `services/canopy/canopySignature.ts` HMAC-SHA256 over `t.rawBody`, `timingSafeEqual`, 5-min replay window; `routes/canopyWebhook.ts:61-64` rejects unsigned in production; never logs secret/raw body.
- **Signatures WORM**: `envs/prod/worm-sink.tf` — S3 Object-Lock COMPLIANCE (7y) fed by DDB stream; genuinely immutable-by-design.
- **Injection/money**: no `eval`/`new Function`; DynamoDB expressions all parameterized (no template-literal `FilterExpression`/`KeyConditionExpression`); money via `assertIntegerCents`/`dollarsToCents`/`applyBps` (`utils/money.ts`).
- **Env isolation**: EB DynamoDB/S3 scoped by env prefix (`modules/backend_eb/main.tf:39-49`); `assertTablesEnvIsolated` boot guard blocks prod-form table names outside prod; OIDC trust per-env `sub`-scoped.
