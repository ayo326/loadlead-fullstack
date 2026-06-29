---
connie-title: 'LoadLead SOC 2: Executive Summary'
connie-publish: true
audience: 'security, compliance, audit readiness'
last-reconciled-against: 2054ab2
connie-page-id: '4980737'
---

# 00 Executive Summary

Run date: 2026-06-28. Reconciled against commit `2054ab2`. Read-only review.
LoadLead is a solo build, so this is written in the first person singular.

## Readiness verdict: APPROACHING

I am not audit-ready for a Type 1 today, but I am close. The technical core is
strong and, unusually for this stage, the two most toxic data classes are
already vaulted off platform: identity documents live at Didit and bank rails
live at the carrier's factor, so I never store raw identity documents or bank
account numbers. The gap to readiness is governance documents and two code
fixes, not a structural rebuild. With Wave 1 and Wave 3 of the roadmap done,
this moves to ready-for-Type-1.

What is genuinely solid, with evidence:
- No raw bank, routing, card, or SSN data anywhere (`compliance/01-data-inventory.md`,
  repo sweep empty).
- Identity documents held by Didit, not me (`backend/src/services/integrations/didit.ts:23`).
- Append-only, lint-enforced signature chain (`backend/src/services/attestation/.eslintrc.cjs:22`).
- Deterministic single-payee funds-flow invariant (`backend/src/services/factoring.ts:171`).
- Two-level IAM with exact-match tier checks (`backend/src/middleware/auth.ts:84`).
- httpOnly + Secure + SameSite=Strict session cookie (`backend/src/routes/auth.ts:33-36`).
- PITR on prod tables, CI with security scanning, ~355 backend tests.

## Top five risks

1. FMCSA authority check fails open. `fmcsa.ts:35-36` returns true if
   `FMCSA_WEBKEY` is unset in live mode. A carrier with no operating authority
   can pass the gate. Processing Integrity. One-line fix to fail closed.
2. No MFA on CARRIER_ADMIN or OWNER_OPERATOR. `auth.ts:128` enforces 2FA for
   ADMIN only. These accounts control the funds-flow decision and hold PII.
   Account takeover here is the highest-value attack after platform admin.
3. No data retention or disposal policy or mechanism. PII and IDV state appear
   to persist indefinitely. Privacy. Blocks the Privacy criterion and most data
   laws.
4. Proof-of-delivery photos are not yet true WORM. Delete-resistant only;
   S3 Object Lock is pending (`docs/ATTESTATION_PHASE_1.md`). The signature
   chain is immutable; the photo bytes are the weaker half of the legal record.
5. No incident-response or disaster-recovery runbook, and PII reaches logs with
   no redaction layer (`utils/logger.ts`). Governance and Confidentiality.

Full ranking in `04-gap-analysis.md`. Sequenced fixes in `05-remediation-roadmap.md`.

## Open decisions (recorded, not guessed)

1. Type 1 versus Type 2. Not decided. My recommendation is Type 1 first, because
   most technical controls already exist and a point-in-time report is
   achievable after the policy authoring in Wave 3; then run a Type 2 window.
2. Which criteria beyond mandatory Security. I infer Confidentiality and
   Processing Integrity are likely demanded, because the product moves money
   (funds-flow) and produces legal attestations (signatures), and Privacy
   applies if I keep carrier PII. This needs confirmation from what my factoring
   partners and shipper customers contractually require. UNVERIFIED until I have
   those contracts in front of me.
3. Cloud host and GRC tooling. Host is AWS, verified: Elastic Beanstalk for the
   API, DynamoDB, S3, CloudFront. GRC tooling is UNVERIFIED; I found no Vanta,
   Drata, or Secureframe configuration in the repo. Confirm whether a GRC
   platform is in use or whether evidence collection is manual.

## One-line bottom line
The data architecture is ahead of the paperwork. Close the FMCSA fail-open,
extend MFA to carrier accounts, write the retention, IR, and DR policies, and a
Type 1 is in reach.
