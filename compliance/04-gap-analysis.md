---
connie-title: 'LoadLead SOC 2: Gap Analysis'
connie-publish: true
audience: 'security, compliance, audit readiness'
last-reconciled-against: 2054ab2
connie-page-id: '4554789'
---

# 04 Gap Analysis

Run date: 2026-06-28. Commit `2054ab2`. Read-only.

Ranking is likelihood times impact, with funds-flow and carrier PII weighted
highest, as instructed. Each gap states why it matters for an audit and which
criterion it blocks.

## Ranked gaps

### G1. FMCSA authority check fails open. Severity High.
Evidence: `backend/src/services/integrations/fmcsa.ts:35-36`. In live mode, if
`FMCSA_WEBKEY` is unset the function logs a warning and returns true, so a
carrier with no verifiable operating authority passes the gate.
Why it matters: Processing Integrity. An authority gate that can silently pass
is not a reliable control, and a SOC 2 PI test would fail on it. Likelihood is
low if the key is always set, but the blast radius is a carrier hauling without
authority. Fix is small: fail closed (return false) when the key is missing in
live mode.

### G2. No MFA on CARRIER_ADMIN or OWNER_OPERATOR. Severity High.
Evidence: `backend/src/routes/auth.ts:128` enforces 2FA only for `role ===
'ADMIN'`. CARRIER_ADMIN controls the factoring opt-in that decides where money
is paid and holds carrier PII. Owner Operator is the same blended persona.
Why it matters: Security. Account takeover of a CARRIER_ADMIN can redirect the
funds-flow decision and expose PII. This is the highest-value account class
after platform admin and it has password-only auth.

### G3. No data retention or disposal policy or mechanism. Severity High.
Evidence: no TTL attribute, deletion job, or purge path found for PII or IDV
state. The five-state `idvStatus` and contact PII appear to persist
indefinitely.
Why it matters: Privacy. SOC 2 Privacy and most data laws require defined
retention and disposal. This is a documentation and a code gap. Authoring the
policy is fast; implementing TTL or a deletion flow is medium effort.

### G4. POD photo bucket is delete-resistant but not true WORM. Severity Medium-High.
Evidence: `docs/ATTESTATION_PHASE_1.md` records that Phase 1 ships delete
resistance (versioning + IAM) and that S3 Object Lock COMPLIANCE is Phase 2,
which needs a new bucket.
Why it matters: Processing Integrity and Confidentiality of legal delivery
evidence. Until Object Lock is on, a sufficiently privileged credential could
remove proof-of-delivery bytes. The signature chain is already immutable;
the photo bytes are the weaker half.

### G5. No central log redaction; PII reaches logs. Severity Medium.
Evidence: `backend/src/utils/logger.ts:2-16` is a plain console wrapper with no
redaction. Emails appear in log lines (`backend/src/services/orgService.ts:653`,
`backend/src/routes/adminBeta.ts:194`). Tokens are truncated by hand
(`staffService.ts:110`), which is good discipline but not enforced.
Why it matters: Confidentiality. Logs are a common breach and audit finding.
A redaction helper that all log calls pass through closes this.

### G6. bcrypt cost factor is 10, below the 12 target. Severity Medium.
Evidence: `backend/src/utils/helpers.ts:14`.
Why it matters: Security. Lower offline-cracking margin if a hash dump leaks.
Not exploitable online (rate limited). Fix is one line plus a compare-then-
upgrade on next login.

### G7. No documented incident response or disaster recovery. Severity Medium-High for governance.
Evidence: no IR or DR runbook in the repo. PITR exists for recovery data
(`infra/terraform/modules/dynamodb_table/main.tf:33`) but no RTO/RPO or
declared process.
Why it matters: Operational Governance. SOC 2 expects an IR plan and a tested
recovery story even for a solo operator. Low code effort, real document effort.

### G8. At-rest encryption uses AWS-owned keys, not customer-managed KMS. Severity Medium.
Evidence: no `kms_key_arn` or `sse_specification` with a CMK found for the data
tables or POD bucket. DynamoDB and S3 still encrypt by AWS default.
Why it matters: Confidentiality posture and key-rotation control. AWS default
encryption satisfies the baseline; a CMK gives me rotation and access logging.
Optional for Type 1, stronger for Type 2.

### G9. Branch protection allows admin bypass. Severity Low while solo.
Evidence: `enforce_admins=false` on main; 1 required review.
Why it matters: Change management evidence. As a solo builder I am both author
and approver, so this is a documented exception, not a live risk. Revisit on
first hire.

### G10. Integration secrets not documented in .env.example. Severity Low.
Evidence: `backend/.env.example` lists AWS, DynamoDB, JWT, and tuning keys but
not `DIDIT_API_KEY`, `FMCSA_WEBKEY`, `RESEND_API_KEY`, `TALLY_SIGNING_SECRET`,
which the code reads.
Why it matters: Onboarding and completeness. No security exposure, but an
auditor reading `.env.example` as the secrets manifest would miss four
subprocessor keys. Update the template.

## Strengths to preserve (not gaps, stated for balance)
- Identity documents are vaulted at Didit, not stored by me (`didit.ts:23`).
- No raw bank, routing, card, or SSN data anywhere (repo sweep empty).
- Signature table is append-only and lint-enforced (`attestation/.eslintrc.cjs:22`).
- Two-level IAM with exact-match tier checks (`middleware/auth.ts:84`).
- Deterministic single-payee funds-flow invariant (`factoring.ts:171`).
