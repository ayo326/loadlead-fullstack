---
connie-title: 'LoadLead SOC 2: Evidence Checklist'
connie-publish: true
audience: 'security, compliance, audit readiness'
last-reconciled-against: 2054ab2
connie-page-id: '5013505'
---

# 06 Evidence Checklist

Run date: 2026-06-28. Commit `2054ab2`. Read-only.

Artifacts an auditor will request, grouped by the four A-LIGN phases. Each is
flagged auto-collectible from the repo, or needs to be authored. Auto-collectible
means it already exists as code, config, or CI output and can be exported.

## Phase 1 Scope and Risk Assessment
- System description and boundary. Authored. Start from `docs/SystemOverview.md`
  and `02-data-flow-map.md`.
- Data inventory and classification. Auto-collectible. `01-data-inventory.md`.
- Subprocessor list. Auto-collectible from code. `02-data-flow-map.md` egress
  table. DPAs themselves must be authored or obtained.
- Risk assessment. Authored. `04-gap-analysis.md` is the first version.

## Phase 2 Security Controls and System Operations
- Password and session config. Auto-collectible. `backend/src/utils/helpers.ts:14`,
  `backend/src/routes/auth.ts:33-36`.
- RBAC and IAM model. Auto-collectible. `backend/src/middleware/auth.ts:48,84`,
  `backend/src/types/platformRole.ts`.
- MFA configuration. Auto-collectible, shows ADMIN-only today. `auth.ts:128`.
- Encryption in transit. Needs export from AWS. CloudFront and EB TLS policy
  screenshots; HTTPS redirect `index.ts:79`.
- Encryption at rest. Needs export from AWS. DynamoDB SSE state and PITR state,
  S3 bucket encryption; Terraform `infra/terraform/modules/dynamodb_table/main.tf:33`.
- Secrets management. Auto-collectible for the negative result (no hardcoded
  secrets, sweep empty) and `backend/.env.example`. EB env var configuration
  needs an AWS export.
- Webhook integrity. Auto-collectible. `backend/src/routes/tallyWebhook.ts`.
- Funds-flow and verification invariants. Auto-collectible. `factoring.ts:171`,
  `types/index.ts:124`, plus the passing payee and carrier-of-record tests.
- Immutable signature chain. Auto-collectible. `attestation/.eslintrc.cjs:22`.

## Phase 3 Operational Governance and Incident Response
- CI and change-management evidence. Auto-collectible. `.github/workflows/`,
  branch-protection settings (note `enforce_admins=false`).
- Security-scan output. Auto-collectible from CI. `compliance.yml` run logs.
- Backup and recovery evidence. Partly auto-collectible. PITR state from AWS;
  the DR runbook with RTO/RPO must be authored.
- Incident response plan. Authored. Does not exist yet.
- Vendor management records. Authored or obtained. DPAs per subprocessor.
- Access-review and offboarding records. N/A-SOLO. Activates with a team.

## Phase 4 Readiness and Evidence Collection
- Policy set: access control, change management, encryption, incident response,
  data retention and disposal, vendor management. Authored. None in repo yet.
- Control-to-evidence matrix. Auto-collectible. `03-control-matrix.md` and
  `docs/security/stig-checklist.md` (rows currently Not Reviewed, sign them off).
- Privacy notice and consent. Obtained or authored. `docs/security/legal-agreements.md`
  exists; confirm the published version.
- Test evidence for processing integrity. Auto-collectible. vitest run output.

## Quick wins for an evidence binder this week
Auto-collectible now: data inventory, data-flow map, control matrix, CI config,
no-hardcoded-secrets sweep, PITR config, funds-flow and immutability code.
Author next: the policy set, the IR and DR runbooks, the retention policy. These
are the items blocking a readiness verdict above approaching.
