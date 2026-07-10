# LoadLead — Platform-Wide E2E Audit (v4)

Date: 2026-07-10   Auditor: Platform Engineering   Scope: Full stack — backend business logic, frontend, live smoke, and cross-environment parity (dev / staging / prod). Ref commit ee33702 (main). Prior rounds: v1 2026-06-25, v2/v3 2026-07-03/04.

## 1. Executive summary

This is the healthiest audit result of the three rounds — and the first with the SCRUM-59 compliance-documents surface (W-9/COI/LOA/shipper policy) in scope. All automated verification is green: 698/698 backend tests (90 files, +68 tests vs v3), frontend typecheck/build clean, 46/46 Playwright E2E, and — for the first time — zero Terraform drift in both staging and prod. The v3 HIGH env-parity defect (staging silently writing prod tables) is structurally closed: staging resolves all 49 config tables through one DYNAMODB_TABLE_PREFIX, the boot guard fails closed on any prod-name leak, and prod has zero missing tables (56 required, all present). The production frontend bundle is byte-identical to a fresh HEAD build, and the W-9 render self-check returns the same content hash on local, staging, and prod — deterministic renders across environments.

The risk profile has therefore shifted from configuration/parity defects (v2/v3) to concurrency correctness and scale readiness. The four HIGH findings this round are: (H1) an ACCEPTED negotiation can permanently lack its pinned shipper-policy snapshot after a transient error, with no repair job; (H2) the compliance-document supersede is an unconditional read-then-flip, so concurrent W-9 submits can leave two "current" versions; (H3) a cluster of full-table scans on request-hot paths (relationship resolution scans the loads table on every packet/document open) that will not survive beta scale-up; and (H4) the public W-9 render self-check endpoint — added 2026-07-09 by our own deploy-smoke work — is CPU-bound and has no rate limiting (only /api/auth is limited), making it a low-effort DoS vector. All four have small, well-bounded fixes (Section 6).

One process win worth institutionalizing: the authenticated staging W-9 E2E run on 2026-07-09 caught a template-packaging bug that route-mount smoke had passed over for both environments. The lesson — smoke must exercise the real path, not just the mount — is now encoded in the deploy pipeline (render self-check) and should be extended to a scheduled synthetic (Section 7).

## 2. Scorecard

Backend unit/integration | PASS | 698/698, 90 files, 4.5s. One known-flaky test (fieldCrypto tamper — base64 padding-bit flip; passed this run; fix task open). | 

Frontend typecheck + build | PASS | tsc clean; Vite build clean; no react-vendor split (the prod blank-page gotcha); single 413 KB vendor chunk. | 

Frontend E2E (Playwright) | PASS | 46/46 — hauler negotiation H1–H9 (incl. e-sign gate + window expiry), shipper S1–S5 (accept/counter/reject/live-update), public-route crawl, tour scoping. | 

Prod FE = HEAD | PASS | Fresh build emits index-CCIOeFp8.js / vendor-DfqDJZw7.js — identical hashed names to the live prod bundle. No unshipped FE delta. | 

Terraform drift — staging | CLEAN | tofu plan: No changes. | 

Terraform drift — prod | CLEAN | tofu plan: No changes (first fully-clean prod plan; worm-sink .DS_Store drift fixed in PR #53). | 

Terraform — dev | N/A — never applied | Plan fails on unset required variables; 0 LoadLead-Dev-* tables and no dev EB env exist in AWS. Dev is local-DynamoDB in practice (L4). | 

Table parity | PASS | Parity script green (staging via prefix + 10 service overrides; dev via explicit list). Prod: 56 required tables, 0 missing, 1 true orphan (LoadLead_AdminAudit, L1). | 

EB config parity | PASS | Only intentional diffs: prod BETA_MODE=true (private-beta wall) / staging off; staging opts in KMS_MODE=live + persona flag; prod forces KMS live via APP_ENV lock. | 

Live smoke — prod + staging | PASS | Health + productionHardened:true; guards 401; beta gate 403 BETA_REQUIRED (structured, fail-closed); /_test absent in prod; SPA fallback 200 on deep routes; index.html no-cache / assets immutable; W-9 render-check hash identical across local/staging/prod. | 

## 3. Environment parity matrix

Exists in AWS | No (paper stack) | Yes (pausable) | Yes | L4: decide dev's fate | 

Table namespace | local / LoadLead-Dev- (unapplied) | DYNAMODB_TABLE_PREFIX=LoadLead-Staging- + 10 service overrides | LoadLead_* defaults (no overrides) | Fail-closed via boot guard | 

Env-var payload | — | 1,511 chars (was >4096 pre-fix) | well under cap | EB 4096 blocker closed | 

KMS (W-9 TIN) | local stub | live, key 21e98dbe… | live (forced), key ee357d04… | Per-env keys, least-privilege IAM | 

Compliance S3 | — | SSE+versioning+private | + Object Lock + deny-deletes | Prod strictly stronger | 

Beta gate | — | off (full-app mirror) | on (waitlist wall) | Intentional | 

Fleet-carrier persona | — | enabled (validation) | muted (default) | Intentional | 

W-9 render determinism | contentHash f9e4c415… identical on local, staging, prod (241,615 bytes) | Deterministic | 

## 4. Findings register

Each finding is tagged verified (reproduced/confirmed in code or live by the auditor) or agent (reported by a read-only audit agent with file:line evidence; spot-checks passed but not independently reproduced).

### HIGH

H1 verified | ACCEPTED negotiation can permanently lack its policy snapshot. negotiationService.ts:539–545: after the terminal ACCEPTED transition, snapshotPolicyOntoLoad() failures that are not AppError are logged and swallowed; assignment proceeds. No retry, no repair sweeper. | DynamoDB throttle or network blip during accept → binding assignment exists with no pinned policy version; settlement/compliance review later finds no policy evidence for the load. Silent, permanent. | 

H2 verified | Compliance supersede race — two "current" documents. complianceDocumentService.ts flips the prior current version with an unconditional read-then-update (zero ConditionExpressions in the file). Concurrent submits for the same owner+type can both land as isCurrentVersion=true. | Hauler double-clicks submit / retries during a slow response → two current W-9s. getCurrent() papers over it by newest-createdAt sort, so the corruption is invisible until an audit counts currents. | 

H3 verified | Scan-at-scale cluster on request-hot paths. (a) relationshipResolver.gatherFacts() scans the entire loads table on every compliance packet/document open; (b) accessorialChargeService.listForLoad() scans the charges table per load-detail view; (c) negotiationService.negsForLoad() silently falls back to a full scan if its GSI is missing — under 1s long-polling. Repo convention (scan-all + filter) is fine at beta size, lethal at scale. | Loads table at 100k+: every packet open is a full scan; concurrent shipper traffic exhausts RCU → throttling cascades to unrelated endpoints. The GSI fallback turns an infra mistake into a self-DoS that "works" — nobody notices until the bill or the brownout. | 

H4 verified | Public CPU-bound endpoint with no rate limit. GET /api/compliance/w9/render-check (added 2026-07-09 for deploy smoke — by us) renders a full PDF per request, unauthenticated. The only rate limiter in the app guards /api/auth. | A loop of cheap GETs pins the single-instance backend on pdf-lib renders; health checks slow; EB flaps. Trivial to script, no auth needed. | 

### MEDIUM

M1 verified | Full TIN retained in frontend state after W-9 submit. OwnerOperatorCompliance.tsx: on success the form state (incl. f.tin) is never cleared; the SSN/EIN stays in the input and React state. | Shoulder-surf / screen-share / screenshot after submit exposes the full SSN. Violates the platform's own "masked except gated view" rule on the client side. | 

M2 verified | Policy-sign card has no 409/410 UX. LoadPolicySignCard.tsx:39–54: all errors collapse to toast.error(e.message) — version-conflict (policy updated) and gone (attachment removed) are indistinguishable from network noise. | Shipper edits policy mid-flight → hauler's sign 409s with a cryptic toast; hauler doesn't know a refresh shows v2; load sits unsigned. | 

M3 verified | COIs never auto-expire. coiService.expireDueCois() exists and is tested, but nothing invokes it — no cron, route, or boot hook. | Insurance lapses; the VERIFIED badge persists indefinitely; a shipper books a hauler whose COI expired months ago. Trust-critical for a freight marketplace. | 

M4 verified | No global 401 interceptor; widespread silent catches. lib/api.ts throws on !ok; many callers .catch(() => {}). Session expiry mid-action is swallowed. | Expired session + "Accept bid" → nothing happens, no toast, no redirect; user retries confused; state ambiguity on money-affecting actions. | 

M5 agent | Stale load header after negotiation accept. NegotiationPanel fires onAssigned() but shipper LoadDetail doesn't refetch the load — header rate/status can contradict the panel. | Accepted at $2.50/mi; header still shows posted $3.00/mi until reload — conflicting money info on one screen. | 

M6 agent | Funding advance not reconciled against later charge transitions. Advance pins chargeStatus='APPROVED' at issue; the charge can later become DISPUTED/ADJUSTED with no linkage or alert on the advance. | Charge disputed after funds advanced → reconciliation must catch it manually or funds leak on recourse. | 

M7 agent | Counterparty notifications are fire-and-forget. routes/negotiations.ts notify() swallows all send failures — no retry, no dead-letter. | Push outage during assignment → driver never told; pickup window missed; no operational signal anything failed. | 

M8 agent | Runtime-config gate is sticky on fetch failure. RuntimeConfigContext fails closed (persona off) but marks loaded:true with no retry — a transient failure pins a CARRIER_ADMIN on the "unavailable" page for the whole session. | One dropped request at app boot → legitimate carrier locked out until hard refresh. | 

M9 agent | Charge history amountCentsAfter ambiguous under preserveStatus reuse (accessorialChargeService.ts:193–204) — recompute that reuses the reviewed amount writes a history row implying a fresh computation. | Audit trail reads "recomputed to $150" when $150 was carried over — ambiguity precisely where the ledger must be unambiguous. | 

### LOW / informational

L1 verified | Orphan prod table LoadLead_AdminAudit — zero code references (live table is AdminAuditLog). Review contents → archive/delete; it predates the TF-managed compliance layer. | 

L2 verified | Unknown /api/* paths return Express's default HTML 404 (framework fingerprint; inconsistent error shape). Add a JSON catch-all after the routers. | 

L3 verified | Known flaky test: fieldCrypto GCM tamper flips the last base64 char, which can land in padding bits (no byte change). Deterministic-tamper fix task already open. | 

L4 verified | The dev Terraform stack has never been applied (no dev EB, 0 dev tables) yet the parity script validates against it. Either apply it, or mark it explicitly as a template and exclude from parity, so the docs match reality. | 

L5 agent | Tour completion in localStorage isn't user-scoped — shared across users/roles on one browser. Prefix keys with userId; clear on logout. | 

L6 agent | CarrierComplianceView detects the packet-unlock 403 by regex-matching the error message. Return a structured {code:"RELATIONSHIP_REQUIRED"} and match on code. | 

L7 informational | W-9 access log is written before the signed URL is issued — the correct fail-closed direction (an unconsumed log row is noise; an unlogged access would be the real defect). Accepted design; note the false-positive-log caveat for audit tooling. | 

L8 informational | FE dollars→cents uses Math.round(parseFloat(x)*100) — the standard conversion; sub-cent inputs are user error, not float corruption. Add 2-decimal input validation and move on. | 

## 5. What the prior rounds' defects look like now

HIGH: staging env-var gaps → silent writes to prod tables | CLOSED — one-knob DYNAMODB_TABLE_PREFIX (49 tables derive), boot guard fails closed, parity script prefix-aware, EB payload 1,511/4096 chars. | 

Missing prod tables for shipped features | CLOSED — 0 missing (56/56); compliance tables TF-provisioned with PITR + deletion protection. | 

Prod TF drift (worm-sink Lambda hash) | CLOSED — .DS_Store packaging artifact; excludes added (PR #53); prod plan fully clean. | 

Deploy smoke too shallow (route-mount only) | IMPROVED — W-9 render self-check now gates both deploys; found+fixed a real template-packaging bug that had reached prod. | 

vendor-chunk split blank page (prod FE incident) | HOLDING — single vendor chunk verified in build and live. | 

## 6. Courses of action

### COA-1 — Close the cheap, sharp edges (this week; 4 small PRs, no migration risk)

Rate-limit /w9/render-check | Reuse the existing express-rate-limit config (e.g. 10 req/min/IP) on the route; smoke unaffected. | H4 | 

Clear W-9 form state on success | Reset f (esp. tin) after the success toast; show a "submitted" summary card instead of the filled form. | M1 | 

Schedule COI expiry | Invoke expireDueCois() on a daily interval at boot (setInterval guarded to one leader) or EventBridge → an admin-token route. Emit count metric. | M3 | 

JSON 404 catch-all for /api/* + 409/410 handling on policy sign | Terminal app.use('/api', …404 json); FE: branch on status for "policy updated — refresh to sign v2" / "no longer available". | L2, M2 | 

### COA-2 — Correctness under concurrency (next sprint)

Atomic supersede | Conditional flip (ConditionExpression: isCurrentVersion = true) + retry-on-condition-fail loop, or move "current" to a single pointer item per (owner,type) written with attribute_not_exists/version check. | H2 | 

Policy-snapshot repair | (a) bounded retry inside finishAccepted; (b) extend the existing negotiation sweeper to heal ACCEPTED loads missing a policy attachment; (c) metric+alert on snapshot failure. | H1 | 

Global 401 interceptor + structured error codes | One redirect-to-login on 401 in lib/api.ts; backend errors gain {code}; FE matches codes not messages. | M4, L6 | 

Advance↔charge linkage | On charge transition to DISPUTED/ADJUSTED, flag any advance referencing it (append an outcome row + notify ops). | M6 | 

Refetch-after-accept + config retry | onAssigned → refetch load; RuntimeConfig retries with backoff before pinning loaded. | M5, M8 | 

### COA-3 — Scale readiness program (before beta scale-up; the big one)

GSI program for hot scans | Loads by shipperId / by assignedOperatorId (kills the relationship-resolver scan); charges by loadId; compliance docs by ownerId+type. Staging-first, backfill-free (new GSIs on existing keys). | H3a, H3b | 

Make the negotiation GSI mandatory | Boot check: fail startup if the loadId GSI is missing (matches the boot-guard philosophy); alert (don't silently scan) on fallback. | H3c | 

Notification outbox | Replace fire-and-forget with an outbox row + retry sweep; ops metric on failures. | M7 | 

Load test + alarms | k6/artillery against staging at 10× expected beta volume; CloudWatch alarms on DDB throttles + p95 latency before onboarding pushes. | H3, ops | 

### COA-4 — Hygiene backlog (opportunistic)

Review + archive LoadLead_AdminAudit (L1) · decide the dev stack's fate (L4: apply or demote to documented template) · land the flaky-test fix (L3) · user-scope tour localStorage (L5) · history-row disambiguation for preserved amounts (M9) · 2-decimal money input validation (L8).

## 7. Recommendations (standing practice)

- Promote the staging W-9 E2E to a scheduled synthetic. The authed submit→mask→access-log flow found a prod-reaching bug the same day it first ran. Run it nightly against staging with a synthetic TIN; alert on failure. Never point it at prod (append-only store, real KMS).

- Keep the "smoke must exercise the real path" bar. The render self-check pattern (public, canned, non-PII, asserts a hash) generalizes: candidates are policy-render and BOL-render if/when they gain server-side rendering.

- Treat scan-fallbacks as incidents, not conveniences. Any query that can silently degrade to a full scan should fail loudly (boot check or alarm). H3c is the template.

- Institutionalize the parity trio run this round — parity script + untargeted plans (staging/prod) + live mode-diff — as a monthly check or CI cron; all three are fast and already scripted.

- Adopt structured error codes now (small backend change) — three findings this round (M2, M4, L6) trace to FE parsing free-text messages.

## 8. Method & evidence

Backend: full vitest (90 files). Frontend: tsc, Vite production build, chunk audit, Playwright (46 specs, chromium). Infra: check-table-env-parity.mjs; untargeted tofu plan in staging/prod/dev; AWS live inventory (DynamoDB list-tables diff vs code-required names — 56 required / 60 present / 0 missing / 1 orphan; EB config-settings diff; KMS alias inventory; S3 head-bucket). Live smoke: health, auth guards, beta gate, render-check hash comparison, SPA fallback + cache headers, /_test absence. Business logic: two independent read-only audit passes (backend services; frontend guards/API), with every HIGH and headline MEDIUM independently re-verified against source (negotiationService.ts:539, zero ConditionExpressions in complianceDocumentService.ts, expireDueCois call-graph, rate-limiter coverage, FE form-state retention, policy-sign catch block). Findings not independently re-verified are tagged agent.

Throwaway staging test data from the 2026-07-09 E2E (account oo-w9-e2e@loadlead.test, one synthetic-TIN W-9 row, one access-log row) remains in staging by design; flag for cleanup if staging data hygiene matters.
