---
connie-title: LoadLead — Frontend Architecture (status-tagged)
connie-publish: true
status: Reconciled
last-reconciled-against: 0f5588d
connie-page-id: '1966082'
---

# Frontend Architecture

## Stack ✅ Done

| Layer | Choice | Evidence |
|---|---|---|
| Build | Vite + TypeScript | `frontend-v2/vite.config.ts` |
| Framework | React 18 | `frontend-v2/package.json` |
| Styling | Tailwind CSS + shadcn/ui primitives | `frontend-v2/tailwind.config.ts`, `src/components/ui/` |
| Routing | React Router v7 | `frontend-v2/src/App.tsx` |
| State | React Query for server state; Context for auth/role/locale | `src/contexts/AuthContext.tsx` |
| Maps | Google Maps JS API | `src/components/RouteMapCard.tsx` |
| Tour | shepherd.js | `src/tour/LoadLeadTour.tsx` |
| E2E | Cypress 15.18 | `frontend-v2/cypress/e2e/` |

## Build artifacts ✅ Done — two deployable bundles

| Bundle | Built with | Deployed to | Behind |
|---|---|---|---|
| Customer | `LL_BUILD=customer npm run build` → `dist/` | s3://loadlead-frontend-prod | CloudFront E38CZNP7L2DB98 (`loadleadapp.com`) |
| Admin | `LL_BUILD=admin npm run build` → `dist-admin/` | s3://loadlead-admin-prod | CloudFront E1RPGX7HLJI48U (`admin.loadleadapp.com`) |

The admin bundle is **on a separate subdomain** with stricter cache behavior (DefaultRootObject = `admin.html`, separate WAF, IP-allowlist-ready). Two physical builds, two physical buckets, two physical CloudFront distributions.

## App structure ✅ Done

```
frontend-v2/src/
  App.tsx                  # router; <RequireRole> gates per persona route
  contexts/                # AuthContext, LocaleContext
  lib/api.ts               # the ONE place every persona hits /api/*
  components/
    ui/                    # shadcn primitives
    dashboard/             # CarrierDashboardView, OwnerOperatorDashboardView (shared atoms)
    attestation/           # AttestationDialog, AttestationBlock, AttestationChain
    admin/                 # AttestationLookup
    RouteMapCard.tsx       # the persona-neutral map widget
  pages/
    driver/        # 5 pages
    shipper/       # 3 pages
    carrier/       # 2 pages
    owner-operator/ # 6 pages (the OO directory uses kebab-case)
    receiver/      # 2 pages
    admin/         # 3 pages
    bol/           # bill of lading
    settings/      # per-persona settings sub-tour
    sandbox/       # design sandbox, not in prod build
  tour/            # LoadLeadTour.tsx + per-persona tour configs
  tests/contract/  # the 6 Pact consumer pacts (one per persona)
```

## Five persona apps + admin console ✅ Done

| Persona | Routes | Key pages | Independence proof |
|---|---|---|---|
| **Driver** | `/driver`, `/driver/history`, `/driver/loads/:id`, `/driver/analytics`, `/driver/verification/idv` | DriverDashboard, DriverHistory, LoadDetail, DriverAnalytics, **DriverVerification** (new) | Pact: `frontend-v2/tests/contract/driver-web.pact.test.ts` |
| **Shipper** | `/shipper`, `/shipper/post`, `/shipper/loads/:id` | ShipperDashboard, PostLoad, LoadDetail | Pact: `shipper-web.pact.test.ts` |
| **Carrier (CARRIER_ADMIN)** | `/carrier` + nested dispatch + members tabs | CarrierDashboard, MembersTab | Pact: `carrier-web.pact.test.ts` |
| **Owner Operator** | `/owner-operator`, `/owner-operator/history`, `/owner-operator/loads/:id`, `/owner-operator/analytics`, `/owner-operator/settings`, `/owner-operator/verification` | OwnerOperatorDashboard, OwnerOperatorAnalytics, OwnerOperatorHistory, OwnerOperatorLoadDetail, OwnerOperatorSettings | Pact: `oo-web.pact.test.ts` |
| **Receiver** | `/receiver`, `/receiver/loads/:id` | ReceiverDashboard (de-fabricated), LoadDetail | Pact: `receiver-web.pact.test.ts` |
| **Platform staff (ADMIN)** | `/admin/*` (separate subdomain) | Dashboard, OrgsTable, AttestationLookup, IDV review queue | Pact: `admin-console.pact.test.ts` |

> **The independence rule**: each persona team can ship their own bundle without coordinating with the others, as long as the contract their consumer pact captures still verifies against the API. A change to the Shipper UI that doesn't touch `frontend-v2/src/lib/api.ts` doesn't fire the cross-persona compatibility check. A change that DOES touch the API shape triggers the can-i-deploy gate against all 6 pacts.

## Key flows ✅ Done

### Signup ✅
- Landing page → role card → `/signup?role=<KEY>` → role-appropriate profile form
- 5 public personas reachable from Landing (ADMIN intentionally absent)
- Backend transactional creation with capability enforcement (`assertCapabilities()` in `orgService.ts`)
- Evidence: `src/pages/Landing.tsx`, `src/pages/Signup.tsx`

### Verification ✅ (driver UX gap closed)
- `OwnerOperatorVerification.tsx` — OO two-gate (authority + identity)
- `DriverVerification.tsx` — driver two-gate (affiliation + identity), new in `978dce9`. Fills the gap where unaffiliated drivers had no obvious next step on the dashboard.

### Load creation with taxonomy dropdowns ✅
- `PostLoad.tsx` uses `Combobox`, `MultiCombobox`, `AsyncCombobox` over the reference-data API (`/api/reference/*`)
- Orthogonal type fields: mode, service-type, equipment-class, equipment-models, commodities, accessorials, hazmat-class
- Lives at `src/pages/shipper/PostLoad.tsx`

### Dashboards ✅
- Shared atoms layer at `src/components/dashboard/` ensures Carrier and OwnerOperator dashboards use the same metric primitives
- Carrier-dispatcher + Carrier-exec views (independent of OO)
- OO blended dashboard (self-haul + fleet)
- Receiver dashboard now reads real `/api/receiver/incoming` (mockData removed in `978dce9`)

### Onboarding tour ✅
- shepherd.js-based, per-persona configs (`src/tour/configs/`)
- Triggered on first dashboard render, replayable from Settings → Tour
- a11y + reduced-motion polish included

## Auth-as-a-contract ✅ Done

Each persona's pact pins the authZ behavior it depends on. Pact verification runs against the broker and the can-i-deploy gate blocks the deploy if any of these flip:

| Persona | Contract | Why it matters |
|---|---|---|
| Driver | UNAFFILIATED returns `200 { loads: [] }` (NOT 403) | Dashboard relies on the empty list + the dedicated `/affiliation` signal to render the "Awaiting affiliation" banner; would crash on 403 |
| Shipper | Cross-shipper read returns `404` (NOT 403) | Existence-leak protection — shipper UI distinguishes "load not found" from "forbidden" |
| Receiver | Cross-receiver read returns `404` (NOT 403) | Same existence-leak protection |
| Receiver | Confirm without signature returns `412 RECEIVER_CONFIRM_REQUIRED` | UI shows the gate inline instead of generic 500 |
| Carrier | ORG_DRIVER reading the carrier dashboard returns `403` | UI routes 403 to "insufficient permission" empty state; flipping to 200-with-empty would leak revenue aggregates to drivers |
| Admin | Suspend without 6+ char reason returns `400` | The 400 IS the audit-trail enforcement mechanism — without the reason, no row gets written |

All 6 are part of the `@H5..@H10` Pact features; see `docs/LoadLead_CrossPersona_Contract_UAT_BDD.md`.

## In-app surfaces 🟡 PARTIAL

| Surface | Status | Notes |
|---|---|---|
| Driver verification + affiliation banner | ✅ | shipped `978dce9` |
| Receiver de-fabricated dashboard | ✅ | shipped `978dce9`; stat cards "—" where backend metric doesn't exist (honest) |
| Admin attestation chain lookup | ✅ | `src/components/admin/AttestationLookup.tsx` |
| Receiver "Delivered (30d)" + "Exceptions" stat cards | 🟠 | Both honest "—" with "Backend metric pending" hint until a receiver-side aggregation endpoint exists |
| Admin view of `correctsSignatureId` correction chain | 🟠 | Field plumbed end-to-end; UI not yet rendering "this corrects X." See [PR-6](PendingRegister.md#medium) |
| Per-OO settings vs Carrier settings | ✅ | Separated by independence rule |

## Test coverage ✅ Done

| Test type | Count | Where |
|---|---|---|
| Cypress E2E | 9 specs (5 personas + a11y + cross-tenant authz + tour + smoke) | `frontend-v2/cypress/e2e/` |
| Consumer pact (contract) | 6 files, 18 interactions | `frontend-v2/tests/contract/` |
| Component / unit | Minimal — most logic is in `lib/api.ts` (tested via pacts) | n/a |
| k6 load | `tests/load/fan100.js` — 100 concurrent load lifecycles | repo root `tests/load/` |

Frontend type-check: `0 errors` against the current main (`npx tsc --noEmit` in `frontend-v2/`).
