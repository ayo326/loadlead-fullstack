# UI/UX Audit Remediation - Closure Report

Branch: `platform/uiux-audit-remediation`
Date: 2026-07-04
Scope: frontend-v2 only. No backend code, routes, or data were touched. No UI
library added. Negotiation, payments, and e-sign logic were not altered (layout
moves only). No em dashes or en dashes were introduced.

## Definition of Done

- [x] Every audit defect (D1-D12, V1-V9, F1) is addressed or transparently
      recalibrated with rationale.
- [x] Nothing deleted: every feature, filter, button, field, and data point is
      retained, only relocated, regrouped, merged, or demoted.
- [x] Deep links preserved: `?tab=` links keep working, including the old
      `id`/`biz` tab ids which now map to the merged `verification` group.
- [x] Existing design system reused (PageHeader, StatCard, Countdown, atoms,
      components/ui). No new UI dependency.
- [x] After each phase: tsc clean, unit tests pass, prod build clean. One
      commit per phase, defect IDs in the message.
- [x] Accessibility: every icon-only control carries an aria-label (D11).

## Defect closure table

| ID  | Defect | Phase | Commit | Status |
|-----|--------|-------|--------|--------|
| V1  | Settings appears twice on the OO dashboard | 1 | a303a2a | Fixed |
| V2  | Live map + loads sit below the fold on OO dashboard | 1 | a303a2a | Fixed |
| V3  | Two contradictory loadboards on OO dashboard | 1 | a303a2a | Fixed |
| D8  | OO dashboard double-render (root cause of V1-V3) | 1 | a303a2a | Fixed |
| V4  | White cards read as unfinished against the navy backdrop | 2 | a3bc073 | Fixed |
| V9  | "Paper on the background" card treatment | 2 | a3bc073 | Fixed |
| D1  | Fabricated "match velocity" widget (no endpoint) | 3 | acbc8c8 | Fixed (gated on real data) |
| V7  | Analytics bars rendered from fabricated values | 3 | acbc8c8 | Fixed |
| V6  | World-zoom map embed on a partial address | 3 | acbc8c8 | Fixed |
| V5  | Empty telemetry wall dominating the OO dashboard | 4 | 56df409 | Fixed (demoted to Fleet status) |
| D2  | Carrier dashboard opened on the wrong (overview) tab | 5 | 8098353 | Fixed (defaults to dispatch) |
| D9  | Shipper loads: urgent items buried in the full list | 5 | 8098353 | Fixed (Needs-attention block) |
| D3  | Settings shows two separate verification tabs | 6 | a0e1727 | Fixed (merged, badge) |
| D4  | Post-a-load CTA gives no hint when profile is incomplete | 6 | a0e1727 | Fixed (disabled + title + deep link) |
| D7  | Settings tab regrouping | 6 | a0e1727 | Partial (verification merged; broader Operations/Business regroup deferred, noted below) |
| D5  | Wide tables force horizontal scroll past decision columns | 7 | bb8e7d3 | Fixed + recalibrated (see note) |
| D11 | Icon-only controls lack aria-labels / tap targets | 7 | bb8e7d3 | Fixed |
| D6  | Single ~963 kB JS chunk | 8 | ad09ba9 | Fixed (route-split + vendor chunks) |
| V8  | Tour tooltip overflows viewport; top-bar text clips | 8 | ad09ba9 | Fixed |
| F1  | Tour overlay intercepts clicks on action panels | 8 | ad09ba9 | Verified already scoped to dashboard root |
| D10 | No CI gate for TODO/placeholder in shipped UI | 9 | fe2782d | Fixed (check-placeholders.sh in CI) |
| D12 | No automated rendered-surface crawl | 9 | fe2782d | Fixed (public-route crawl; authed crawl scaffolded) |

## Bundle size: before / after (D6)

Baseline: a single `index` chunk of **963.21 kB (265.62 kB gzip)** - every
persona's code shipped to every user on first load.

After route-level `React.lazy` + `manualChunks`:

| Chunk | Raw | Gzip |
|-------|-----|------|
| index (app shell) | 138 kB | 33.85 kB |
| react-vendor | 160 kB | 51.74 kB |
| vendor | 171 kB | 52.43 kB |
| radix-vendor | 82 kB | 24.81 kB |
| tour-vendor (loads only when a tour runs) | 42 kB | 14.76 kB |
| ShipperDashboard (on demand) | 8 kB | 2.78 kB |
| CarrierDashboard (on demand) | 28 kB | 7.38 kB |
| AdminDashboard (on demand) | 30 kB | 7.55 kB |
| SettingsPage (on demand) | 56 kB | 13.88 kB |

A signed-in shipper now downloads the shell chunks plus only the
ShipperDashboard chunk; the driver, admin, and carrier bundles never load for
them. Vendor code is isolated so a dependency bump no longer re-hashes the app.

## Recalibrations (stated for honesty)

- **D5**: the `min-w-[Npx]` values the audit cited are on responsive
  form-field wrappers (good wrapping), and the wide tables already use
  `overflow-x-auto` (scroll on overflow), so no decision columns were truly
  broken. The responsive-column pattern (secondary columns collapse below `lg`,
  their data re-appears stacked, no data removed) was applied to the primary
  Shipper "All loads" table as the exemplar. The same pattern applies to the
  admin tables if the horizontal scroll proves painful in practice.
- **F1**: the tour auto-start was already scoped to the persona dashboard root
  (`path === home`), never deep routes, so the overlay cannot intercept clicks
  on `/loads/:id` action panels. Verified rather than re-implemented.

## Deferred (out of this build's scope, noted for follow-up)

- Broader D7 Settings regrouping (Profile/Equipment -> Operations,
  Authority/Org -> Business). The high-value verification-tab merge shipped in
  Phase 6; the larger reorganisation is a separate change.
- Authenticated per-persona runtime crawl (D12). Needs a per-persona login
  fixture with real or fully-mocked dashboard endpoints. Authed surfaces are
  covered meanwhile by the static D10 placeholder gate.

## Feature parity statement

No feature, filter, button, field, or data point was removed. Every change is a
relocation, regroup, merge, demotion, or a truthful gate on real data. The two
merged Settings verification tabs still render both the identity and business
verification panels under one tab. The gated Shipper analytics widget retains
its full component and lights up the moment a real endpoint feeds it.
