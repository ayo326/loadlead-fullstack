---
title: Quarterly Product Roadmap (Q3 2026 - Q2 2027)
status: active
owner: product
updated: 2026-07-13
supersedes: 2026-07-02 baseline
---

# LoadLead Quarterly Product Roadmap

Product-level plan across the five engineering teams. Refreshed 2026-07-13
(supersedes the 2026-07-02 baseline) from 249 Jira issues, the v5 platform
audit (`docs/platform-e2e-audit-v5-2026-07-13`), `docs/PendingRegister.md`
(zero go-live blockers), the two platform reviews (telematics, SMS), and the
live codebase - now folding in Canopy Connect (SCRUM-60), compliance documents
(SCRUM-59), and the audit reconciliation backlog.

**The interactive version of this document is `docs/roadmap-dashboard.html`** -
clickable items with Jira links, a quarter calendar that re-flows the plan, an
editable Gantt (quarter / offset / duration per item, with a "today" line and
critical-path + shipped markers), a **Reconciliation** view for the audit
backlog, per-item and global notes (browser localStorage), JSON export, and
reset-to-plan.

## Inputs (where the work stands)

| Open backlog block | Count | Signal |
|---|---|---|
| STIG / security items | 49 | Largest block; sliced across quarters (COA-S) |
| v5 audit reconciliation | COA-1..4 | COA-1/COA-2 merged; COA-3 env parity in progress; COA-4 hygiene backlog |
| Test matrix + UAT | 45 | Certify the five personas before GA; blocked by dev E2E blockers below |
| Dev/CI E2E blockers | 4 Highest | One `createTables.mjs` aux-table fix clears SCRUM-184/192/195; +RBAC-under-concurrency (SCRUM-185) + shipper-form a11y (SCRUM-198) |
| Telematics epic (SCRUM-216) | 16 | Staged-go review done; NOW tier unblocked (SCRUM-224 SNS subscriber is the enabler) |
| SMS program epic (SCRUM-232) | 14 | Staged-go review done; 10DLC registration (SCRUM-239) is the long pole |
| Analytics DB (PostGIS) | 15 | Spec complete, unprovisioned (SCRUM-161) |
| Admin / business ops | 9 | **SCRUM-165 reinstate-LLC + SCRUM-166 brokerage authority are Highest and gate revenue** |
| Compliance & insurance | - | Canopy Connect merged (prod enablement pending); compliance documents (W9 done, phases 4-9 pending) |

Shipped and load-bearing (the assets the bets stand on): payments pipeline v3
(factoring, payee routing, reconciliation), detention policy freeze + both-side
e-sign + e-sign-at-assign gate, compliance layer (audit, holds, LE handling,
WORM signature sink), Canopy Connect insurer-data API, negotiation
(engage/bid/counter, live updates, flat-total), five-team ownership + Jira
routing, prod fully under Terraform, and the v5-audit COA-1/COA-2 hardening
(authz/IDOR gates + unwired-control wiring) merged this cycle.

## Quarter themes

| Quarter | Theme | Headliners |
|---|---|---|
| Q3 2026 | Prove the money loop, reconcile, open the gates | Brokerage authority (revenue critical path); SMS NOW + 10DLC registration (day 1); telematics NOW tier; unblock E2E (aux tables) + E2E pass; STIG HIGH slice; v5-audit COA-3 env reconciliation + Canopy prod enablement; compliance documents; Texas cohort running real detention-to-factoring loops; Mobile M0 (PWA) |
| Q4 2026 | Live tracking + mobile foundation | Telematics tracking tier (geofenced detention; SCRUM-221 worker retires the rebroadcast debt); SMS go-live; Analytics Tier 1; Mobile M1 (Expo driver shell); GA flip decision; Node 22 platform migration; business backlog |
| Q1 2027 | Driver app launch + differentiation | Mobile M2 store launch; Bet 1 Instant Pay; Bet 2 Zero-Dispute Detention; Bet 3 Double-Broker Shield; STIG MEDIUM + SOC 2 readiness |
| Q2 2027 | Scale + intelligence | Bet 4 HOS-aware matching; Bet 5 Backhaul optimizer + liquidity heatmap; Mobile M3; SOC 2 Type I audit; Cohort 2 beyond Texas |

## Reconciliation backlog (v5 platform audit, 2026-07-13)

Full per-finding detail and status live in the dashboard's **Reconciliation**
tab and in `docs/platform-e2e-audit-v5-2026-07-13/REPORT.md`.

- **COA-1 (HIGH authz / gate bypasses) - MERGED.** BL-1 expired-COI gate,
  BL-2 e-sign driver binding, FE-2 beta wall fail-closed, LS-1 CORS 403,
  SEC-1 JWT boot guard, SEC-2/3/4/8/9 IDOR ownership checks. Each shipped
  staging-first with a bypass (negative) test.
- **COA-2 (wire the unwired controls) - MERGED.** SEC-5 legal-hold
  enforcement, SEC-6 payout-intercept surfacing, FE-3 de-spoofed verification
  tab, SEC-7 IAM append-only Deny. *Prod tail: SEC-7 needs a prod `tofu apply`.*
- **COA-3 (environment reconciliation & IaC) - IN PROGRESS.** EP-4 Canopy
  secrets -> tfvars (comment fixed; values pending), EP-3 staging Offers
  `loadId-index` (in the shared module; staging apply pending), EP-7
  isolation-guard both-prefix, EP-1 prod runtime config -> IaC (biggest
  structural/DR gap), EP-2 Canopy prod tables, LS-2/LS-4 staging FE headers +
  noindex. **Items gated on you (secret values I do not handle + a deliberate
  prod apply): EP-1, EP-2, EP-4, and SEC-7's prod apply.**
- **COA-4 (hygiene) - BACKLOG.** BE-1 Node 22 before Q1 2027 (also a Q4
  roadmap item), LS-3 redeploy prod from main, FE-1 FE unit-test CI gate, and
  ~15 rolled-up low-risk items.

Standing security backlog (`PendingRegister.md`, zero go-live blockers) feeds
the STIG slice: `/api/maps/*` needs `authenticate`, bcrypt cost 10 -> 12,
`_bootstrap/.gitignore`, 38/38 STIG control sign-offs, MFA enforcement beyond
admin TOTP, real-Express Pact provider verification.

## Courses of action (summaries; full pros/cons tables in the dashboard)

- **COA-M Mobile strategy - recommended B:** PWA hardening now (the app is not
  even installable today - `sw.js` exists, no manifest), then an
  Expo/React Native driver-first app. The stack (Vite + React 18 +
  shadcn/Radix + Tailwind + TanStack Query) means RN reuses the TS
  types/zod/query/api layer and rebuilds only the web-DOM-only Radix UI. Full
  native and Capacitor-wrapper options rejected.
- **COA-G GA timing - recommended B:** flip BETA_MODE off mid-Q4, after the
  E2E pass, the HIGH security slice, and brokerage authority (a hard legal
  precondition), with SMS acquisition live to catch demand.
- **COA-S Security & reconciliation debt - recommended B:** the audit authz
  class (COA-1) and unwired controls (COA-2) are already closed; slice what
  remains - COA-3 env reconciliation this quarter, STIG HIGH in Q3, MEDIUM +
  SOC 2 readiness in Q1 - converting the backlog into a SOC 2 sales asset.
- **COA-D Differentiation focus - recommended A then B:** money-loop + trust
  bets first (they productize machinery already in prod), intelligence bets
  second (they need the data the Q3-Q4 enablers generate).

## Competitive bets (why LoadLead wins)

1. **Instant Pay** (settlements) - same-day factoring-backed payout on attested
   POD. The rails exist; DAT/Truckstop carriers wait 30-90 days.
2. **Zero-Dispute Detention** (settlements) - policy frozen at posting, both
   sides e-signed, geofence-attested stop events, auto-computed charges. 80%
   built; the industry's #1 fight becomes a headline feature.
3. **Double-Broker Shield** (identity) - IDV + carrier-of-record + FMCSA +
   WORM chain, marketed as native trust against freight's biggest fraud wave.
4. **HOS-Aware Matching** (marketplace) - only show loads a driver can legally
   run. Safety as product; needs telematics HOS (SCRUM-220).
5. **Backhaul Optimizer + Liquidity Heatmap** (marketplace) - kill deadhead for
   carriers, show liquidity to shippers; built on Analytics Tier 1.
6. **SMS Claim-by-Reply** (marketplace) - the SMS two-way ingress makes
   "reply 1 to claim" a small extension with outsized driver love.
7. **Instant Insurance Verification** (compliance) - Canopy Connect
   (SCRUM-60) auto-verifies COI + authority insurer-direct, cross-references
   discrepancies, and drops a hauler to PENDING the moment a certificate
   lapses. Competitors make carriers upload PDFs that go stale; here trust
   updates itself.

## Web to Mobile migration track

| Milestone | Target | Exit criteria |
|---|---|---|
| M0 PWA hardening (manifest, installable, offline shell, push deep links) | Q3 2026 | Lighthouse PWA pass; push reopens the app to the right load |
| M1 Expo driver app shell (auth, loadboard, offers, stop check-in) | Q4 2026 | A beta driver completes a full load on an internal build |
| M2 Store launch (background GPS, offline POD, App/Play review) | Q1 2027 | Public listings; >=60% of active drivers on the app |
| M3 Fleet mode / shipper companion or responsive parity | Q2 2027 | Second persona weekly-active on mobile |

M2's background-location work double-serves the telematics tracking tier as the
fallback when a carrier has no ELD. M1 reuses the TS types, zod schemas,
TanStack Query, and API client from `frontend-v2`; only the Radix/shadcn UI
layer (web-DOM-only) is rebuilt in React Native.

## Standing risks

1. **Brokerage authority is the true revenue gate.** SCRUM-165 (reinstate LLC)
   and SCRUM-166 (FMCSA MC authority + BMC-84 bond) are Highest priority and a
   legal precondition to taking tendered loads - a regulator clock, front-load it.
2. **Prod runtime config is 100% out-of-band (EP-1).** A recreate/DR loses it
   and the env won't boot; codifying it in IaC is the biggest structural fix
   and needs your secret values + a deliberate prod apply.
3. Vendor clocks (10DLC registration, app-store review, SOC 2 auditor,
   AWS SDK-v3 Node-22 cutoff early Jan 2027) are the only immovable dates -
   each is front-loaded in its quarter.
4. The scheduled-worker enabler (SCRUM-221) is shared by telematics tracking,
   SMS broadcast scale, and the negotiation sweeper debt; the single most
   leveraged engineering item in Q4.
5. One-person compliance (all three roles held by decision) is fine for beta;
   revisit at GA when support volume creates a second admin.
6. Cohort quality beats cohort size through Q4; the bets assume real usage data
   from Texas.
