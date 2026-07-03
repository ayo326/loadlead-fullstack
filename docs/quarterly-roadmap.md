---
title: Quarterly Product Roadmap (Q3 2026 - Q2 2027)
status: active
owner: product
updated: 2026-07-02
---

# LoadLead Quarterly Product Roadmap

Product-level plan across the five engineering teams, compiled 2026-07-02
from 245 Jira issues (~187 open), docs/PendingRegister.md (zero go-live
blockers), the two platform reviews (docs/telematics-integration-review.md,
docs/sms-program-review.md), and the live codebase.

**The interactive version of this document is docs/roadmap-dashboard.html** -
clickable items with Jira links, a quarter calendar that re-flows the plan,
an editable Gantt (quarter / offset / duration per item), per-item and global
notes (browser localStorage), JSON export, and reset-to-plan.

## Inputs (where the work stands)

| Open backlog block | Count | Signal |
|---|---|---|
| STIG / security items | 49 | Largest block; sliced across quarters (COA-S) |
| Test matrix + UAT | 45 | Certify the five personas before GA |
| Telematics epic (SCRUM-216) | 16 | Staged-go review done; NOW tier unblocked |
| SMS program epic (SCRUM-232) | 14 | Staged-go review done; registration is the long pole |
| Analytics DB (PostGIS) | 14 | Spec complete, unprovisioned |
| Admin / business ops | 9 | Includes broker authority items that gate revenue mechanics |
| Carrier refactor + dashboards + hardening remnants | ~21 | Mop-up |

Shipped and load-bearing (the assets the bets stand on): payments pipeline v3
(factoring, payee routing, reconciliation), detention policy freeze + both-side
e-sign, compliance layer (audit, holds, LE handling, WORM signature sink),
five-team ownership + Jira routing, prod fully under Terraform.

## Quarter themes

| Quarter | Theme | Headliners |
|---|---|---|
| Q3 2026 | Prove the money loop, open the gates | SMS NOW tier + 10DLC registration (start day 1); telematics NOW tier; STIG HIGH slice; E2E pass; Texas cohort running real detention-to-factoring loops; Mobile M0 (PWA) |
| Q4 2026 | Live tracking + mobile foundation | Telematics tracking tier (geofenced detention); SMS go-live; Analytics Tier 1; Mobile M1 (Expo driver shell); GA flip decision; admin/business backlog |
| Q1 2027 | Driver app launch + differentiation | Mobile M2 store launch; Bet 1 Instant Pay; Bet 2 Zero-Dispute Detention; Bet 3 Double-Broker Shield; STIG MEDIUM + SOC 2 readiness |
| Q2 2027 | Scale + intelligence | Bet 4 HOS-aware matching; Bet 5 Backhaul optimizer + liquidity heatmap; Mobile M3; SOC 2 Type I audit; Cohort 2 beyond Texas |

## Courses of action (summaries; full pros/cons tables in the dashboard)

- **COA-M Mobile strategy - recommended B:** PWA hardening now (the app is
  not even installable today - sw.js exists, no manifest), then an
  Expo/React Native driver-first app (background GPS + store presence where
  they matter), then expand by retention data. Full native and
  Capacitor-wrapper options rejected.
- **COA-G GA timing - recommended B:** flip BETA_MODE off mid-Q4, after the
  E2E pass and the HIGH security slice, with SMS acquisition live to catch
  the demand. beta.loadleadapp.com remains the staging surface.
- **COA-S Security debt - recommended B:** slice the 49 STIG items
  risk-ranked (HIGH in Q3, MEDIUM + SOC 2 readiness in Q1, audit in Q2)
  instead of stopping the line or deferring. Converts the backlog into a
  sales asset (SOC 2) rather than a tax.
- **COA-D Differentiation focus - recommended A then B:** money-loop bets
  first (they productize machinery that already exists), intelligence bets
  second (they need the data the Q3-Q4 enablers generate).

## Competitive bets (why LoadLead wins)

1. **Instant Pay** (settlements) - same-day factoring-backed payout on
   attested POD. The rails exist; DAT/Truckstop carriers wait 30-90 days.
2. **Zero-Dispute Detention** (settlements) - policy frozen at posting,
   both sides e-signed, geofence-attested stop events, auto-computed
   charges. 80% built; the industry's #1 fight becomes a headline feature.
3. **Double-Broker Shield** (identity) - IDV + carrier-of-record + FMCSA +
   WORM chain, marketed as native trust against freight's biggest fraud wave.
4. **HOS-Aware Matching** (marketplace) - only show loads a driver can
   legally run. Safety as product; needs telematics HOS.
5. **Backhaul Optimizer + Liquidity Heatmap** (marketplace) - kill deadhead
   for carriers, show liquidity to shippers; built on Analytics Tier 1.
6. **SMS Claim-by-Reply** (marketplace) - the SMS two-way ingress makes
   "reply 1 to claim" a small extension with outsized driver love.

## Web to Mobile migration track

| Milestone | Target | Exit criteria |
|---|---|---|
| M0 PWA hardening (manifest, installable, offline shell, push deep links) | Q3 2026 | Lighthouse PWA pass; push reopens the app to the right load |
| M1 Expo driver app shell (auth, loadboard, offers, stop check-in) | Q4 2026 | A beta driver completes a full load on an internal build |
| M2 Store launch (background GPS, offline POD, App/Play review) | Q1 2027 | Public listings; >=60% of active drivers on the app |
| M3 Fleet mode / shipper companion or responsive parity | Q2 2027 | Second persona weekly-active on mobile |

M2's background-location work double-serves the telematics tracking tier as
the fallback when a carrier has no ELD.

## Standing risks

1. Vendor clocks (10DLC registration, app-store review, SOC 2 auditor
   scheduling) are the only immovable dates - each is front-loaded in its
   quarter.
2. The scheduled-worker enabler is shared by telematics tracking, SMS
   broadcast scale, and the rebroadcast debt; it is the single most
   leveraged engineering item in Q4.
3. One-person compliance (David holds all three roles by decision) is fine
   for beta; revisit at GA when support volume creates a second admin.
4. Cohort quality beats cohort size through Q4; the bets assume real usage
   data from Texas.
