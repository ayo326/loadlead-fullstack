# Audit v6 - Remediation status

> Companion to `REPORT.md`. The report is the point-in-time audit (2026-07-14) and is
> unchanged. This file tracks what has since been remediated, so a reader on `main` does
> not mistake a fixed finding for a live one. Last updated 2026-07-14.

## Summary

| Severity | Found | Resolved | Remaining |
|---|---|---|---|
| CRITICAL | 3 | **3** | 0 |
| HIGH | 13 | **9** | 4 (H9, H10, H12, H13) |
| MEDIUM (security) | 8 | **8** | 0 |
| MEDIUM (perf / correctness / tests) | ~8 | 0 | ~8 (1 deferred: needs GSI) |
| LOW | ~15 | a few folded in | mostly deferred (hygiene) |

All CRITICAL and HIGH-priority authorization findings are fixed and deployed to
production. Every change shipped staging-first with an admin-merge and a live smoke.

## CRITICAL

| ID | Finding | Fix | PR |
|---|---|---|---|
| C1 / BL-C1 | DB scan/query never paginate (silent truncation of intercepts / factoring / legal holds) | `do/while (LastEvaluatedKey)` loop; resolvers later moved to GSI queries | #85, #89 |
| C2 / SEC-C1 | Self-signup as platform ADMIN | signup role allowlist; `resolvePlatformRole(null)` returns null (fail-closed) | #84, #91 |
| C3 / SEC-C2 | Cross-tenant org takeover via unbound `membershipId` | centralized `target.orgId === orgId` assertion | #84 |

## HIGH

| ID | Finding | Status | PR |
|---|---|---|---|
| H1 | Accessorial charge lifecycle IDOR | Resolved | #86 |
| H2 | Factoring invoice package/export cross-tenant | Resolved | #86 |
| H3 | Receiver reads any load by id | Resolved | #86 |
| H4 | BOL creation on another shipper's load | Resolved | #86 |
| H5 | Org suspend/reinstate tenant-binding | Resolved | #84 |
| H6 | `/api/maps/*` unauth + unthrottled billed proxy | Resolved (auth + rate limit) | #86 |
| H7 | Didit webhook fails open on missing secret | Resolved (401 in prod) | #84 |
| H8 | Hot-path profile lookups full-table scan | Resolved (userId-index query + REQUIRED boot check) | #87, #88 |
| H9 | Presigned-PUT uploads: no size/MIME cap, no ownership | **Open** | - |
| H10 | Admin grant/revoke on bare `requireAdmin` | **Open** | - |
| H11 | Dependency vulns (axios SSRF/proto-pollution, form-data, path-to-regexp) | axios pinned via override (dev-only exposure) | #86 |
| H12 | SNS webhook signature verifier untested | **Open** | - |
| H13 | Dev capacity-table env var missing -> resolves to prod name | **Open** | - |

## MEDIUM

Numbering below is the consolidated `REPORT.md` ID (the `06-security-iam.md` local IDs
differ; see `REMEDIATION` note in that file's cross-reference).

| ID | Finding | Status | PR |
|---|---|---|---|
| M5 | Accessorial charge listing no role guard | Resolved | #91 |
| M6 | Stop-event injection on unassigned loads | Resolved (assigned-mover check) | #91 |
| M7 | Compliance policy-doc read/sign IDOR | Resolved (party-scoped read + assigned-hauler sign) | #91 |
| M8 | Unauthenticated waitlist email-bomb | Resolved (5/hr/IP rate limit) | #91 |
| M9 | COI/LOA upload: no MIME allowlist | Resolved (allowlist + magic bytes) | #91 |
| M11 | Invitation accept not email-bound; revoke not org-bound | Resolved | #91 |
| M12 | Load mass-assignment via `req.body` spread | Resolved (field allowlist) | #91 |
| M13 | Invitation tokens + Didit PII logged cleartext | Resolved (redaction) | #91 |
| M10 | Dashboard N x full-Loads-scan fan-out | **Deferred** - needs an `assignedDriverId` GSI (perf-infra, like COA-3) | - |
| M1 | AML gate treats never-screened (undefined) as passing | **Open** | - |
| M2 | `maxCapacityLbs` unvalidated | **Open** | - |
| M3 | Accessorial double-charge when policy edited after compute | **Open** | - |
| M4 | Silent-failure fetches in admin consoles | **Open** | - |
| M14-M16 | Test-coverage gaps (canopy/capacity routes, false-green negotiation, untested services) | **Open** | - |

## SEC-C1 follow-ups

- **Resolver flip** (`resolvePlatformRole(null) -> null`): shipped in #91. The
  `staffService` `?? STAFF_ADMIN` fallbacks were intentionally kept - they act on the
  *target's* tier for last-admin protection, not as an auth gate.
- **Prod users audit** (read-only): came back clean. All `role=ADMIN` rows carry an
  explicit `platformRole` (3 STAFF_TEAM_LEAD + 1 STAFF_ADMIN), zero self-signup markers,
  zero null-`platformRole` rows - so nobody was locked out by the resolver flip.

## Not yet started

- HIGH: H9 (presigned-upload hardening), H10 (admin tier), H12 (SNS verifier tests), H13 (dev env parity).
- MEDIUM: M10 perf GSI; M1-M4 correctness; M14-M16 test coverage.
- LOW: the ~15 hygiene items in `REPORT.md` section 2.
