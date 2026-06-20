---
connie-title: LoadLead Engineering Docs
connie-publish: true
---

# LoadLead Engineering Docs

> **Source of truth: this repository.** Pages on Confluence are a **rendered
> one-way mirror** updated by CI when these files change. Never edit a page in
> Confluence — your change will be overwritten on the next docs push.

This index lists every doc in `/docs`. Each section maps to a child page on
Confluence under the parent **LoadLead Engineering Docs** space root.

## Architecture & Refactor

- [Organizations, Roles & Onboarding Spec](architecture/orgs-roles-onboarding-spec.md)
  — the org/IAM/role contract underpinning every persona-aware route.

## Testing

- [Testing Guide](testing/testing-guide.md) — risk-ordered manual + automated
  test battery, the matrix the refactor test tracker scores against.
- [E2E / System / UAT / BDD Test Plan](testing/e2e-uat-bdd-test-plan.md) — full
  end-to-end coverage roadmap (HE2E, VE2E, SEC, REL, UAT, BDD).

## Security & Compliance

- [STIG / SCAP-Equivalent Compliance Checklist](security/stig-checklist.md) — the
  LL-* IDs, CAT levels, and the CI compliance pipeline they feed.
- [Legal Disclosures & Agreements](security/legal-agreements.md) — draft
  TOS / privacy / contracts template for attorney review.

## Dashboards

- [Carrier & Owner Operator Dashboard Build Spec](dashboards/dashboards-spec.md)
  — persona-independent dashboard contracts; settings parity rules.

## Database & Analytics

- [PostGIS Analytics DB Spec](database-analytics/analytics-db-spec.md) — the
  read-replica architecture (DynamoDB → Streams → Lambda → PostGIS).
- [Operator Provisioning Checklist](database-analytics/analytics-db-provisioning.md)
  — AWS console clicks and provider choices to unlock build-now and gated
  telematics tiers.

## Automation

- [Jira Smart Commits Convention](automation/jira-smart-commits.md) — the SCRUM-key
  commit format, hook installer, and CI gate that keep every commit linked to
  an issue.

---

## How publishing works

1. You edit a `.md` file in `/docs/**` and push to `main`.
2. The `.github/workflows/publish-docs.yml` workflow runs
   `markdown-confluence` against the **CONFLUENCE_SPACE_KEY** space using the
   shared Atlassian token.
3. The tool writes (or reuses) a Confluence page per `.md`, keyed by the
   `connie-page-id` it injects into the file's front-matter on first publish.
   Re-running with no content change produces zero new pages and zero new
   versions.
4. Pull requests show a dry-run preview but do not publish.

Repo file names map 1:1 to Confluence pages; sub-folders nest under the group
landing pages. The hierarchy is:

```
LoadLead Engineering Docs (parent)
├── Architecture & Refactor
│   └── Organizations, Roles & Onboarding Spec
├── Testing
│   ├── LoadLead Testing Guide
│   └── E2E / System / UAT / BDD Test Plan
├── Security & Compliance
│   ├── STIG / SCAP-Equivalent Compliance Checklist
│   └── Legal Disclosures & Agreements
├── Dashboards
│   └── Carrier & Owner Operator Build Spec
├── Database & Analytics
│   ├── PostGIS Analytics DB Spec
│   └── Operator Provisioning Checklist
└── Automation
    └── Jira Smart Commits Convention
```

## Local preview

```bash
cd docs
npx @markdown-confluence/cli --dry-run \
  --config ../.markdown-confluence.json
```

That renders each file to ADF and prints what would be created/updated, without
calling Confluence.
