---
connie-title: 'LoadLead SOC 2: Control Matrix'
connie-publish: true
audience: 'security, compliance, audit readiness'
last-reconciled-against: 2054ab2
connie-page-id: '4653111'
---

# 03 Control Matrix

Run date: 2026-06-28. Commit `2054ab2`. Read-only.

Status legend: IN PLACE, PARTIAL, GAP, UNVERIFIED, N/A-SOLO, OUT-OF-LAYER.
Organized under the four A-LIGN readiness phases. Criterion codes: SEC Security,
AV Availability, CON Confidentiality, PI Processing Integrity, PRI Privacy.

## Phase 1 Scope and Risk Assessment

| Criterion | Control | Status | Evidence | Note |
|---|---|---|---|---|
| SEC | System boundary and data inventory defined | PARTIAL | `compliance/01-data-inventory.md`, `docs/SecurityPosture.md` | Inventory now exists in this pass; needs my sign-off as system description |
| SEC | Subprocessor list maintained | PARTIAL | `02-data-flow-map.md` egress table | List derived from code; DPAs not tracked in repo |
| PRI | Personal-data classes identified | IN PLACE | `01-data-inventory.md` rows 3,4,6,7,8,11 | |
| SEC | Risk assessment documented | PARTIAL | `04-gap-analysis.md` (this pass) | First formal ranking; needs periodic cadence |

## Phase 2 Security Controls and System Operations

| Criterion | Control | Status | Evidence | Note |
|---|---|---|---|---|
| SEC | Password hashing | PARTIAL | `backend/src/utils/helpers.ts:14` `bcrypt.hash(password, 10)` | Cost 10; STIG LL-IA-001 wants 12 |
| SEC | Session tokens httpOnly, Secure, SameSite | IN PLACE | `backend/src/routes/auth.ts:33-36` | Secure gated to prod; correct |
| SEC | Session expiry | IN PLACE | `auth.ts` JWT `exp` (default 1h), `routes/auth.ts` | No refresh-token rotation (UNVERIFIED) |
| SEC | MFA for privileged accounts | PARTIAL | `backend/src/routes/auth.ts:128` enforces 2FA for `role === 'ADMIN'` only | CARRIER_ADMIN and OWNER_OPERATOR (funds + PII) have no MFA |
| SEC | Brute-force / rate limiting | IN PLACE | `backend/src/index.ts:207` `authRateLimiter` on `/api/auth/*` | Per-IP; per-account lockout UNVERIFIED |
| SEC | RBAC, least privilege, exact-match | IN PLACE | `backend/src/middleware/auth.ts:48` `requireRole`, `:84` `requireStaffTier` (exact-match `allowed.includes(tier)`) | Two-level IAM, no substring match |
| SEC | Admin surface separation | IN PLACE | separate `PlatformRole` enum `backend/src/types/platformRole.ts`; admin on `admin.loadleadapp.com` | |
| SEC | Object-level authZ (no IDOR) | UNVERIFIED | per-`:id` ownership checks not centrally proven | STIG LL-AC-002 Not Reviewed; needs route-by-route check |
| CON | Encryption in transit | IN PLACE | CloudFront + EB TLS; HTTPS redirect `index.ts:79-80` | HSTS header presence UNVERIFIED |
| CON | Encryption at rest, DynamoDB | IN PLACE | AWS default SSE (always on, AWS-owned key) | Customer-managed KMS not configured (GAP for stricter posture) |
| CON | Encryption at rest, S3 | IN PLACE | AWS default bucket encryption (AES256); explicit config seen for state bucket `infra/terraform/_bootstrap/main.tf:42` | POD bucket explicit SSE config UNVERIFIED |
| PI | Funds-flow single-payee invariant | IN PLACE | `backend/src/services/factoring.ts:171-184` returns one of `FACTOR`/`CARRIER` | Deterministic; unit-tested (payee tests) |
| PI | Verification state machine | IN PLACE | `idvStatus` five states `backend/src/types/index.ts:124`; gates in `services/carrierOfRecord.ts` | |
| PI | Carrier authority check | PARTIAL | `backend/src/services/integrations/fmcsa.ts:17,49` | Fails OPEN if `FMCSA_WEBKEY` unset `fmcsa.ts:35-36` |
| PI | Immutable signature chain | IN PLACE | append-only enforced by lint `backend/src/services/attestation/.eslintrc.cjs:22-31`; three-layer model in `docs/SecurityPosture.md` | |
| PI | POD photo WORM | PARTIAL | delete-resistant (versioning + IAM), true S3 Object Lock pending `docs/ATTESTATION_PHASE_1.md` | Phase 2 needs a new bucket |
| SEC | Secrets via env, no hardcoding | IN PLACE | sweep for `sk_live\|AKIA...\|api_key=...` returned nothing; `backend/.env.example` documents core keys | Integration keys (DIDIT/FMCSA/RESEND/TALLY) not listed in `.env.example` (doc gap) |
| SEC | Key management | PARTIAL | `.env.example` lists `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (static keys) | Prefer EB instance role over static keys; SSM/secrets-manager UNVERIFIED |
| CON | Log redaction (no PII/secrets) | PARTIAL | `backend/src/utils/logger.ts:2-16` plain console, no redaction; emails appear in logs (`orgService.ts:653`), tokens manually truncated (`staffService.ts:110` `.slice(0,8)`) | No enforced redaction layer |
| SEC | Webhook integrity (HMAC) | IN PLACE | Tally raw-body HMAC `backend/src/routes/tallyWebhook.ts`; Didit webhook `POST /api/webhooks/didit` | |
| SEC | Input validation / injection | PARTIAL | DynamoDB uses `ExpressionAttributeValues` (no string concat); Zod coverage patchy | STIG LL-IV-003 Not Reviewed |

## Phase 3 Operational Governance and Incident Response

| Criterion | Control | Status | Evidence | Note |
|---|---|---|---|---|
| AV | Backups / point-in-time recovery | IN PLACE | PITR in `infra/terraform/modules/dynamodb_table/main.tf:33`; all prod tables PITR per `docs/PendingRegister.md` | |
| AV | Disaster recovery plan, RTO/RPO | GAP | no DR runbook found | Author a one-page DR/RTO/RPO doc |
| AV | Uptime monitoring / alerting | UNVERIFIED | `/api/health` exists `index.ts:170`; external monitor not found in repo | Confirm CloudWatch alarms / uptime check |
| SEC | Change management, CI gates | IN PLACE | 8 workflows in `.github/workflows/` (compliance, deploy-backend, frontend-lint, pact, pr-jira-ref, publish-docs, verify-provider, sync-test-dashboard) | |
| SEC | Branch protection | PARTIAL | main requires 1 review + checks `scrum-key-present`, `publish / merge + dashboard`; `enforce_admins=false` | Admin can bypass; acceptable solo but a documented exception |
| SEC | Automated security scanning | IN PLACE | `compliance.yml` runs SAST (Semgrep), secrets, dependency scans per `docs/SecurityPosture.md` | Confirm latest run is green |
| SEC | Audit logging of security events | PARTIAL | `[staff-audit]` lines `backend/src/services/staffService.ts:110`; auth success/fail + verification events not centrally audited | STIG LL-AU-002 |
| SEC | Incident response plan | GAP | no IR runbook found | Author IR plan with severity tiers + my contact path |
| SEC | Security awareness training | N/A-SOLO | solo build | Activates on first hire |
| SEC | Access review / offboarding | N/A-SOLO | solo build | Activates with a team; admin staff IAM already supports it (`services/staffService.ts`) |
| SEC | Vendor / subprocessor risk review | PARTIAL | egress list in `02-data-flow-map.md` | Collect DPAs for Didit, FMCSA, Google, Resend, Tally, AWS |

## Phase 4 Readiness and Evidence Collection

| Criterion | Control | Status | Evidence | Note |
|---|---|---|---|---|
| SEC | System description document | PARTIAL | `docs/SystemOverview.md`, `docs/Architecture_*` | Reframe as the SOC 2 system description |
| SEC | Control list mapped to evidence | IN PLACE | this file + `docs/security/stig-checklist.md` | STIG rows are Not Reviewed; see gap |
| SEC | Policies (access, change, IR, retention) | GAP | no policy docs in repo | Author the minimum policy set (see `06-evidence-checklist.md`) |
| PRI | Data retention and disposal policy | GAP | no retention/TTL/deletion path found | Highest Privacy gap; see `04` |
| PRI | Privacy notice / consent | OUT-OF-LAYER | legal copy, not code | `docs/security/legal-agreements.md` exists; confirm published notice |
| PI | Evidence of processing accuracy (tests) | IN PLACE | ~355 backend tests (vitest) incl. payee, carrier-of-record, attestation | |
