---
connie-title: LoadLead — Pending Register (read this first)
connie-publish: true
status: Reconciled
last-reconciled-against: 2054ab2
generated-by: docs reconciliation pass 2026-06-28
connie-page-id: '2228225'
---

# LoadLead — Pending Register

> **Read this first.** Every PARTIAL / PENDING / NOT-STARTED item across product and security, prioritized blockers-first. Reconciled against commit `2054ab2` (the actual code, not the specs).

Each item carries: **Evidence** (where in the repo the gap shows up) · **Severity** (Critical / High / Med / Low) · **Owner** (when assigned) · **Fix** (one-line resolution). Anything marked Done is in the architecture/security docs with a file/route citation, not here.

---

## 🔴 GO-LIVE BLOCKERS (none currently open)

No production-blocking items open right now. The blockers from earlier in this stream — admin bootstrap exposure, errorHandler order, OO router gate, one-parent invariant deadlock — have all shipped to prod and are tested. See `docs/ATTESTATION_PHASE_1.md §1d` and `docs/AUDIT.md` for the closed-blocker ledger.

---

## 🟠 HIGH — security / privilege / data-integrity gaps

| # | Item | Evidence | Severity | Fix |
|---|------|----------|----------|-----|
| 1 | **`/api/maps/*` 3 routes are public** | `backend/src/routes/maps.ts` — no `router.use(authenticate)`, no inline `authenticate` on any of `POST /estimate`, `GET /geocode`, `GET /reverse-geocode`. Google Maps quota is exposed to any caller; cost-DoS surface. | **High** | Add `router.use(authenticate)` at file top; require any authenticated user (no role gate needed — maps is read-only). 5-min fix; flagged because it shipped to prod without auth. |
| 2 | **STIG checklist: 38/38 controls "Not Reviewed"** | `docs/security/stig-checklist.md` — every LL-* row's status column reads `Not Reviewed`. Control-coverage metric = 0% reviewed. Many controls are *implemented* (see `docs/SecurityPosture.md §controls map`) but no one has signed the row off. | High | Walk the 38 controls; mark each `NotAFinding` (with evidence path), `Open` (with finding), `Not Applicable` (with reason), or leave `Not Reviewed`. ~3 hours of focused review. |
| 3 | **Pact provider verification still uses in-process stub** | `backend/tests/contract/verify-provider.ts` builds a stub Express app with hand-mirrored handlers. Catches *structural* drift (renamed/missing fields, wrong status codes); does NOT catch *semantic* drift (real auth path, real DDB queries, real signature service). Documented follow-up in `docs/LoadLead_CrossPersona_Contract_UAT_BDD.md`. | High | Wire verify-provider against the real Express app + DDB Local sidecar. 1 session. |
| 4 | **MFA enrollment exists for admin TOTP only** | `backend/src/routes/auth.ts:/2fa/*` — TOTP 2FA is plumbed end-to-end. No WebAuthn, no enforcement of MFA on privileged roles (CARRIER_ADMIN, OWNER_OPERATOR). STIG LL-IA-004 maps here. | High | Decide policy: (a) enforce TOTP for ADMIN at minimum, (b) extend the enforcement to CARRIER_ADMIN, (c) ship WebAuthn alongside. Policy + rollout = 1 session. |
| 5 | **Stale Terraform state files in `_bootstrap/`** | `infra/terraform/_bootstrap/.terraform/`, `_bootstrap/terraform.tfstate`, `_bootstrap/terraform.tfstate.backup`, `_bootstrap/.terraform.lock.hcl` — untracked, local-only, but the dir lacks a `.gitignore` like `envs/prod/` does. Accidentally committing one of them would leak the AWS state path. | High | Add `infra/terraform/_bootstrap/.gitignore` listing `.terraform/`, `*.tfstate*`. 1-line fix. |
| 5a | **bcrypt cost factor is 10; STIG LL-IA-001 recommends ≥12** | `backend/src/utils/helpers.ts:14` — `bcrypt.hash(password, 10)`. SecurityPosture §auth previously read "cost ≥ 10"; the literal is exactly 10, a ~4× lower work factor than the STIG target. Not exploitable online (auth is rate-limited + privileged accounts carry 2FA); the gap is offline-cracking margin if a hash dump ever leaks. | High | Raise to 12 in `helpers.ts`; transparently re-hash on next successful login (compare-then-upgrade). ~1 hr. |

---

## 🟡 MEDIUM — coverage / consistency gaps

| # | Item | Evidence | Severity | Fix |
|---|------|----------|----------|-----|
| 6 | **`correctsSignatureId` has no admin UI** | Field plumbed end-to-end (input + persisted + tested in `backend/tests/reliability/signatureReplayProtection.test.ts`) but no surface in `frontend-v2/src/components/admin/AttestationLookup.tsx` shows "this correction supersedes prior sig X." | Med | Render the link on the admin chain panel. <1 day. |
| 7 | **UAT-CT-* sign-off blank for all 7 personas** | `docs/UAT_CT_Checklist.md` — every Tester/Date/Result cell empty. The automated `@H5..@H11` pacts pass; the human ratification that the contract IS what each persona team wants is pending. | Med | Persona team leads review each pact file + sign their row. Per-persona, ~30 min review each. |
| 8 | **9 of 28 critical DDB tables had PITR off pre-import** | Fixed during the TF import (commit `d1a3ec6`) — all 28 now have PITR. The gap existed for ~weeks. Worth a calendar audit (`backend/scripts/audit-pitr.sh`) or a CloudWatch alarm on PITR state changes. | Med | Add a Config Rule or scheduled Lambda that posts to SNS when PITR is disabled on any `LoadLead_*` table. ~2 hrs. |
| 9 | **Provider stub vs real Express** (subset of #3) | Same root cause as #3; broken out so it counts in BOTH the security gap (no semantic verification) AND the test-coverage gap (the in-process stub artificially passes). | Med | See #3. |
| 10 | **CloudFront customer distro: 4 blocks ignored by TF** | `infra/terraform/envs/prod/cloudfront-imported.tf` — customer distro has `lifecycle.ignore_changes = [origin, default_cache_behavior, ordered_cache_behavior, custom_error_response]`. TF tracks identity + WAF + cert + aliases only. Drift in those 4 blocks is invisible to plan. | Med | One-block-at-a-time migration: read live, write block matching, remove from ignore list, plan must be no-op. ~30 min per block. |
| 11 | **EB env imported identity-only (151 OptionSettings ignored)** | `infra/terraform/envs/prod/eb-imported.tf` — `lifecycle.ignore_changes = [setting, version_label]`. TF tracks the env exists; OptionSettings stay managed by EB console / deploy-backend.sh / .ebextensions. | Med | Per-setting migration as above. Or accept the trade and document it (current state). |
| 12 | **Pact deliberate-break only supports `oo-web`** | `backend/tests/contract/verify-provider.ts:DELIBERATE_BREAK` switch only handles `oo-web`. The @H11 scenario language implies the demo should work against any persona. | Med | Add break cases for `shipper-web` / `driver-web` / `carrier-web` / `receiver-web` / `admin-console`. ~10 min each. |
| 13 | **Real Express + DDB Local for verify-provider** (subset of #3 + #9) | Same. Listed once more as the canonical entry. | Med | Same. |

---

## 🟢 LOW — hygiene / nice-to-have

| # | Item | Evidence | Severity | Fix |
|---|------|----------|----------|-----|
| 14 | **3 test-fixture branches on remote** | `test/blocked-pr`, `test/jira-ref-check`, `verify/protection-live` — intentional evidence the SCRUM-key CI gate works. Could be deleted now that the gate is documented and trusted. | Low | `git push origin --delete test/blocked-pr test/jira-ref-check verify/protection-live` if you want a cleaner branch list. |
| 15 | **`audit-outstanding.json` overlaps this register** | `docs/audit-outstanding.json` has 8 items (the earlier audit's leftovers). Same surface as Items #2/#7/#11–#13 here. Worth consolidating so contributors look at ONE list. | Low | Either fold audit-outstanding.json entries into this file, or replace it with a pointer to this file. |
| 16 | **PactFlow free-tier 30-day trial active** | The Enterprise trial auto-drops to free tier in ~30 days. Free tier handles 100 verifications/mo; workflows trigger on contract-file changes only, so this is fine. Worth a calendar reminder to confirm tier on day 31. | Low | Calendar event for `2026-07-25`. Or downgrade explicitly via Settings → Plan in PactFlow now. |
| 17 | **16 secondary DDB tables not in TF previously** (fixed) | `infra/terraform/envs/prod/imported-tables.tf` — all 16 are now imported in commit `d1a3ec6`. Listed here as a completed item; will move out of this register on next reconciliation. | Done | n/a |
| 18 | **Driver-side `correctsSignatureId` UX** (sub of #6) | Same as #6. | Low | Same. |

---

## How this register is maintained

This file is rebuilt on every docs reconciliation pass (currently manual; future cron). The contract is:

- **No fabricated items** — every row cites a concrete file/route/test/scan output.
- **Severity is judged by blast radius, not by ease of fix.** A 5-minute fix can be High if the gap exposes a quota-DoS surface (Item #1).
- **Done items live in `docs/Architecture_Backend.md` / `Architecture_Frontend.md` / `SecurityPosture.md`** with the file citation. This register is for *not-yet-done* only.
- **Reconciled commit SHA** at the top of this file. If you read this against a later commit, some rows may be stale; re-run the reconciliation pass.

## Source data

- `docs/audit-outstanding.json` — prior audit's open items (8)
- `docs/security/stig-checklist.md` — 38 LL-* controls
- `backend/src/routes/*.ts` — live route inventory (177 routes, 156 auth'd, 21 public)
- Latest compliance CI run: `gh run view 28144118496` (all green)
- This pass's reconciliation findings (new in this register)
