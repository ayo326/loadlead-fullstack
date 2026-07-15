# Platform E2E Audit v6 (2026-07-14) - Dimension 3: Environment parity (dev/staging/prod)

## Executive summary
One actionable parity defect: dev is missing the new `CapacityStateEvents` table-name override, so on dev it resolves to the PROD table name. This is the exact "non-prod could touch prod data" class this dimension targets, and it was caught RED by the CI parity checker. Real blast radius is contained by three independent mitigations (dev never applied, runs on local DynamoDB, fail-closed boot guard). Prod table coverage is complete, the boot guard is sound and fully wired, integration-mode and feature-flag divergence is intentional and correct. Staging backend is currently paused.

## Finding 1 - HIGH: Dev missing DYNAMODB_CAPACITY_STATE_EVENTS_TABLE; resolves to the PROD table name
- Evidence: `node scripts/check-table-env-parity.mjs` exits 1 (FAIL): "dev: no DYNAMODB_TABLE_PREFIX and 1 config table override(s) missing." Code slot: `backend/src/config/environment.ts:71` `capacityStateEventsTable: t('DYNAMODB_CAPACITY_STATE_EVENTS_TABLE', 'LoadLead_CapacityStateEvents')`. `infra/terraform/envs/dev/main.tf` has neither that override nor an uppercase `DYNAMODB_TABLE_PREFIX` env var; dev uses per-table enumeration (lines 177-247) and the new SCRUM-9 table was never added.
- Root cause: `backend_eb` consumes `dynamodb_table_prefix` only for IAM ARN scoping (`modules/backend_eb/main.tf:40-41,59`); it does NOT emit a `DYNAMODB_TABLE_PREFIX` env var. So dev's `dynamodb_table_prefix = local.prefix` never reaches the app; every table must be enumerated, and this one was missed. With no override, `t()` falls through to the prod default `LoadLead_CapacityStateEvents`.
- Impact: if the dev EB env were ever applied and pointed at real AWS, its hauler-capacity feature would read/write the PRODUCTION `LoadLead_CapacityStateEvents` table.
- Mitigations (why HIGH not Critical): (1) `envs/dev/main.tf:1-9` - dev stack has never been applied; dev runs against local DynamoDB. (2) `bootGuard.assertTablesEnvIsolated()` fails closed on any `LoadLead_*` prod-form name, so a hosted dev env would refuse to boot. (3) The physical `LoadLead-Dev-CapacityStateEvents` table IS defined in the tableset module; only the env-var pointer is missing.
- COA: replace dev's ~45-line enumeration with the staging pattern - add `DYNAMODB_TABLE_PREFIX = local.prefix` to the dev `env_vars` block (covers all 52 config tables at once, robust to future additions), keeping only the 10 service-direct overrides. Re-run the checker to green. Same migration staging already completed (`envs/staging/main.tf:277`).

## Finding 2 - LOW/INFO: Prod fail-closed invariants enforced out-of-band, not by Terraform
- Evidence: `envs/prod/eb-imported.tf:48-67` imports the prod EB env identity-only with `lifecycle.ignore_changes = [setting, version_label]`. So `APP_ENV=production`, all `*_MODE` vars, `JWT_SECRET`, and the absence of `DYNAMODB_TABLE_PREFIX` live only on the live EB env (console / deploy-backend.sh).
- Impact: the lockdown keys off `APP_ENV=production` (`modeResolver.ts:62`, `bootGuard.ts:26`); neither that nor "prod carries no prefix" is enforced by IaC, so a console fat-finger is not caught by `terraform plan`. The boot guard is the runtime backstop.
- COA: accept as documented design, or migrate `APP_ENV` (+ no-prefix assertion) into a TF `setting {}` block. Low priority.

## Finding 3 - LOW/INFO: Staging .auto.tfvars sets values that merge() silently overrides
- Evidence: `staging.auto.tfvars` sets `BETA_MODE="true"`, `NODE_ENV="production"`, but `envs/staging/main.tf:228` merges a literal block that wins: effective `BETA_MODE=off`, `NODE_ENV=staging` (correct). The tfvars values are dead/misleading. The file is correctly gitignored/untracked (no secret exposure).
- Impact: none functional; a maintenance trap. Latent: tfvars also carries `GOOGLE_MAPS_API_KEY`/`FMCSA_WEBKEY`, inert while MAPS/FMCSA default to stub in staging, but a smoke flipping either live would make real billed/registry calls on possibly prod-shared keys.
- COA: drop `BETA_MODE`/`NODE_ENV` from tfvars.

## Parity matrix (62 slots: 52 prefix-derived config + 10 service-direct)
| Axis | dev | staging | prod |
|---|---|---|---|
| Physical tables (tableset module, incl CapacityStateEvents) | present (all 62) | present (all 62) | - |
| Physical tables (prod main.tf + imported/compliance/canopy) | - | - | present (all 62) |
| Env-var pointers, 52 config tables | 51/52 (enumerated) | 52/52 (via prefix) | defaults `LoadLead_*` |
| Env-var pointers, 10 service-direct | 10/10 | 10/10 | defaults |

Single divergent cell: `CapacityStateEvents` dev env-var MISSING -> resolves to `LoadLead_CapacityStateEvents` (prod); staging `LoadLead-Staging-CapacityStateEvents`; prod `LoadLead_CapacityStateEvents`. All other 61 slots in full parity. Note: prod carries a legacy `LoadLead_AdminAudit` (imported-tables.tf:405) distinct from `LoadLead_AdminAuditLog` - likely orphaned, prod-only, no parity impact.

Spot-check LoadLead_CapacityStateEvents: prod `envs/prod/main.tf:340-353` (eventId hash + equipmentId-index GSI, deletion protection); staging/dev physical `modules/dynamodb_tableset/main.tf:323-332`. Dev env-var pointer missing (Finding 1).

## Parity checker: FAIL (exit 1) - staging green, dev fails on the one missing override. Checker logic is sound.

## Boot-guard review (bootGuard.ts): SOUND, no holes
- (a) Blocks non-prod using prod names: `assertTablesEnvIsolated()` (:130) + `prodFormTableNames()` (:118) flag underscore form and the dash outlier `LoadLead-MembershipAuditLogs`, whitelist `LoadLead-Staging-`/`LoadLead-Dev-`. Intentional bypass when `DYNAMODB_ENDPOINT` set (local DDB).
- (b) Prod refuses boot on missing required GSIs: `assertRequiredIndexesActive()` (:258), 5 required indexes; non-prod logs and continues.
- (c) Prod-hardening self-check: `assertProductionHardened()` (:211) every integration must resolve live, no `/_test` mounted.
- Contamination + auth guards: `assertProductionNotContaminated()` (:38), `assertNonProductionSafe()` (:73), `assertAuthSecretStrong()` (:171).
- Wiring: `index.ts:18,385,390` all run before `app.listen()` (:392); any BootGuardError -> exit 1. Fully fail-closed.

## Cross-env divergence: all intentional/correct
Prefixes LoadLead-Dev-/LoadLead-Staging-/none. APP_ENV development/staging/production. BETA_MODE on/off/on. FLEET_CARRIER_PERSONA_ENABLED off/true/off. didit sandbox/sandbox/live. fmcsa+maps stub/stub/live. email+push test+capture/.../live. Non-prod uses stubs/sandbox; prod all live. Capacity policy (`config/capacityPolicy.ts`) is a hardcoded constant (soft filter, 12h stale, unknown->rated), not env-derived, so it cannot diverge.

## Staging reachability: backend PAUSED (ASG scaled to 0 via toggle.tf); static frontend 200. Not smoke-testable without resume.
