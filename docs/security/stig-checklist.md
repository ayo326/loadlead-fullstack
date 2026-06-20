---
connie-title: Security — STIG / SCAP-Equivalent Compliance Checklist
connie-publish: true
---

# LoadLead — STIG / SCAP-Equivalent Compliance Checklist

_Modeled on the DISA Application Security & Development (ASD) STIG (APSC-DV-* families, CAT I/II/III, NIST 800-53-derived). LoadLead is a commercial SaaS, not a DoD system, so this is a STIG-style hardening baseline, not an accreditation. Cross-references SEC-/REL- IDs from `LoadLead_E2E_System_UAT_BDD_Test_Plan.md`._

## 0. What is and isn't SCAP-automatable here

SCAP (run by OpenSCAP or DISA's SCC) evaluates a **host OS / config** against XCCDF+OVAL content. It does **not** evaluate custom application logic. So this checklist has three layers:

| Layer | Tool | Automatable? |
|---|---|---|
| Host — AL2023 on Elastic Beanstalk | OpenSCAP + `ssg-al2023-ds.xml` (CIS AL2023 profile) | Yes — true SCAP scan |
| Cloud — S3/DynamoDB/IAM/CloudFront/EB | Prowler / AWS Config CIS conformance pack | Yes — AWS-native, not OS-SCAP |
| Application — Express/React/Node code | SAST + DAST + this checklist (manual/functional) | Partial — SAST/DAST + manual review |

CAT severities: **CAT I** = direct, high-impact exploit (missing authN, IDOR, secrets in code). **CAT II** = medium (missing headers, weak logging). **CAT III** = low/hardening.

Status values: `Not Reviewed` · `Open` · `NotAFinding` · `Not Applicable` (mirrors STIG Viewer .ckl).

---

## 1. Host layer — OpenSCAP on AL2023 (true SCAP scan)

Run on the Elastic Beanstalk EC2 instance(s):

```bash
sudo yum install -y openscap openscap-scanner openscap-utils scap-security-guide
# inspect available profiles
oscap info /usr/share/xml/scap/ssg/content/ssg-al2023-ds.xml
# evaluate against the CIS AL2023 Level 1 Server profile
sudo oscap xccdf eval \
  --profile xccdf_org.ssgproject.content_profile_cis_server_l1 \
  --results-arf al2023-arf.xml \
  --report al2023-report.html \
  /usr/share/xml/scap/ssg/content/ssg-al2023-ds.xml
```

**EB caveat (important):** Elastic Beanstalk re-provisions instances, so hand-hardening is ephemeral. Make host hardening persistent via `.platform/hooks/` (or `.ebextensions`) scripts that apply the OpenSCAP remediation, **or** deploy on a pre-hardened image (CIS publishes a STIG-hardened Amazon Linux AMI). Run the scan in CI against the AMI/build, not only post-deploy.

DISA's own tool, **SCC (SCAP Compliance Checker)**, consumes the same XCCDF/OVAL datastream if you prefer the DISA-native scanner over OpenSCAP.

---

## 2. Cloud layer — CIS AWS (automatable, not OS-SCAP)

```bash
# Prowler: CIS AWS Foundations + service checks across the account
prowler aws --compliance cis_3.0_aws
```
Also enable an **AWS Config CIS conformance pack** for continuous drift detection. Priorities for LoadLead: S3 `loadlead-pod-uploads` (block public access, SSE, versioning); DynamoDB (encryption at rest, PITR backups); IAM (least privilege on the EB/app role, no wildcard `*`); CloudFront (TLS, OAC to S3); EB env (no plaintext secrets in option settings — use SSM/Secrets Manager).

---

## 3. Application layer — ASD-STIG-style checklist

Each row: **ID · ASD family · CAT · Requirement · Check (LoadLead-specific) · Fix · Test link · Status**.

### 3.1 Identification & Authentication

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-IA-001 | APSC-DV-001740 | II | Passwords stored only as cryptographic hashes. Check: bcrypt in use, cost ≥ 12, no plaintext/MD5/SHA1 anywhere. Fix: raise bcrypt rounds; migrate legacy hashes on next login. | SEC-7 | Not Reviewed |
| LL-IA-002 | APSC-DV-001650 | I | No hardcoded credentials/secrets in code. Check: scan repo + bundle (gitleaks/trufflehog) for keys (DIDIT_*, RESEND_*, FMCSA_*, JWT_SECRET). Fix: move to env/SSM; rotate any exposed. | SEC-7 | Not Reviewed |
| LL-IA-003 | APSC-DV-000110 | II | Account lockout / throttling on repeated auth failure. Check: `/api/auth/*` rate-limit (15/15min) present; confirm it blocks credential stuffing per-account, not just per-IP. Fix: add per-account lockout/backoff. | SEC-3 | Not Reviewed |
| LL-IA-004 | APSC-DV-001980 | II | MFA for privileged accounts (ADMIN, CARRIER_ADMIN, OO). Check: is MFA available/enforced? Fix: add TOTP/WebAuthn for privileged roles. | — | Not Reviewed |
| LL-IA-005 | APSC-DV-000160 | II | Temporary/setup credentials are single-use and expire. Check: SetupToken / password-reset tokens single-use + TTL. Fix: enforce expiry + burn-on-use. | — | Not Reviewed |

### 3.2 Session Management

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-SM-001 | APSC-DV-002250 | II | Session tokens are httpOnly, Secure, SameSite. Check: JWT cookie flags set in all envs. Fix: set all three; SameSite=Strict/Lax. | SEC-2 | Not Reviewed |
| LL-SM-002 | APSC-DV-002270 | II | Session expiration + inactivity timeout. Check: JWT exp short; refresh rotation; idle timeout. Fix: add rotation + absolute lifetime. | SEC-2 | Not Reviewed |
| LL-SM-003 | APSC-DV-002000 | II | Connections/sessions terminated at logout. Check: logout clears cookie and invalidates refresh. Fix: refresh-token denylist or rotation-on-logout. | SEC-2 | Not Reviewed |

### 3.3 Access Control / Authorization

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-AC-001 | APSC-DV-000460 | I | Enforce RBAC / least privilege on every protected route. Check: `requireRole` present on all non-public routes. Fix: add missing guards. | SEC-1 / G-matrix | Not Reviewed |
| LL-AC-002 | APSC-DV-000470 | I | Object-level authZ (no IDOR). Check: every `:id` route verifies ownership (DynamoDB has no RLS). Fix: add handler-level ownership checks. | SEC-1 / G2,G5 | Not Reviewed |
| LL-AC-003 | APSC-DV-000470 | I | Domain invariants enforced server-side: SHIPPER≠CARRIER, one-parent, carrier-of-record gates, CARRIER_ADMIN cannot haul. Check: API rejects violations even when UI is bypassed. Fix: centralize in service layer. | SEC-9 / unit C,D,E | Not Reviewed |
| LL-AC-004 | APSC-DV-000500 | I | Non-privileged users cannot reach admin functions. Check: `/api/admin/*` denies non-ADMIN. Fix: guard. | G7 | Not Reviewed |

### 3.4 Input Validation & Injection

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-IV-001 | APSC-DV-002510 | I | Protected from command injection. Check: no shell exec on user input. Fix: avoid `exec`; allowlist. | SEC-5 | Not Reviewed |
| LL-IV-002 | APSC-DV-002540 | I | Protected from SQL/NoSQL injection. Check: DynamoDB expressions use ExpressionAttributeValues, never string concatenation of user input into FilterExpression. Fix: parameterize. | SEC-5 | Not Reviewed |
| LL-IV-003 | APSC-DV-002530 | II | All input validated. Check: Zod schema on every body/param/query; reject unknown keys, enforce size. Fix: add schemas where missing. | SEC-5 | Not Reviewed |
| LL-IV-004 | APSC-DV-002520 | II | Protected from XSS / canonicalization. Check: no `dangerouslySetInnerHTML` on untrusted data; React auto-escaping intact; output encoding. Fix: sanitize/encode. | SEC-5 | Not Reviewed |
| LL-IV-005 | APSC-DV-002560 | II | File uploads validated. Check: POD photos — MIME/extension/size limits, magic-byte check, no executables; S3 stored private. Fix: validate server-side, cap size, scan. | VE2E-3 | Not Reviewed |
| LL-IV-006 | APSC-DV-002500 | II | Protected from SSRF. Check: outbound calls (Didit/FMCSA/Maps/Resend) use fixed endpoints; no user-controlled URL fetch. Fix: allowlist hosts. | SEC-5 | Not Reviewed |

### 3.5 Cryptography & Data Protection

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-CR-001 | APSC-DV-001620 | I | TLS for all data in transit. Check: HTTPS redirect on, HSTS, TLS 1.2+, CloudFront/ELB modern policy. Fix: enforce HSTS + redirect. | SEC-8 | Not Reviewed |
| LL-CR-002 | APSC-DV-002480 | II | Encryption at rest for sensitive data. Check: DynamoDB encryption enabled; S3 SSE on POD bucket. Fix: enable SSE-KMS. | §2 | Not Reviewed |
| LL-CR-003 | APSC-DV-001990 | II | PII/KYC data minimized + protected. Check: identity docs/AML held by Didit, not duplicated; CDL/idv fields access-controlled; retention defined. Fix: minimize stored PII; document retention/disposal. | — | Not Reviewed |
| LL-CR-004 | APSC-DV-001995 | II | Integrity of inbound webhooks (and no race conditions). Check: Didit webhook HMAC verified; double-accept guarded by conditional write. Fix: reject bad-HMAC; keep ConditionExpression. | SEC-4 / H1 | Not Reviewed |

### 3.6 Error Handling, Logging & Auditing

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-AU-001 | APSC-DV-001310 | II | No sensitive data / stack traces in error responses. Check: client errors are sanitized. Fix: generic error shape; log details server-side. | SEC-7 / 4.7 | Not Reviewed |
| LL-AU-002 | APSC-DV-000080 | II | Audit security-relevant events. Check: auth success/fail, verification approve/reject, admin overrides, capability/membership changes logged (MembershipAuditLogs exists — extend to auth + verification). Fix: add audit events. | — | Not Reviewed |
| LL-AU-003 | APSC-DV-000300 | II | Logs contain no secrets/PII. Check: scan logs for tokens, idv payloads, CDL. Fix: redact. | SEC-7 | Not Reviewed |
| LL-AU-004 | APSC-DV-000210 | III | Log timestamps in UTC, time-synced; retention defined. Fix: centralize logs (CloudWatch), set retention. | — | Not Reviewed |

### 3.7 Configuration & Hardening

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-CM-001 | APSC-DV-003110 | II | No test/stub/debug code in production. Check: stub modules + `/_test/*` excluded from prod build; boot guard fails on non-live integration modes. Fix: (already specced) enforce exclusion + guard. | (hardening prompt) | Not Reviewed |
| LL-CM-002 | APSC-DV-002250 | II | Security headers present. Check: Helmet — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy. Fix: enable/tune CSP. | SEC-8 | Not Reviewed |
| LL-CM-003 | APSC-DV-001460 | II | CORS restricted. Check: only `ALLOWED_ORIGINS`; no `*` with credentials. Fix: tighten. | SEC-8 | Not Reviewed |
| LL-CM-004 | APSC-DV-002400 | II | DoS / resource exhaustion controls. Check: rate limiting beyond auth; body-size limits; pagination caps. Fix: add global limits. | PERF-4 | Not Reviewed |
| LL-CM-005 | APSC-DV-001950 | III | No verbose version disclosure. Check: `X-Powered-By` disabled; no stack/framework banners. Fix: `app.disable('x-powered-by')`. | — | Not Reviewed |

### 3.8 Supply Chain & Dependencies

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-SC-001 | APSC-DV-003290 | II | No known-vulnerable components. Check: `npm audit` / SCA in CI; note `.npmrc legacy-peer-deps=true` can mask conflicts — review. Fix: patch/upgrade; gate CI on high/critical. | — | Not Reviewed |
| LL-SC-002 | APSC-DV-003300 | III | SBOM produced + reviewed. Fix: generate CycloneDX in CI. | — | Not Reviewed |
| LL-SC-003 | APSC-DV-003235 | II | Dependency integrity. Check: committed lockfile; CI uses `npm ci`. Fix: enforce. | — | Not Reviewed |

### 3.9 Availability & Resilience

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-AV-001 | APSC-DV-003340 | III | Backups for recovery. Check: DynamoDB PITR on; S3 versioning. Fix: enable. | §2 | Not Reviewed |
| LL-AV-002 | APSC-DV-003290 | II | Graceful failure on dependency outage. Check: Didit/FMCSA/Maps/Resend failures degrade, not crash; webhook idempotent. Fix: per REL-1..7. | REL-1..7 | Not Reviewed |

### 3.10 Third-party Integration

| ID | ASD ref | CAT | Requirement / Check / Fix | Test | Status |
|---|---|---|---|---|---|
| LL-TP-001 | APSC-DV-001460 | II | Non-prod isolated from live external services. Check: staging on Didit sandbox / FMCSA stub / Resend test / Push capture; boot guard fail-closed. Fix: (sandbox prompt) enforce. | (sandbox prompt) | Not Reviewed |
| LL-TP-002 | APSC-DV-001650 | II | API keys least-privilege + rotated. Check: Maps key restricted+capped; Resend send-only; Didit scoped; rotation schedule. Fix: restrict + rotate. | SEC-6 | Not Reviewed |

---

## 4. Execution & automation

| Layer | Run | Output |
|---|---|---|
| Host | OpenSCAP `oscap xccdf eval` (§1) or DISA SCC | ARF + HTML; ingest into POA&M |
| Cloud | Prowler `--compliance cis_3.0_aws`; AWS Config conformance pack | findings by CIS control |
| App SAST | Semgrep or CodeQL (injection, authZ, secrets) | maps to LL-IV-*, LL-IA-*, LL-AC-* |
| App DAST | OWASP ZAP baseline (already in SEC suite) | maps to LL-IV-*, LL-CM-* |
| App functional | the SEC-/REL- tests in the system-test plan | direct evidence per row's "Test" link |
| Secrets | gitleaks/trufflehog on repo + built artifact | LL-IA-002 |
| Deps | `npm audit` + CycloneDX SBOM in CI | LL-SC-* |

To produce a real **STIG Viewer .ckl**: author an XCCDF for the LL-* rules (or map to the ASD STIG benchmark in STIG Viewer and mark each finding), then track status there. Or drive the Status column from CI the same way the test dashboard does — emit `{LL-ID: NotAFinding|Open}` and render it.

---

## 5. POA&M (Plan of Action & Milestones)

Track every `Open` finding: ID, CAT, description, owner, remediation, target date, residual risk. CAT I findings (LL-IA-002, LL-AC-001/002/003/004, LL-IV-001/002, LL-CR-001) are the go-live blockers — close or formally accept-with-justification before production traffic. Re-scan host (OpenSCAP) and cloud (Prowler) on a schedule; re-run the app SEC/REL suite on every release.
