# Platform E2E Audit v5 (2026-07-12) — Dimension: Frontend Build/Typecheck/Test + FE Logic Gotchas

Repo: `/Users/ayodejiejidiran/loadlead-fullstack`, app: `frontend-v2/` (React 18 + Vite 5 + TypeScript 5 + react-router-dom 6, two build targets: customer `dist/` and admin `dist-admin/`).

## Status line

| Check | Result |
|---|---|
| Typecheck (`npx tsc --noEmit`) | **PASS** — exit 0, zero output |
| Build, customer (`npm run build` → `dist/`) | **PASS** — exit 0, 1822 modules, 1.88s, 1 build warning (see FE-5) |
| Build, admin (`npm run build:admin` → `dist-admin/`, bonus check) | **PASS** — exit 0, 2535 modules, 2.08s, no warnings |
| Unit tests (`npm test` = `vitest run`) | **FAIL** — exit 1, but only because Playwright specs are wrongly collected (see FE-1). Real suite: **7 files / 21 tests, 100% pass** |
| Playwright E2E (`npx playwright test --reporter=line`) | **PASS** — 46/46 tests, 46.3s, self-started dev server, finished well inside the 3-min timebox (no hang) |

Raw command output saved alongside this report: `tsc-output.txt`, `build-output.txt`, `build-admin-output.txt`, `test-output.txt`, `playwright-output.txt`.

**Transparency note:** running the Playwright suite (task step 4, as instructed) overwrote two files that are tracked in git — see FE-6. I did not revert or commit anything; `git status` currently shows:
```
 M docs/overnight-2026-07-03/e2e/playwright-report/index.html
 M docs/overnight-2026-07-03/e2e/results.json
```

---

## Findings

### FE-1 — `npm test` is broken: vitest collects Playwright e2e specs (MEDIUM)

**Evidence:**
- `frontend-v2/package.json:11` — `"test": "vitest run"`, the documented unit-test command.
- `frontend-v2/vite.config.ts` has no `test` block at all (confirmed by full read + `grep -n "test:" vite.config.ts` → no match), and there is no separate `vitest.config.ts`. Vitest therefore uses its default include glob (`**/*.{test,spec}.*`), which also matches Playwright's `frontend-v2/e2e/*.spec.ts` naming convention.
- Actual run (`test-output.txt`): `Test Files 5 failed | 7 passed (12)` / `Tests 21 passed (21)` / `EXIT_CODE:1`. All 5 failures are the e2e specs (`e2e/authedCrawl.spec.ts`, `e2e/haulerFlows.spec.ts`, `e2e/placeholderCrawl.spec.ts`, `e2e/shipperFlows.spec.ts`, `e2e/tourScoping.spec.ts`), each with the identical error: `Error: Playwright Test did not expect test.describe() to be called here` (Playwright's `test()`/`test.describe()` throw when invoked outside Playwright's own runner).
- No CI workflow actually runs the unscoped command that's broken: `.github/workflows/frontend-pact.yml:62` runs `npx vitest run tests/contract/` (scoped, avoids the collision); `.github/workflows/frontend-lint.yml` only runs ESLint + placeholder/dash gates (no vitest, no tsc, no vite build at all); `.github/workflows/sync-test-dashboard.yml` is backend-only (`working-directory: backend`). So this breakage has no CI safety net today.

**Impact:** Any developer following the documented `npm test` gets a false-failure/red result even though the real unit + Pact contract suite (21 tests) is 100% green. Risk of alarm fatigue masking a genuine future regression. More importantly, there is currently **no CI job that runs the general frontend unit-test suite at all** — only the narrow Pact-contract subset is gated.

**COA:** Add `test: { exclude: [...configDefaults.exclude, 'e2e/**'] }` to `vite.config.ts` (or a dedicated `vitest.config.ts`), then add a CI job that runs the (now-working) `npm test` on PRs touching `frontend-v2/src`.

---

### FE-2 — Private-beta wall fails OPEN on `/beta/status` failure, contradicting the fail-closed design next to it (HIGH)

This is the specific risk the audit asked me to check ("persona/beta gates must FAIL CLOSED when /beta/status is unreachable"). The **persona** half is correct; the **beta** half is not.

**Evidence — the correct reference implementation:**
- `frontend-v2/src/contexts/RuntimeConfigContext.tsx:24-28` — shared provider's defaults: `{ fleetCarrierPersonaEnabled: false, betaMode: false, loaded: false }`, i.e. both flags documented and coded to be fail-closed/muted, with 3x retry + backoff on boot and 5 more background retries every 15s if those fail too (lines 43-71).

**Evidence — the duplicated, fail-open implementation:**
- `frontend-v2/src/pages/Login.tsx:153` — Login only destructures `fleetCarrierPersonaEnabled` from `useRuntimeConfig()`; it does **not** use the shared, already-fail-closed `betaMode`.
- `frontend-v2/src/pages/Login.tsx:166-179` — Login re-implements its own separate, non-retrying fetch of the same `/beta/status` endpoint. The comment says it outright: *"Fail-open to the normal login if /beta/status is unreachable."* (line 170). `.catch(() => { if (active) setBetaMode(false); })` (line 176) → `betaWall = betaMode && !isBetaHost()` (line 179) → `false` on any failure → the full public sign-in form renders instead of the private-beta wall.
- `frontend-v2/src/pages/Signup.tsx:162-175` — identical duplicated pattern. Comment: *"Fail-open if the status check is unreachable"* (lines 164-165); `.catch(() => { if (active) setBetaWall(false); })` (line 172) → public signup wizard renders.
- Repo-wide `grep -rn "api.beta.status()"` finds exactly 4 call sites: the shared provider (fail-closed, correct), Login.tsx and Signup.tsx (both fail-open, both duplicated), and `pages/admin/AdminSettings.tsx:76` (read-only "Integration States" diagnostics panel for admins — not a gate, low concern, out of scope here).

**Impact:** Per `frontend-v2/src/lib/host.ts`'s own header comment, while `BETA_MODE` is on, the apex domain (`loadleadapp.com`) is supposed to show **only** the private-beta wall — no public sign-in/signup — with `beta.loadleadapp.com` as the real entry point for admitted testers. Because Login/Signup's local fetch has **zero retries** (unlike the shared provider's 3+5), a single dropped request, slow response, or transient backend hiccup on `/beta/status` is enough to silently drop the wall and expose the full public login/signup form on the apex domain — precisely the kind of infrastructure instability that should invite more caution, not less. This directly contradicts the fail-closed posture the team already built and documented one file away for the sibling `fleetCarrierPersonaEnabled` gate.

**COA:** Make Login.tsx/Signup.tsx consume `betaMode`/`loaded` from the shared `useRuntimeConfig()` context (already fetched once, already fail-closed, already retried) instead of re-fetching independently. If a page-local fetch must remain for some reason, invert the failure branch to fail closed (show the wall) and reuse the same retry/backoff helper.

---

### FE-3 — Settings "Verification" tab is a non-functional client-only mock, disconnected from the real Didit IDV flow (HIGH)

**Evidence:**
- `frontend-v2/src/pages/settings/SettingsPage.tsx:149-276` — the `IDVerification` component. Zero `api.*` calls anywhere in the component (verified with `sed -n '149,389p' ... | grep "api\."` → no matches, covering both components below). Status is seeded from and written to `localStorage` only: `localStorage.getItem(key)` (line 152), `localStorage.setItem(key, "PENDING")` (line 167) on "submit". The uploaded ID (`idFile`, line 155) and selfie (`selfieFile`, line 156) are captured as `File` objects in React state (inputs at lines 233-238, 254-259) and then never referenced again — no upload, no FormData, no network call.
- `frontend-v2/src/pages/settings/SettingsPage.tsx:280-388` — the `BusinessVerification` component, same pattern: `submit()` (lines 308-320) validates required fields then only does `localStorage.setItem(key, "PENDING")` (line 317); the uploaded business document (`file` state) is never transmitted.
- Wired into three real, live persona settings pages: `DriverSettings` (lines 757, 761), `ShipperSettings` (lines 938, 946), `ReceiverSettings` (lines 1071, 1079). The sidebar tab badge itself reads the fake status directly in JSX: `localStorage.getItem(\`ll_id_verif_${userId}\`) === "APPROVED"` at lines 570, 869, and 1033 (three near-identical copies), rendering a green checkmark vs. an amber "2 steps" pill.
- Contrast with the **real** implementation: `frontend-v2/src/pages/driver/DriverVerification.tsx` (routed at `/driver/verification/idv`, `frontend-v2/src/App.tsx:45,120`) genuinely calls the backend — `api.getDriverIdv()` / `api.submitDriverIdv()` (lines 59, 71), links out to a Didit-hosted session (`identity.diditIdvUrl`, line 154), and derives status from the server (`identity?.verificationStatus`, line 86).

**Impact:** Drivers, shippers, and receivers can complete a fully convincing 2-step "Upload ID → Selfie → Review" flow (or the business-verification form) inside Settings, get a "your ID is under review" message, and — since the flag is a plain client-side string — even a spontaneous "ID Verified ✓" checkmark, while **nothing is ever sent to the backend**: no document is stored, no compliance record is created, no reviewer ever sees it. For drivers, this fake tab coexists with and can visibly contradict the real Didit-backed gate at `/driver/verification/idv` (two disconnected "verification status" surfaces for the same user). The status is also trivially forgeable from the browser console: `localStorage.setItem('ll_id_verif_<userId>', 'APPROVED')`. I found no other file that reads these keys (`grep -rn "ll_id_verif\|ll_biz_verif"` is 100% contained inside `SettingsPage.tsx`), so this does not currently cascade into any other gate/permission — the damage is confined to a misleading, silently-dead UI, not a broader authorization bypass.

**COA:** Either wire `IDVerification`/`BusinessVerification` to real backend endpoints (mirroring `DriverVerification.tsx`'s pattern), or remove the tab / replace it with a link into the real IDV flow (and its backend-equivalent for shipper/receiver business verification, if one exists) until it's actually implemented. At minimum, stop persisting a fake "APPROVED" state that the UI presents as authoritative.

---

### FE-4 — `manualChunks`: the React/radix crash risk is verified absent, but the shepherd "tour-vendor" chunk is eager-loaded on every page despite being coded for lazy-only use (MEDIUM)

**The specific ask — confirmed safe:** `frontend-v2/vite.config.ts:37-55` keeps React, react-dom, react-router-dom, and all of radix in one `"vendor"` chunk. The comment (lines 37-46) documents the prior incident precisely (a separate `react-vendor` chunk created a circular/unordered chunk dependency → React's named exports undefined when radix evaluated → `Cannot read properties of undefined (reading 'forwardRef')` → blank page) and the fix matches what's in the file today. Only `shepherd` → `"tour-vendor"` and `recharts`/`d3-` → `"charts-vendor"` are split out (lines 51-52), justified as "Lazy-route-only heavy libs: loaded via dynamic import after React is already up" (lines 48-50). **I found no re-introduction of the React-separation bug.**

**But the "lazy-route-only" premise for `tour-vendor` doesn't hold in practice:**
- `frontend-v2/src/layouts/AppLayout.tsx:38` — `import { TourMount, TourReplayButton } from "@/tour/LoadLeadTour";` is a **static** import (not `lazy()`).
- `frontend-v2/src/App.tsx:13` — `import AppLayout from "./layouts/AppLayout.tsx";` is also **static** (unlike every persona dashboard listed right below it, lines 18-48, all correctly wrapped in `lazy(() => import(...))`).
- Confirmed in the actual build output: `frontend-v2/dist/index.html:35` — `<link rel="modulepreload" crossorigin href="/assets/tour-vendor-Clia7UrK.js">`, plus a render-blocking `<link rel="stylesheet" href="/assets/tour-vendor-TRZluGMH.css">` (line 36) — both present in the single shared `index.html` served for every route, including the public `/`, `/login`, `/signup` pages.
- `frontend-v2/dist/assets/index-*.js` (the main entry chunk) contains a **static** top-level `import ... from "./tour-vendor-*.js"` (confirmed via `grep -o` on the built file), not a dynamic `import()`.

**Impact:** No crash risk — shepherd.js is framework-agnostic and doesn't consume React's exports at module-eval time, so there's no circular-chunk-init hazard like the original incident. This is a bundle-hygiene/performance regression against the code's own documented intent: every visitor — including anonymous ones who never sign in or trigger the tour — downloads and parses ~14.8 KB gzip of JS (42 KB raw) + 3.36 KB CSS that was meant to be deferred until "after React is already up." It partly undermines the adjacent D6 code-splitting goal stated in `App.tsx:15-17`.

**COA:** Wrap the `LoadLeadTour` import (or `AppLayout` itself) in `React.lazy()` + `Suspense` so the `tour-vendor` chunk is fetched only once an authenticated route actually mounts.

---

### FE-5 — Build warning: `PrivateBetaLanding.tsx` dual static+dynamic import defeats its own code-splitting (LOW)

**Evidence:** `build-output.txt:10` — `(!) .../PrivateBetaLanding.tsx is dynamically imported by .../App.tsx but also statically imported by .../Login.tsx, .../Signup.tsx, dynamic import will not move module into another chunk.` Confirmed: `App.tsx:18` wraps the standalone `/private-beta` route in `lazy()`, while `Login.tsx:12` and `Signup.tsx:14` both statically `import PrivateBetaLanding from "@/pages/PrivateBetaLanding"` and render it inline as a conditional fallback (`Login.tsx:243`, `Signup.tsx:342`).

**Impact:** Cosmetic only. The module is always in the eager bundle anyway (pulled in through Login/Signup), so the `lazy()`/`Suspense` machinery for the `/private-beta` route buys nothing.

**COA:** Drop the `lazy()` wrapper for that one route, or accept the warning as expected/harmless.

---

### FE-6 — Playwright config writes live results into a tracked, date-stamped "overnight" archive folder via a hardcoded personal path (LOW)

**Evidence:** `frontend-v2/playwright.config.ts:9` — `const REPORTS = "/Users/ayodejiejidiran/loadlead-fullstack/docs/overnight-2026-07-03/e2e";` (an absolute, single-machine path), wired into the html/json reporters at lines 21-24. Running the E2E suite for this audit (task step 4) left, per `git status --porcelain`:
```
 M docs/overnight-2026-07-03/e2e/playwright-report/index.html
 M docs/overnight-2026-07-03/e2e/results.json
```
Both files are tracked (not gitignored) — contrast with `frontend-v2/.gitignore:5`, which does ignore `test-results/`.

**Impact:** Two issues bundled together: (1) *Portability* — this absolute path only exists on this one developer's machine; on CI or any other contributor's checkout, Playwright's reporters would try to create `/Users/ayodejiejidiran/...`, which doesn't resolve, so E2E as configured can only really run here. (2) *Repo hygiene* — every local run (including this audit) silently rewrites two committed files that read as a frozen "2026-07-03 overnight" snapshot with the current day's results, inviting confusing history/blame and accidental noisy diffs. I left the two modified files as-is (did not revert or commit) — the user should decide whether to `git checkout -- docs/overnight-2026-07-03/e2e/` or intentionally commit the refreshed results.

**COA:** Point `REPORTS` at a relative, gitignored output directory (e.g. `frontend-v2/playwright-report/`, added to `.gitignore` next to `test-results/`), and leave `docs/overnight-2026-07-03/` as a frozen historical artifact.

---

## Checklist items verified with no defect found (stated for completeness, per the task's explicit checklist)

- **RuntimeConfigProvider fail-safe (persona)** — `frontend-v2/src/contexts/RuntimeConfigContext.tsx` correctly fails closed for `fleetCarrierPersonaEnabled`: muted-by-default, 3x retry with backoff on boot, `loaded` flips true even on failure (so gates don't hang), then 5 more background retries every 15s to self-heal without a refresh. This matches the fix noted for a prior "audit v4 M8" finding. Good implementation — see FE-2 for why the sibling `betaMode` gate does *not* share this same discipline once it leaves this file.
- **CanopyConnectCard gating** — `frontend-v2/src/components/CanopyConnectCard.tsx:149-151` — `if (!session?.connectEnabled) return null;` — renders nothing unless the session fetch both succeeds and reports `connectEnabled`. Fails closed correctly: if `api.canopyConnectSession()` rejects (line 72, `.catch(() => undefined)`), `session` stays `null`, `session?.connectEnabled` is `undefined`/falsy, component renders `null`. No defect found.
- **Role-based routing guards** — `frontend-v2/src/contexts/AuthContext.tsx` sources `user`/`user.role` exclusively from `GET /api/auth/me`, gated by an httpOnly cookie the JS layer never reads/writes (comment at lines 6-9 explicitly disclaims localStorage for auth). `App.tsx`'s `RequireAuth`/`RequireRole` (lines 52-74) and `admin-main.tsx`'s `RequireAuth`/`RequireAdmin` (lines 34-49) are consistent with this. `admin-main.tsx:44-49` explicitly documents the right mental model: *"The server still 403s every /api/admin/* call, so this is convenience, not security."* No client-only-trust anti-pattern found in the FE routing code itself (backend enforcement is outside this dimension's scope to verify directly).

## Not in this report

`frontend-v2/_html2pdf.mjs` (untracked, timestamped just before this session) appears unrelated to this audit dimension — left untouched, not investigated further.
