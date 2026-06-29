---
connie-title: 'LoadLead SOC 2: Remediation Roadmap'
connie-publish: true
audience: 'security, compliance, audit readiness'
last-reconciled-against: 2054ab2
connie-page-id: '4980757'
---

# 05 Remediation Roadmap

Run date: 2026-06-28. Commit `2054ab2`. Read-only review; this is the plan, not
applied changes.

Effort sizes: S under a day, M a few days, L a week or more. Sequenced so the
highest leverage and lowest effort come first, and so document work that an
auditor needs is not blocked on code.

## Wave 1, quick high-leverage code fixes (mostly S)

1. G1 FMCSA fail-closed. S. Change `fmcsa.ts:35-36` to return false in live mode
   when `FMCSA_WEBKEY` is missing. Unblocks PI authority control. No dependency.
2. G6 bcrypt cost to 12 with compare-then-upgrade. S. Edit `helpers.ts:14` and
   add a re-hash on successful login. Unblocks SEC LL-IA-001.
3. G10 add the four integration keys to `backend/.env.example`. S. Doc only.
4. G5 add a redaction helper that every `Logger` call routes through, masking
   emails and any value that looks like a token or key. S to M.
   Unblocks CON log-handling.

## Wave 2, the account and money surface (M)

5. G2 enforce MFA for CARRIER_ADMIN and OWNER_OPERATOR. M. The TOTP machinery
   already exists for ADMIN (`auth.ts:128` and the 2FA routes); extend the
   enforcement branch to these roles and add enrollment prompts in the carrier
   and owner-operator settings screens. Unblocks SEC for the funds and PII
   surface. Highest risk-reduction per unit effort after Wave 1.

## Wave 3, evidence and governance documents (M, document effort)

6. G3 retention and disposal. Author the policy (retention windows per data
   class from `01-data-inventory.md`, disposal method), then implement a TTL or
   a deletion endpoint for contact PII and stale IDV state. Policy is M;
   implementation is M. Unblocks PRI.
7. G7 incident response and disaster recovery runbooks. Author IR with severity
   tiers and my escalation path, and DR with RTO/RPO grounded in the existing
   PITR. M. Unblocks AV and Operational Governance.
8. Minimum policy set for SOC 2: access control, change management, encryption,
   vendor management. M. Pull most content from the existing `docs/` and this
   compliance set. Unblocks Phase 4 readiness.
9. Subprocessor DPAs. Collect and file the data-processing agreements for Didit,
   FMCSA, Google Maps, Resend, Tally, AWS. M, mostly external. Unblocks vendor
   review.

## Wave 4, hardening for a Type 2 window (M to L)

10. G4 POD photo Object Lock COMPLIANCE. M to L. Create a new versioned bucket
    with Object Lock, migrate writes, backfill. Dependency: a migration window.
    Unblocks PI and CON for delivery evidence.
11. G8 customer-managed KMS for DynamoDB and the POD bucket. M. Adds rotation
    and key-access logging. Optional for Type 1.
12. Uptime monitoring and CloudWatch alarms with documented thresholds, plus
    audit logging of auth success and failure and verification decisions
    (STIG LL-AU-002). M.
13. G9 revisit branch protection (`enforce_admins=true`, second reviewer) on the
    first hire. S, deferred. N/A while solo.

## Sequencing rationale
Wave 1 removes the only control that can silently fail (G1) and the cheapest
confidentiality leak (G5) in under a day total. Wave 2 protects the accounts
that move money. Wave 3 produces the documents an auditor will ask for first.
Wave 4 is the durable hardening that a Type 2 operating window will exercise.
