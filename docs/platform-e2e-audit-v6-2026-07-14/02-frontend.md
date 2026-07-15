# Platform E2E Audit v6 (2026-07-14) - Dimension 2: Frontend build/typecheck/E2E + FE logic

## Headline
- tsc --noEmit: 0 errors.
- Build: success (1.78s, 1823 modules). Initial customer load ~ vendor 413.99 kB + index 141.95 kB + CSS 103.89 kB (~181 kB gzip). One non-fatal warning.
- E2E: Playwright 46/46 passed (hermetic, real bundle + mocked network). Cypress (9 specs) + Pact (6 contract) present but need live app/backend, not executed here.
- Chunk-shape verdict: PASS - known-good shape. React lives in a single combined `vendor` chunk; no `react-vendor` split. The forwardRef blank-page regression cannot recur with this config.

Overall: healthy. No Critical or High findings. Capacity components, auth/routing gates, and API contract all sound.

## Chunk shape (critical check): PASS
`vite.config.ts:47-55` manualChunks keeps React + react-dom + react-router + radix + eager UI in one `vendor` chunk; only lazy libs split (shepherd->tour-vendor, recharts/d3->charts-vendor, admin-only). Build confirms `vendor-DHJO9Y8z.js` is the sole vendor chunk, no react-vendor in customer dist. Config carries an inline post-mortem of the forwardRef cycle. Matches known-good.

## Findings

### F1 - MEDIUM: Silent-failure fetches in admin consoles
- Evidence: `BetaProgramDashboard.tsx:203` (`listApplications().then().finally()` with no `.catch`), also :301, :597, :686; `LiquidityDashboard.tsx:174-178`. `.then()` inside a try{} does not catch async rejection.
- Impact: on 403/500/network failure these on-mount loads reject unhandled; `loading` clears via `.finally`, the list stays empty, no error surfaced. Admin sees a misleading "no applications / empty" state instead of an error.
- COA: add `.catch(e => toast.error(e.message))` to each on-mount loader. (User-facing pages - DriverDashboard, both LoadDetails, ShipperDashboard, receiver/LoadDetail, BOL - already do this correctly.)

### F2 - LOW: Ineffective lazy() on PrivateBetaLanding
- Evidence: build warning - PrivateBetaLanding.tsx is dynamically imported by App.tsx but also statically imported by Login.tsx/Signup.tsx; App.tsx:18 wraps it in lazy(), but Login.tsx:12 / Signup.tsx:14 import it statically and Login is eager.
- Impact: the lazy() is defeated (module folds into the eager graph); minor bundle bloat + misleading code. No correctness bug.
- COA: drop the lazy() wrapper or refactor the shared beta-wall so Login/Signup import it lazily too.

### F3 - LOW: Single root-level ErrorBoundary
- Evidence: one ErrorBoundary at App.tsx:95 wraps all routes.
- Impact: a render-time throw in any persona page tears down the whole shell to the fallback (reload recovers). A per-route boundary would isolate blast radius.
- COA: optional - wrap the Outlet in AppLayout with a second boundary.

### F4 - LOW: Backend mount-ordering foot-gun (informational)
- Evidence: `index.ts:253` mounts broad `/api/admin` before `/api/admin/beta` (:334), `/api/admin/staff` (:339), `/api/admin/liquidity` (:341), `/api/admin/compliance` (:344).
- Impact: works today via Express fall-through (no colliding sub-paths). Latent: adding a `/staff` route to adminRoutes would silently shadow the dedicated router.
- COA: register the specific `/api/admin/*` routers before the broad `/api/admin`.

## Capacity components: CLEAN
useCapacity/CapacityChip/CapacityChipSelf/CapacityLoginPrompt/CapacityDeclareControls/CapacityRegistrationStep - every hook called unconditionally before any early return (no rules-of-hooks violation). All three surfaces `return null` when `!capacity`; useCapacity fetch catch sets capacity=null so the chip hides rather than showing a wrong number. All 4 mounts verified (DriverDashboard:145-146, OwnerOperatorDashboard:17/110, OwnerOperatorLoadDetail:59/117, OwnerOperatorSettings:170) - no hook behind a conditional.

## Auth/routing: SOLID
RequireAuth shows a spinner while loading; RequireRole and FleetCarrierGate return null until resolved. RuntimeConfigContext is exemplary: 3x retry w/ backoff, fail-closed to muted defaults, always sets loaded:true so gates never hang, self-heals in background. Pages fetch only in useEffect after RequireAuth passes.

## API contract cross-check: NO mismatches
Every src/lib/api.ts endpoint cross-checked against all 29 backend route files; all exist, no path/method mismatches. Canopy trio resolves because canopyRoutes mounts before complianceRoutes. NegotiationPanel long-poll robust (try/catch + 5s backoff + stopped flag + timer cleanup).

## Positives
Cookie auth + clean 401 interceptor (excludes /auth/*, toasts session expiry); route-level code-splitting per persona; strong test infra (Playwright authed/public crawl + negotiation, Cypress per-persona incl a11y + authz-cross-tenant, Pact per persona, prod-guard in cypress.config).
