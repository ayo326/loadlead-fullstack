# LoadLead - UI/UX & Defect Audit Report

**Date:** 2026-07-04 · **Discipline:** UX Research · UI Design · QA Automation · **Type:** Non-destructive audit (read-only). No code, layout, or live-environment changes were made. **Approval required before any implementation.**

**Surface audited:** `frontend-v2` (React + Vite SPA) - all five personas: Shipper, Driver, Owner-Operator, Carrier (dispatcher/admin), Platform Admin, plus Receiver. Routes mapped from `src/App.tsx`; hierarchy and defects traced to component source (`file:line` cited throughout).

---

## 1. Executive Summary

The platform is **feature-complete and internally consistent** - a shared design system (`components/ui`, `PageHeader`, `atoms.tsx`), consistent auth-gated routing (`RequireRole`), loading states across 88 call sites, an `ErrorBoundary`, and alt text on all 10 images. The **Driver dashboard is the model to copy**: it surfaces the single time-critical thing (live offers + a live `Countdown` to accept/decline) above the fold.

The core issue is **hierarchy and flow, not missing features**. Several dashboards present information as a **flat list or a set of equal-weight tabs**, so the user's most urgent action is not "above the fold." The three highest-impact patterns:

1. **The Carrier loadboard ("Dispatch") is hidden behind a tab** - a dispatcher's primary job is one click removed from their landing screen.
2. **The Shipper dashboard leads with a *hardcoded, fake* analytics chart** and a flat load list - no "needs-attention" grouping, and a fabricated "Match velocity" graph that misrepresents data.
3. **Settings is a 1,849-line, 7-tab monolith** where a **critical onboarding gate (Verification) is split across two separate tabs**, buried two levels deep.

### Critical blockers discovered
- **None that block usage.** No broken routes (all `App.tsx` paths resolve to a component; `*` → `NotFound`). No missing auth guards. This is a **polish + information-architecture** engagement, not a firefight.
- **One data-integrity defect (High):** the Shipper "Match velocity (7 days)" chart renders **static fabricated values** (`ShipperDashboard.tsx:147`), presenting fake data as a real business metric.

**Tally:** 1 High, 5 Medium, 6 Low defects · 4 high-click / cognitive-load flags · full P1/P2/P3 re-org proposed for 3 dashboards + the loadboard. **Nothing is removed** - every re-org below relocates or regroups existing elements only.

---

## 2. UI Defect Log (Bug Tracking)

| # | Severity | Component / Page | Defect | Suggested Fix (non-destructive) |
|---|---|---|---|---|
| D1 | **High** | Shipper Dashboard (`pages/shipper/ShipperDashboard.tsx:144-152`) | "Match velocity (7 days)" chart renders **hardcoded** bar heights `[40,55,38,70,62,88,75]` with static day labels - fabricated data shown as a real metric. | Wire to a real match-rate endpoint, **or** relabel "Sample" / gate behind real data. Do not ship fake analytics. Keep the widget; feed it truth. |
| D2 | **Med** | Carrier Dashboard (`pages/carrier/CarrierDashboard.tsx:682-696`) | The loadboard is the **"Dispatch" tab**, 4th of 4 tabs - the dispatcher's core task is not the default view. | Make `dispatch` the **default tab** for dispatcher role, or promote an "Active loads" strip above the tab bar (see §4). |
| D3 | **Med** | Settings (`pages/settings/SettingsPage.tsx:537-538, 822-823`) | **Verification is split across two tabs** ("ID Verification" + "Business Verification") inside a 7-tab page - a required onboarding gate is fragmented and buried. | Group into one **"Verification"** tab with two sub-sections; surface a completion badge on the tab. No fields removed. |
| D4 | **Med** | Shipper "Post a load" CTA (`ShipperDashboard.tsx:60`) | CTA is `disabled={!profileComplete}` with **no inline reason** - a new shipper sees a dead button and no next step. | Keep disabled, add a tooltip/inline hint ("Complete your profile to post") linking to the exact settings tab. |
| D5 | **Med** | Data tables - horizontal scroll (`ShipperDashboard`, `CarrierMembers`, `admin/OrgManagementPanel`, `admin/ComplianceConsole`, `admin/StaffManagement`, `admin/BetaProgramDashboard`, `carrier/CarrierDashboard`) | Wide tables use `overflow-x-auto` + fixed `min-w-[…]`, so on ≤1080p / tablet the table scrolls horizontally and key columns fall off-screen (the classic "grid breaks on 1080p" class). | Priority columns pinned; secondary columns collapse into a row-expander or stack on `<lg`. Responsive column strategy, not raw horizontal scroll. |
| D6 | **Med** | Whole app - initial load (`dist/assets/index-*.js` ≈ **963 KB / 265 KB gzip**, single chunk) | No code-splitting: every persona downloads all five dashboards' code on first paint → slow "slow-loading component" symptom, worst on drivers' mobile/poor connections. | Route-level `React.lazy()` + `manualChunks` for vendor (maps, charts). Ties to the "unresponsive/slow" scan item. |
| D7 | **Low** | Settings (`pages/settings/SettingsPage.tsx`, **1,849 LOC / 7 tabs**) | Single monolithic page mixing profile, equipment, authority, 2× verification, organisation, security → high scroll + tab-hunt cognitive load. | Split into logical groups (Identity, Business, Security, Org) - regroup, don't delete. |
| D8 | **Low** | Owner-Operator Dashboard (`OwnerOperatorDashboard.tsx:191, 199`) | Fleet **management** actions deep-link to `settings?tab=fleet`; the dashboard shows fleet read-only, so "manage" = leave dashboard → settings → tab. | Inline the common fleet action (add/assign driver) on the dashboard card; keep the full manager in settings. |
| D9 | **Low** | Shipper Dashboard | No above-the-fold KPI/summary row and **no urgent grouping** - OPEN/OFFERED loads needing attention are visually equal to DELIVERED/CANCELLED in one flat list. | Add a StatCard summary row + "Needs attention" section (see §4). Uses existing `StatCard`. |
| D10 | **Low** | Global | The only two `TODO/placeholder` markers in `pages`+`components` are benign, but confirm no persona sees literal placeholder copy in prod. | Grep-gate in CI; verify none render to users. |
| D11 | **Low** | Icon-only controls | Several `<Button variant="ghost" size="sm">` are icon-only (e.g. row actions) - verify each has an `aria-label` / title for screen readers and 44px tap target on mobile. | Add `aria-label` + ensure min tap size. |
| D12 | **Low** | Broken-link coverage | Static scan shows all `<Link to>`/route targets resolve; **runtime** dead-link/console-error coverage is not yet automated. | Add a Playwright crawl asserting 0 console errors + no 404 on nav across personas (QA automation deliverable). |

**Scan method:** route map from `App.tsx`; per-page render-hierarchy extraction; defect greps for `overflow-x`, fixed `min-w`, `TODO`, alt/aria, tab/accordion density; bundle size from `vite build`. All findings are code-verified, not speculative.

---

## 3. Click-Path & Friction Analysis

### High-click zones (>3 clicks / task, or core task not on landing)

| Task (persona) | Current path | Clicks | Friction |
|---|---|---|---|
| **Dispatch a load to a driver** (Carrier) | Login → land on **Overview** tab → click **Dispatch** tab → locate load → open "pick a driver" select (`CarrierDashboard.tsx:551`) → choose → confirm | 5+ | The dispatcher's #1 job is behind a tab that isn't the default. |
| **Complete verification** (Carrier/OO onboarding gate) | Login → Settings (nav) → **ID Verification** tab → (later) **Business Verification** tab | 3-4, **split** | A single gated goal is fragmented across two tabs of seven (D3). |
| **Post first load** (new Shipper) | Dashboard → "Post a load" **disabled** (D4) → hunt Settings → complete profile → back → Post a load → long form (`PostLoad.tsx`, 811 LOC) | 6+ | Dead CTA with no signposting; the unblock path is undiscoverable. |
| **Manage fleet / assign driver** (OO) | Dashboard → "Manage"/"Add driver" → **navigates away** to `settings?tab=fleet` → act → back to dashboard | 3-4 + context switch | Read on one screen, act on another (D8). |

### Cognitive-load flags (too much unstructured data / buried info)

- **Settings (1,849 LOC, 7 tabs)** - the densest surface; verification, identity, equipment, org, and security all compete at the same level (D7).
- **Carrier Dashboard (701 LOC, 4 tabs)** and **Compliance Console (768)**, **Beta Program (730)** - dense tables with `min-w` horizontal scroll (D5) and no "needs-attention" summary.
- **Shipper Dashboard** - a **flat, undifferentiated load list** (all 7 statuses equal) topped by a **fake chart** (D1/D9): the eye is drawn to fabricated analytics instead of loads needing action.

### What's already right (keep as the pattern)
- **Driver Dashboard** (`DriverDashboard.tsx:142-246`): title "Live load offers" → offers list → per-offer **`Countdown`** → Accept/Decline. The single time-critical action is first, unmissable, and time-boxed. **This is the P1 model** the other dashboards should imitate.

---

## 4. Proposed Information Hierarchy (Dashboards & Loadboards)

**Principle:** *surface the time-sensitive and the actionable; demote the historical and the analytical.* Every element below already exists - this is re-ordering and grouping only (Safety Constraint §honored).

### 4.1 Shipper Dashboard

| Tier | Content (all existing) |
|---|---|
| **P1 - first 2 seconds** | Summary StatCard row (Open · Offered/awaiting · In-transit · Needs-action counts) **+** a **"Needs attention"** block: loads in `OFFERED`/`DRAFT` (action required). Primary **Post a load** CTA with the D4 hint. |
| **P2 - 1 click** | The full "All loads" list with its existing search + status filter (unchanged), default-sorted newest/active first. |
| **P3 - scroll / sub-tab** | "Match velocity" chart - **only once wired to real data (D1)** - plus completed/cancelled history. |

```
┌──────────────────────────────────────────────┐
│ Your loads                    [ Post a load ▸]│  P1
│ ┌─Open 4─┐┌─Awaiting 2─┐┌─In-transit 1─┐┌─⚠3─┐│
│ NEEDS ATTENTION  (OFFERED / DRAFT)            │
│  • Load #1042  OFFERED  → Review offer         │
├──────────────────────────────────────────────┤
│ All loads   [search][status ▾]                │  P2
│  … list …                                      │
├──────────────────────────────────────────────┤
│ ▸ Match velocity (real data)  ▸ History        │  P3
└──────────────────────────────────────────────┘
```

### 4.2 Carrier Dashboard (dispatcher)

| Tier | Content (all existing) |
|---|---|
| **P1** | An **"Active loads / Dispatch"** strip **above** the tab bar (or `dispatch` as the default tab): open loads + the "pick a driver" assign control (`:551`). Urgent = unassigned/expiring first. |
| **P2** | The existing tabs - **Overview**, **Drivers (onboard)**, **Verification** - remain one click away, order by frequency of use. |
| **P3** | Fleet analytics / historical dispatch logs lower or under Overview. |

```
┌──────────────────────────────────────────────┐
│ Dispatch   [Overview][Drivers][Verification]  │
│ ACTIVE LOADS (assign now)                     │  P1 (was tab #4)
│  • Load #88  OPEN   [pick a driver ▾][Assign] │
│  • Load #90  OFFERED  ⏱ 04:12                  │
├──────────────────────────────────────────────┤
│ tab content (Overview KPIs, etc.)             │  P2/P3
└──────────────────────────────────────────────┘
```

### 4.3 Owner-Operator Dashboard

| Tier | Content (all existing) |
|---|---|
| **P1** | "Active Load Offers" StatCard + **Available Loads** list with accept action (already near top - keep, add a countdown like Driver). |
| **P2** | **Your Fleet** card with an **inline** add/assign-driver action (D8), plus the link to full fleet settings. |
| **P3** | Analytics + factoring entry points (already routed) below. |

### 4.4 Loadboard (shared list pattern - Shipper "All loads", Carrier "Dispatch", OO "Available")

- **Sort/priority:** time-sensitive first - `OFFERED`/expiring (with a live `Countdown`), then `OPEN`, then in-transit; terminal states (`DELIVERED`/`CANCELLED`) collapse to a "History" section (P3).
- **Row density:** show the 4-5 decision columns (lane, rate, equipment, status, action); push the rest into a row-expander so the grid stops horizontally scrolling on ≤1080p (fixes D5 without hiding data).
- **Empty/urgent states:** a clear "No loads need action" vs. a highlighted "3 loads awaiting your response."

### 4.5 Settings (all personas)

Regroup the 7 tabs (no field removed): **Profile · Equipment** → *Operations*; **ID + Business Verification** → one ***Verification*** tab with a completion badge (fixes D3); **Authority & Insurance · Organisation** → *Business*; **Security** stays. Deep-links (`?tab=…`) preserved.

---

## 5. Recommendations & Sequencing (post-approval)

| Priority | Item | Findings closed | Effort |
|---|---|---|---|
| 1 | Fix the fake Shipper chart (wire real data or relabel) | D1 | S |
| 2 | Promote Carrier Dispatch + Shipper "Needs attention" above the fold | D2, D9 | M |
| 3 | Merge Verification into one tab + add the disabled-CTA hint | D3, D4 | S |
| 4 | Responsive table strategy (kill horizontal scroll) | D5, D11 | M |
| 5 | Route-level code-splitting | D6 | M |
| 6 | Playwright cross-persona nav + 0-console-error crawl (QA automation) | D12, D10 | M |
| 7 | Settings regroup + OO inline fleet action | D7, D8 | M |

**All changes are additive/organizational.** No feature, filter, button, or data point is deleted - the audit's mandate is visibility and flow.

---

*Prepared for review. No implementation, layout change, or live-environment action will be taken until this report is explicitly approved.*

---
---

# Round 2 - Rendered-UI Audit (screenshot evidence)

**Method:** Round 1 was code-derived. Round 2 reviews **live rendered screenshots** (Owner-Operator dashboard ×2, Shipper dashboard, Post-a-load, Load History) and traces each visual issue back to source. Rendered evidence surfaced a **structural composition bug** and a set of **visual-finish** issues that static analysis could not.

## R2.0 Headline (the three stakeholder callouts - all confirmed)

1. **"Settings appears twice" - CONFIRMED (High).** On the OO dashboard, *Settings* is in the left sidebar (Account group) **and** repeated as a button in the page header (`OwnerOperatorDashboard.tsx:79-80`). Two controls, same destination, ~6 cm apart.
2. **"Live map + load are below the fold" - CONFIRMED (High).** The OO's only actionable content - the **Available Loads** row (`Dallas → Houston, 1 offered`) and the **Route preview** map - render at the very **bottom** of the page, beneath My haul, verification, an all-zero "Alerts" wall, Fleet & compliance, and a "Tendered loadboard". A driver-operator must scroll past ~6 mostly-empty sections to reach the load they can actually accept.
3. **"White cards look unfinished / like paper on the background" - CONFIRMED (Med).** White surfaces sit on a saturated blue→violet page gradient with inconsistent elevation and large empty gradient voids (Load History, Shipper dashboard tail). The result reads as unfinished "paper floating on a backdrop."

## R2.1 Root cause of #1 and #2 - a stacked-dashboard composition bug

`pages/owner-operator/OwnerOperatorDashboard.tsx` renders the **entire** blended dashboard **twice over**:

- `:90` → `<OwnerOperatorDashboardView />` - a complete dashboard (My haul → verification → Alerts → Fleet & compliance → **Tendered loadboard** → Financial → SLA).
- `:94-104` → a **second** set of `StatCard`s (Active Load Offers / Fleet Drivers / MC Number).
- `:118` → a **second** loadboard ("**Available Loads**").
- `:246` → the **Route preview** map.
- then "Your Fleet".

So the page is *[full dashboard]* + *[another metrics+loadboard+map shell]*. This one bug produces **three** of the visible problems: the map/loads land last (callout #2), there are **two conflicting loadboards** (the View's "Tendered loadboard" shows *"No outstanding offers"* while the shell's "Available Loads" shows *"1 offered"* - directly contradictory), and metrics are duplicated. **Fix is consolidation, not deletion:** render one dashboard; lift the Route map + Available Loads into the top (P1) of the View; collapse the two loadboards into one source of truth.

## R2.2 Round-2 Defect Log

| # | Severity | Page / Component | Rendered defect (evidence) | Suggested fix (non-destructive) |
|---|---|---|---|---|
| V1 | **High** | OO Dashboard (`OwnerOperatorDashboard.tsx:79-80`) | **Settings rendered twice** - sidebar + header button, same target. | Remove the header duplicate (keep the sidebar canonical), or repurpose the header slot for a real action (e.g. "Go online"). |
| V2 | **High** | OO Dashboard (`:90` vs `:94-246`) | **Map + Available Loads below the fold**; page stacks two dashboards → the only actionable load & the route map are dead-last. | Lift Route map + Available Loads to **P1**; render a single dashboard (R2.1). |
| V3 | **High** | OO Dashboard | **Two contradictory loadboards** - "Tendered loadboard: No outstanding offers" vs "Available Loads: 1 offered" on the same screen. | One loadboard, one truth; dedupe the shell vs View. |
| V4 | **Med** | Global theme | **"Paper on background"** - white cards on a blue/violet gradient, inconsistent shadows/borders, large empty gradient voids. | Commit to one surface system: either a calm neutral page bg with clearly-elevated cards (border + soft shadow), or tint the cards to sit *in* the gradient. Constrain max-content width so cards don't float in a void. |
| V5 | **Med** | OO Dashboard - "Alerts" section | Section titled **"Alerts"** but every tile reads **0 / "Connect ELD" / "Connect reefer telemetry" / "Pending data"** - a wall of empty above real content, and "Alerts" is a misnomer when there are none. | Collapse empty/again-later tiles into a compact "Fleet health" strip; only expand when non-zero; move below the loadboard. Rename to reflect state. |
| V6 | **Med** | Post a load (`RouteMapCard.tsx` map embed) | With no address entered, the **Route preview shows the entire world map** (zoomed all the way out) - reads as broken. | Show a neutral placeholder ("Enter pickup & delivery to preview route") until both ends resolve; don't render a world view. |
| V7 | **Med** | Shipper Dashboard (`ShipperDashboard.tsx:144-152`) | The "Match velocity (7 days)" chart renders **empty** (no bars, just M-S axis) yet still states **"Average match: 52s"** - reinforces R1-D1: fabricated + visually broken. | Same as D1 - wire real data or hide until data exists; never show a stat with an empty chart. |
| V8 | **Low** | Top nav / tour layer | **Clipped text bleeding over the top edge** - fragments "…out this field", "leads." overlap the viewport top/logo (tour tooltip or logo tagline overflow). | Constrain tour tooltip within viewport; fix logo tagline wrap/clip at the top bar. |
| V9 | **Low** | Load History + Shipper tail | **Large empty gradient voids** - a single small card floats in a tall purple expanse (short content, full-height gradient). | Center/constrain content, add an illustrative empty state, or cap page height so the void doesn't dominate. |

## R2.3 Revised Owner-Operator hierarchy (addresses callouts #1 & #2)

```
┌───────────────────────────────────────────────────────────┐
│ Welcome back, Demo Owner Operator LLC     [Go online ▸]    │  header: NO 2nd Settings (V1)
│ [Dispatcher | Exec]                              ↻ Refresh │
├───────────────────────────────────────────────────────────┤
│ ⓘ My haul: no active load                                 │  P1
│ AVAILABLE LOADS (1)         │  ROUTE PREVIEW  Dallas→Houston│  P1  ← lifted from bottom (V2)
│  • Dallas→Houston 34,000lb  │  [ map ]                      │
│    $-   [View] [Route]      │                              │
├───────────────────────────────────────────────────────────┤
│ My verification ✓ ✓ (both gates)                          │  P2
│ Your fleet (1 self · 0 fleet)   [+ inline add driver]      │  P2
├───────────────────────────────────────────────────────────┤
│ ▸ Fleet health (ELD/reefer/HOS)  ▸ Financial  ▸ SLA        │  P3 (was the "Alerts" zero-wall, V5)
└───────────────────────────────────────────────────────────┘
```

One loadboard (V3). Map + loads above the fold (V2). Settings only in the sidebar (V1). Empty telemetry demoted (V5). **No feature removed** - every element is retained, only relocated/merged.

## R2.4 Visual-finish direction (callout #3)

The gradient-with-floating-white-paper look is the single biggest "unfinished" signal. Recommended, low-risk direction (design-token level, applied globally):
- **Surface contrast:** give every card a consistent `1px` hairline border **and** a single soft shadow token, so white reads as a deliberate raised surface, not a cut-out.
- **Background:** reduce gradient saturation (or confine it to the header band) so the body is a calm neutral; the current full-page violet is what makes white cards look pasted-on.
- **Density / voids:** cap main content width (~1200px) and add real empty-states so short pages (Load History) don't leave a tall colored void.
- **Consistency:** audit `bg-card` vs `bg-white` usage so all cards share one treatment.

## R2.5 Updated sequencing (Round 1 + Round 2)

| Pri | Item | Closes | Effort |
|---|---|---|---|
| 1 | OO dashboard: de-stack the double render; lift map+loads to P1; one loadboard; drop 2nd Settings | V1,V2,V3, R1-D8 | M |
| 2 | Visual-finish pass: card border/shadow token, calmer bg, max-width, empty states | V4,V9, callout #3 | M |
| 3 | Kill fabricated/empty analytics (Shipper chart) + empty-map placeholder | V7,V6, R1-D1 | S |
| 4 | Demote empty telemetry "Alerts" wall; rename to state | V5 | S |
| 5 | Carrier Dispatch above the fold + Shipper "needs attention" (R1) | R1-D2,D9 | M |
| 6 | Settings verification merge + disabled-CTA hint (R1) | R1-D3,D4 | S |
| 7 | Responsive tables, code-splitting, tour-clip fix, Playwright crawl (R1) | R1-D5,D6,V8,D12 | M |

*Round 2 remains non-destructive and advisory. No code, layout, or live-environment change will be made until this report is explicitly approved.*
