---
connie-title: 'LoadLead SOC 2 Readiness Review'
connie-publish: true
audience: 'security, compliance, audit readiness'
last-reconciled-against: 2054ab2
connie-page-id: '4522037'
---

# LoadLead SOC 2 Readiness and Foundational Data Layer Review

Run date: 2026-06-28. Reconciled against commit `2054ab2`.
Read-only review. No application code was changed; the only files created are
the markdown deliverables in this directory. LoadLead is a solo build, written
in the first person singular.

This review applies three lenses together: the SOC 2 Trust Services Criteria
(Security, Availability, Confidentiality, Processing Integrity, Privacy), a
foundational-data-layer shift-left lens (isolate sensitive data behind one
governed boundary so code handles tokens, not raw values), and the A-LIGN
readiness phases (Scope and Risk, Security Controls and Operations, Operational
Governance and Incident Response, Readiness and Evidence).

## Documents

| File | What it contains |
|---|---|
| [00-executive-summary.md](00-executive-summary.md) | Top five risks, readiness verdict (APPROACHING), open decisions |
| [01-data-inventory.md](01-data-inventory.md) | Every sensitive data class: classification, where created, stored, read, subprocessor |
| [02-data-flow-map.md](02-data-flow-map.md) | Prose plus a Mermaid flowchart of sensitive flows and trust boundaries |
| [03-control-matrix.md](03-control-matrix.md) | Criterion, control, status, evidence, under the four A-LIGN phases |
| [04-gap-analysis.md](04-gap-analysis.md) | Every gap, risk-ranked, with why it matters |
| [05-remediation-roadmap.md](05-remediation-roadmap.md) | Sequenced plan, effort S/M/L, criteria unblocked |
| [06-evidence-checklist.md](06-evidence-checklist.md) | Auditor artifacts, auto-collectible versus needs authoring |
| [07-foundational-layer-plan.md](07-foundational-layer-plan.md) | What to tokenize, vault, or isolate, and the scope reduction each buys |

## Status legend

| Status | Meaning |
|---|---|
| IN PLACE | Control implemented, evidence cited |
| PARTIAL | Some coverage, gaps noted |
| GAP | Not implemented |
| UNVERIFIED | Cannot determine from code, confirmation needed |
| N/A-SOLO | Not applicable while solo, activates with a team |
| OUT-OF-LAYER | Real obligation, but not something a data layer solves |

## Method

The review ran in phases: recon and stack detection, data inventory, data-flow
mapping, control mapping against each criterion, foundational-layer assessment,
gap and risk ranking, and a remediation roadmap. Every status cites a file and
line, a config key, or a dependency entry, or is marked UNVERIFIED with the
exact evidence that would confirm it. No vendor, library, table, or control was
assumed to exist without code evidence.

## Headline

The data architecture is ahead of the paperwork. Identity documents are vaulted
at Didit and bank rails sit at the carrier's factor, so the two most toxic data
classes are already off platform. The path to a Type 1 is two small code fixes
(fail-close the FMCSA check, extend MFA to carrier accounts) and a set of
governance documents (retention and disposal, incident response, disaster
recovery). See [00-executive-summary.md](00-executive-summary.md).

## Note on scope of this directory

This `compliance/` directory also contains the STIG and OpenSCAP automation
(`llmap.yaml`, `normalize.ts`, `merge.ts`, and related). Those are a separate,
pre-existing host-and-cloud hardening pipeline. This SOC 2 review did not modify
them; it adds the `0x-*.md` and this README alongside.
