# Audit v5 — Dimension 03: Environment Parity & Reconciliation (dev / staging / prod)

**Date:** 2026-07-12  **AWS:** account 552011299815, us-east-1
**Envs:** dev = UNPROVISIONED (code/config only) · staging = EB `loadlead-backend-staging` (e-md6gjtb3yp, Green) · prod = EB `loadlead-backend-prod` (Green)
**Prefix scheme:** prod = `LoadLead_` (underscore) + one dash outlier `LoadLead-MembershipAuditLogs` · staging = `LoadLead-Staging-` · dev = `LoadLead-Dev-` (TF only)

Config file is `backend/src/config/environment.ts` (not `env.ts`). Table counts: staging 62 base tables, prod 59 underscore + 1 dash = 60. All AWS/tofu commands were run live.

---

## Parity Matrix (env × dimension)

| Dimension | dev | staging | prod |
|---|---|---|---|
| Provisioned in AWS | No | Yes (Green) | Yes (Green) |
| `APP_ENV` (live) | (unset → `development`) | `staging` ✓ | `production` ✓ |
| DDB table-defn source (IaC) | `modules/dynamodb_tableset` | `modules/dynamodb_tableset` | `envs/prod/imported-tables.tf` + `canopy.tf` (**separate**) |
| EB env-vars in IaC | `dev/main.tf` (enumerated) | `staging/main.tf` (prefix+overrides); **Canopy secrets out-of-band** | **NONE** — `ignore_changes=[setting]`, all out-of-band |
| Table isolation | `DYNAMODB_TABLE_PREFIX` + overrides | `DYNAMODB_TABLE_PREFIX=LoadLead-Staging-` + 10 direct overrides | hardcoded `LoadLead_` defaults + redundant overrides |
| Canopy tables (2) | (module) | present | **MISSING** (canopy.tf unapplied) |
| Canopy secrets | n/a | live-env only (not in tfvars) | not set (Canopy inert) |
| Offers `loadId-index` | (module: absent) | **ABSENT → 500s** | present (durable, imported-tables.tf) |
| Loads `status-createdAt-index` | (module: present) | present | **ABSENT** (unused by code) |
| 5 boot-required GSIs | n/a | all ACTIVE ✓ | all ACTIVE ✓ |
| `tofu plan` | n/a | **DIRTY (1 to change)** | n/a (settings ignored by design) |

---

## Findings

### EP-1 — Prod EB env-var configuration is entirely out-of-band; no IaC source of truth — HIGH
**Evidence:** `infra/terraform/envs/prod/eb-imported.tf:48-67`
```
resource "aws_elastic_beanstalk_environment" "backend_prod" {
  # No setting {} blocks here — AWS-side settings are the source of truth, ignored by TF.
  lifecycle { ignore_changes = [ setting, version_label ] }
}
```
Corroborated by `prod/compliance-documents.tf:14` and `prod/canopy.tf:14` ("the … APP env vars are NOT set here").
The live prod env carries ~37 env vars (`APP_ENV=production`, `W9_TIN_KMS_KEY_ID`, `JWT_SECRET`, `DIDIT_*`, `RESEND_API_KEY`, table overrides, etc.) — **none are in Terraform.**
**Impact:** Prod's entire runtime configuration lives only on the live EB env. A DR rebuild / env recreate starts from Terraform, which has zero `setting` blocks → every env var lost. Because boot is fail-closed, a recreated prod env with `APP_ENV` unset would refuse to boot (`assertTablesEnvIsolated` throws on the `LoadLead_` names) — i.e. prod stays down until an operator re-enters all vars from memory. No committed record, no drift detection (`ignore_changes` hides it). This is the same non-durability class as the Canopy-secret issue, but platform-wide for prod, and it is the largest parity gap: staging validates a Terraform-managed env-var path that prod does not use.
**COA:** Capture prod's current env vars into an encrypted, committed source (SOPS/SSM-Parameter-Store block or a sealed tfvars), then migrate them under Terraform incrementally using the documented "remove pair from `ignore_changes`" procedure (`eb-imported.tf:15-24`). At minimum, snapshot the non-secret keys (APP_ENV, table overrides, KMS key id, bucket names) into git now so a rebuild is recoverable.

### EP-2 — Canopy prod tables are defined in Terraform but not provisioned; latent 500 — HIGH
**Evidence:** `aws dynamodb list-tables` shows **no** `LoadLead_CarrierInsuranceConnections` and **no** `LoadLead_CoiCrossReferenceResults` in prod (staging has both). Yet `prod/canopy.tf:20-38` defines them:
```
module "..." { source="../../modules/dynamodb_table"; name="LoadLead_CarrierInsuranceConnections" }
module "..." { source="../../modules/dynamodb_table"; name="LoadLead_CoiCrossReferenceResults" }
```
Code defaults to those exact names (`environment.ts:182-189`).
**Impact:** `canopy.tf` has never been applied to prod. Today Canopy is inert in prod (no `CANOPY_CLIENT_ID/SECRET/PUBLIC_ALIAS` on the prod env → `canopyConfig.connectEnabled=false`, degrades to manual). But the gate is *secret-absence*, not a table check: the moment anyone sets Canopy secrets on prod, `connectEnabled` flips true and the first connection write throws `ResourceNotFoundException` (500). `resolveMode('canopy')` is force-locked to `production` in prod, so there is no sandbox fallback. Aligns with memory ("Canopy not yet prod-deployed").
**COA:** Apply `prod/canopy.tf` (create the two tables + KMS) **before** any Canopy secret is placed on the prod env; add a boot check that refuses Canopy-enabled boot if the two tables are absent.

### EP-3 — staging `Offers` table missing `loadId-index`; `getOffersByLoad` 500s in staging — HIGH (staging-scoped)
**Evidence:**
- `describe-table LoadLead-Staging-Offers` GSIs = `driverId-status-index, driverId-index, loadId-driverId-index` (**no `loadId-index`**).
- `describe-table LoadLead_Offers` (prod) GSIs = `loadId-index, driverId-status-index, driverId-index, loadId-driverId-index`.
- `offerService.ts:112-124` `getOffersByLoad()` → `Database.query(offersTable, 'loadId-index', …)` with **no scan fallback** (just `throw error`).
- Root cause: shared module `modules/dynamodb_tableset/main.tf:85-92` (Offers block) defines only the `driverId*` and `loadId-driverId` GSIs — **`loadId-index` is absent**. Prod's copy is a *separate* definition (`prod/imported-tables.tf:118-123`) that *does* include it.
**Impact:** Any staging call to `getOffersByLoad` (shipper "offers on this load" view, accessorial/negotiation lookups) throws `ValidationException`. Prod works only because prod's Offers table is defined in a different file that happens to carry the index. Staging is therefore an unfaithful mirror — a prod-working feature appears broken in the pre-prod env, defeating pre-prod validation.
**COA:** Add `{ name = "loadId-index", hash_key = "loadId" }` to the Offers block in `modules/dynamodb_tableset/main.tf`, `tofu apply` staging. Longer term, generate both envs' tables from one source so prod (`imported-tables.tf`) and staging (module) cannot drift.

### EP-4 — Canopy secrets non-durable in staging + main.tf comment falsely claims they are managed — HIGH
**Evidence:**
- Live staging EB env has `CANOPY_CLIENT_ID`, `CANOPY_CLIENT_SECRET`, `CANOPY_WEBHOOK_SECRET` (present in the EB env-var key dump).
- `staging/staging.auto.tfvars` (dumped in full) contains **no `CANOPY_*` keys**.
- `staging/main.tf:253-266` merge adds only `CANOPY_UI_MODE` + `CANOPY_PUBLIC_ALIAS` (non-secret).
- Count proof: Terraform-desired env vars = 13 (tfvars) + 19 unique (main.tf merge) = **32**; live staging env = **35** keys. The 3-key delta is exactly the three Canopy secrets.
- `staging/main.tf:255-260` (edited today, 12:34) states: *"The SECRETS … go in backend_env_vars via the gitignored staging.auto.tfvars … so tofu manages them and a launch-template -replace can never wipe them again. These three were previously set out-of-band on the EB env and were lost when the env was recreated."* — **this remediation is documented but was never actually done** (tfvars has no such keys).
**Impact:** The three secrets exist only on the live env. A full env recreate (which already destroyed them once, per the same comment) wipes them again → staging Canopy silently degrades to manual. Worse, the comment actively misleads: a reader trusting it believes the secrets are safe. (A routine `tofu apply` currently preserves them — the plan's 43-remove/43-add is balanced, so the provider leaves the 3 unmanaged vars in place — but recreate does not.)
**COA:** Actually add the three `CANOPY_*` secrets to `staging.auto.tfvars` (matching the comment), or correct the comment to state they are out-of-band. Same fix must precede prod Canopy enablement (EP-2).

### EP-5 — staging `tofu plan` is not clean (drift; committed TF not applied) — MEDIUM
**Evidence:** `cd infra/terraform/envs/staging && tofu plan` →
```
# module.backend.aws_elastic_beanstalk_environment.this[0] will be updated in-place
Plan: 0 to add, 1 to change, 0 to destroy.
```
The single change rewrites 43 `setting` blocks (43 removed / 43 added, all sensitive-hidden). `staging/main.tf` was last edited today 12:34 (Canopy block); the live env has not been reconciled since.
**Impact:** Known-issue 4(c) confirmed — plan is **not** "No changes". The staging env is running config that diverges from committed Terraform; every unrelated future apply will carry this churn, obscuring real diffs.
**COA:** Reconcile — `tofu apply` staging during a maintenance window (verify the 3 Canopy secrets survive, per EP-4), or fold the intended change in explicitly. Add a CI "staging plan is clean" gate.

### EP-6 — Loads `status-createdAt-index` present in staging/module but absent in prod — MEDIUM
**Evidence:** `modules/dynamodb_tableset/main.tf:70` defines `status-createdAt-index` on Loads; staging has it; `describe-table LoadLead_Loads` (prod) = `status-index, shipperId-index` only. No code queries `status-createdAt-index` (grep: only negotiation `loadId-createdAt-index` and bootGuard use `createdAt`).
**Impact:** No 500 (index is unused), but it is genuine two-way schema drift from maintaining prod (`imported-tables.tf`) and staging (module) separately — a prod `tofu plan` would either try to add it or the divergence is silently accepted. Same root cause as EP-3.
**COA:** Decide the canonical set; either drop it from the module or add it to prod, and unify the two table definitions.

### EP-7 — `assertTablesEnvIsolated` prod-form detector misses the dash-named prod table — MEDIUM
**Evidence:** `bootGuard.ts:109-113` `prodFormTableNames` flags only names starting with `LoadLead_` (underscore). But `environment.ts:59` `membershipAuditTable` default is `LoadLead-MembershipAuditLogs` (dash) — a real prod table (`aws dynamodb list-tables` confirms `LoadLead-MembershipAuditLogs` exists, holding prod data).
**Impact:** A non-prod env that resolved `membershipAuditTable` to the dash-named prod table would **not** be caught by the runtime isolation guard. Currently masked: staging sets `DYNAMODB_TABLE_PREFIX`, so it derives `LoadLead-Staging-MembershipAuditLogs` correctly (the `replace(/^LoadLead[_-]/,'')` strips both forms); and if the prefix were unset, the ~50 underscore tables would trip the guard first. It is a latent defense-in-depth gap only. The **CI** check does cover it via `KNOWN_SUFFIX.DYNAMODB_MEMBERSHIP_AUDIT_TABLE` (`check-table-env-parity.mjs:30-32`).
**COA:** Broaden `prodFormTableNames` to also flag the dash-named prod table (e.g. detect `LoadLead-MembershipAuditLogs` or any prod-form name not prefixed by the env's own prefix).

### EP-8 — never-live-outside-prod does not cover `kms` (and `fmcsa`/`maps` are warn-only) — LOW / informational
**Evidence:** `bootGuard.ts:70-71` `NEVER_LIVE_OUTSIDE_PROD = ['didit','email','push','canopy']`; `WARN_IF_LIVE_OUTSIDE_PROD = ['fmcsa','maps']`. `kms` is in neither list, so staging's live `KMS_MODE=live` (`staging/main.tf:249`) is allowed silently. The audit brief expected `maps` among the never-live set; code deliberately makes maps/fmcsa warn-only (documented rationale: paid API/gov lookup, no real human).
**Impact:** Minimal — `kms` live outside prod only touches that env's own per-env W9 key; maps/fmcsa live outside prod is loud. All 7 integrations (`didit, fmcsa, maps, email, push, kms, canopy`) are covered by `modeResolver` and the production lock keys off `APP_ENV` (not `NODE_ENV`) ✓.
**COA:** None required; optionally document that kms is intentionally omitted from the never-live guard, or add it for symmetry.

### EP-9 — Intentional, documented staging↔prod flag divergences — LOW / informational (not defects)
`BETA_MODE`: staging `off` / prod `true` (private-beta wall only in prod). `FLEET_CARRIER_PERSONA_ENABLED`: staging `true` / prod unset→`false` (persona muted in prod). `KMS_MODE`: staging `live` / prod unset (force-live). All explained in `staging/main.tf:235-249` and correct by design; listed for completeness.

---

## Known-issue verification (task item 4)

- **4(a) — prior HIGH "staging could WRITE PROD TABLES if an override missing":** CURRENTLY SAFE, not fully eliminated.
  - Runtime: `bootGuard.assertTablesEnvIsolated` fails closed for all config-routed tables and any present `DYNAMODB_*_TABLE` override (`bootGuard.ts:115-143`).
  - The direct-read tables (Notifications, Push, PasswordResets, SetupTokens, AdminBootstrapAttempts, OwnerOperators, FleetInvites, Verifications, FactoringOptIns, CarrierFactoringProfiles) are read as `process.env.X || 'LoadLead_…'` with prod-form defaults and are **not** in `config.dynamodb` — the runtime guard can only catch them when the override is *present* (it iterates present env vars), i.e. it cannot detect a *missing* one.
  - Compensating control: `scripts/check-table-env-parity.mjs` statically reconciles **both** prefix-derived and service-direct tables against `staging/main.tf` + `dev/main.tf`, and **is wired** into CI (`.github/workflows/deploy-backend.yml:34` and `:84`). Staging currently has `DYNAMODB_TABLE_PREFIX=LoadLead-Staging-` **plus all 10** direct overrides (verified live), so no table resolves to prod form. **Residual risk:** the CI check validates Terraform *source*, not deployed EB state; given both envs already drift from TF (out-of-band secrets, EP-1/EP-4), a source-only check has a blind spot vs live reality, and prod's out-of-band table overrides are parity-checked by nothing.
- **4(b) — Canopy secrets set out-of-band on staging, recreate would wipe:** CONFIRMED and worse than described — the documented fix (secrets in tfvars) was never applied and the comment now falsely claims durability. See **EP-4**.
- **4(c) — `tofu plan` staging drift:** CONFIRMED not clean — `Plan: 0 to add, 1 to change, 0 to destroy`. See **EP-5**.

## Positive confirmations
- `APP_ENV` correct in both live envs (staging=`staging`, prod=`production`) — the single most important lockdown signal.
- All 5 boot-required GSIs ACTIVE in **both** staging and prod: `LoadNegotiations/loadId-createdAt-index`, `NegotiationOffers/negotiationId-createdAt-index`, `Loads/shipperId-index`, `AccessorialCharges/loadId-index`, `ComplianceDocuments/ownerId-index` (`bootGuard.ts:218-226`).
- Historically-drifted indexes now present in both: `Loads/status-index`, `Offers/driverId-status-index`, `Verifications/status-index`, plus `Notifications/userId-index`, `Drivers/userId-index`, `Signatures/loadId-signedAt-index`, `FactoringOptIns/loadId-index`.
- `modeResolver` covers all 7 integrations and the production lock ignores stray mode env vars; `assertProductionNotContaminated` refuses boot on any non-live mode var in prod; `assertProductionHardened` re-verifies post-assembly.
