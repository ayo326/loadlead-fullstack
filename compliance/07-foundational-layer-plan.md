---
connie-title: 'LoadLead SOC 2: Foundational Layer Plan'
connie-publish: true
audience: 'security, compliance, audit readiness'
last-reconciled-against: 2054ab2
connie-page-id: '5013524'
---

# 07 Foundational Layer Plan

Run date: 2026-06-28. Commit `2054ab2`. Read-only.

The foundational-data-layer lens asks, for each sensitive class: is it coupled to
application logic or isolated behind one governed boundary, and could isolating
or tokenizing it shrink audit scope and breach blast radius.

LoadLead already does the hardest part of this well. Two of the three most toxic
classes are vaulted off platform by design. This plan documents the existing
boundaries, then sequences the remaining isolation moves by scope reduction
bought per unit of effort.

## Classes already isolated (keep and document)

- Identity and KYC documents. Vaulted at Didit. I hold only the five-state
  `idvStatus` and a session reference, not document bytes (`didit.ts:23`,
  `types/index.ts:124`). Scope benefit: the highest-risk class is entirely
  outside my audit boundary. This is the model the other classes should imitate.
- Bank and payment rails. Off platform at the carrier's factor. I store a factor
  name, a NOA key, and a remittance reference, never an account or routing number
  (`factoringProfile.ts:81`; sweep for raw fields empty). Scope benefit: I am not
  in scope for cardholder or bank-account data at all. Preserve this boundary;
  do not let a future feature pull raw bank details on platform.
- Signature integrity. Isolated behind an append-only table with lint-enforced
  immutability (`attestation/.eslintrc.cjs:22`). Scope benefit: the legal
  attestation cannot be silently altered.

## Classes still coupled to application logic (isolation candidates)

Ranked by blast-radius reduction per effort.

1. Contact PII at rest (email, phone, name, address) in the persona tables.
   Today these attributes sit in plaintext DynamoDB attributes read across
   dashboards, matching, and email. Move: field-level encryption with a
   customer-managed KMS key for the contact attributes, so a table export does
   not yield readable PII. Effort M. Scope benefit: shrinks confidentiality
   blast radius of any data-store compromise. This pairs with G8 in the gap
   analysis.

2. PII in logs. Logs are an uncontrolled second copy of PII today
   (`utils/logger.ts`, emails in `orgService.ts:653`). Move: a single redaction
   chokepoint so logs carry tokens and masked values, never raw PII. Effort S.
   Scope benefit: removes logs from the PII boundary entirely, which is one of
   the cheapest scope reductions available.

3. POD photo bytes. Delete-resistant but mutable by a privileged credential
   until Object Lock is on. Move: a dedicated Object Lock COMPLIANCE bucket so
   the bytes join the signature chain in true immutability. Effort M to L.
   Scope benefit: completes the integrity boundary around delivery evidence.

4. AML result. UNVERIFIED whether and where it persists. If it is stored, treat
   it like `idvStatus` and keep only a status token, never raw screening detail.
   Confirm first, then isolate. Effort S once confirmed.

## The single governed boundary, stated plainly

If I name the sensitive boundary explicitly, it is three vaults plus one
in-house immutable store:
- Didit holds identity and AML.
- The carrier's factor holds bank rails.
- S3 with Object Lock should hold delivery photo bytes (in progress).
- The append-only Signatures table holds the legal chain (done).

Everything else the application touches should trend toward tokens and masked
values. The two moves that most reduce my remaining audit scope are field-level
encryption of contact PII (item 1) and the log-redaction chokepoint (item 2).
Neither requires a new vendor; both reuse AWS KMS and the existing logger.
