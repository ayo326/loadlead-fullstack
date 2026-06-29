---
connie-title: 'LoadLead SOC 2: Data Inventory'
connie-publish: true
audience: 'security, compliance, audit readiness'
last-reconciled-against: 2054ab2
connie-page-id: '4849688'
---

# 01 Data Inventory

Run date: 2026-06-28. Reconciled against commit `2054ab2`. Read-only review.
Solo build, so authorship is first person singular.

Every row cites code evidence. Where I cannot confirm storage or retention from
code, the row is marked UNVERIFIED with the exact file or answer that would
confirm it.

## Sensitive data classes

| # | Data class | Sensitivity | Created where | Stored where | Read where | Subprocessor |
|---|---|---|---|---|---|---|
| 1 | Password hash | High | Signup / password change | `LoadLead_Users` (DynamoDB). bcrypt hash only, `backend/src/utils/helpers.ts:14` | Login compare, `helpers.ts:19` | None (self) |
| 2 | Session JWT | High | Login, `backend/src/routes/auth.ts:32` | Browser cookie `ll_token`, httpOnly + Secure(prod) + SameSite=Strict, `auth.ts:33-36`. Not stored server-side. | `middleware/auth.ts:authenticate` | None |
| 3 | Identity / KYC documents (license, passport) | Critical | Didit hosted session, `backend/src/services/integrations/didit.ts:23` | Held by Didit. I store only `idvStatus` + a Didit `session_id`, not raw documents. `didit.ts:55` returns `session_id`; no document bytes persisted (sweep found none) | Verification gates | Didit (`verification.didit.me`) |
| 4 | IDV state | High | Webhook from Didit | `User.idvStatus` five-state enum `'UNVERIFIED' \| 'PENDING' \| 'VERIFIED' \| 'REJECTED' \| 'EXPIRED'`, `backend/src/types/index.ts:124` | `services/carrierOfRecord.ts`, verification middleware | Didit (source) |
| 5 | AML screening result | High | `checkAml()`, `didit.ts:62` | Returns `'pending' \| 'pass' \| 'fail'`; persistence UNVERIFIED (need the caller of `checkAml`) | Verification flow | Didit |
| 6 | Carrier authority (MC / DOT) | Medium | Signup / profile | MC and DOT numbers on carrier/driver profile rows (DynamoDB). FMCSA check returns a boolean, not stored as a record, `backend/src/services/integrations/fmcsa.ts:17,49` | Authority gate | FMCSA QCMobile |
| 7 | Contact PII (name, email, phone, address) | Medium | Signup, profile, invites | `LoadLead_Users` / `LoadLead_Drivers` / `LoadLead_Shippers` / `LoadLead_Receivers` (DynamoDB) | Dashboards, matching, email | Resend (email egress), Google Maps (address geocode) |
| 8 | E-signature (legal attestation) | Critical | Signature capture | `LoadLead_Signatures` (DynamoDB), append-only and enforced by lint, `backend/src/services/attestation/.eslintrc.cjs:22-31`; table name `backend/src/config/environment.ts:40` | Read-only attestation chain panel | None |
| 9 | Proof-of-delivery photos | High | Upload, `backend/src/services/attestation/podPhotoService.ts:54` | Bytes in S3 bucket `loadlead-pod-uploads`, `podPhotoService.ts:58`; metadata (`photoId`, `s3Key`) in DynamoDB, `podPhotoService.ts:47,66` | Load detail | AWS S3 |
| 10 | Factoring funds-flow data | Critical | Factoring opt-in | Factor name, NOA document key, remittance reference, `backend/src/services/factoringProfile.ts:81`. No raw bank account, routing, or card numbers stored (sweep of `routingNumber\|accountNumber\|bankAccount\|ssn\|cardNumber\|cvv\|iban` returned nothing) | `resolveInvoicePayee`, `factoring.ts:171` | The carrier's own factor (off-platform) |
| 11 | Beta applicant data | Medium | Tally form -> webhook, `backend/src/routes/tallyWebhook.ts` | Beta application + waitlist tables (DynamoDB) | Beta Program admin dashboard | Tally (form host) |
| 12 | Support email content | Medium | Inbound support | Support tables (DynamoDB) | Admin support inbox | Resend |

## Highest-sensitivity findings (scrutinized hardest, as instructed)

Funds flow. The most important fact is what is NOT stored. A repo-wide sweep
for `routingNumber`, `accountNumber`, `bankAccount`, `ssn`, `cardNumber`,
`cvv`, `iban` returned no application-code matches. The factoring model is
bring-your-own-factor: I store the factor's name, a Notice-of-Assignment
document key, and a remittance reference (`factoringProfile.ts:81`), and the
payee decision resolves to exactly one of `FACTOR` or `CARRIER`
(`factoring.ts:171`). The actual bank transfer happens at the carrier's factor,
off platform. This is a large audit-scope and breach-blast-radius win that is
already in place. See `07-foundational-layer-plan.md`.

Carrier identity. Raw government-ID documents are held by Didit, not by me.
I persist only the five-state `idvStatus` and a session reference
(`didit.ts:23`, `types/index.ts:124`). This is the foundational-layer ideal:
the most toxic data class is vaulted behind a third party and the application
handles a status token, not raw documents.

## UNVERIFIED items needing confirmation
- Row 5: whether the AML result is persisted, and where. Confirm by showing the
  caller of `checkAml()` and any `putItem` that writes the result.
- DynamoDB on-demand backup schedule beyond PITR. Confirm from AWS console or a
  Terraform backup resource.
- Data retention and deletion: no code path found that purges PII or IDV state.
  Confirm whether any TTL or deletion job exists, or whether retention is
  indefinite (treated as a GAP in `04-gap-analysis.md`).
