# LoadLead Platform E2E Audit v5 — Dimension 05: Live Black-Box Smoke (PROD + STAGING)

Date: 2026-07-12 (checks run ~04:46–04:51 UTC)
Method: `curl -s -m 10 -w "\n%{http_code}\n"` against live deployed endpoints. No mocked data — all output below is real curl output captured during this session.

Endpoints:
- PROD API: https://api.loadleadapp.com | PROD FE: https://loadleadapp.com
- STAGING API: https://api-staging.loadleadapp.com | STAGING FE: https://staging.loadleadapp.com

Staging status: was already warm/responding 200 on the first health poll attempt (no cold-start wait needed).

---

## Per-endpoint results table

| # | Env | Method | Path | Status | Expected | Pass/Fail |
|---|-----|--------|------|--------|----------|-----------|
| 1 | PROD | GET | /api/health | 200 `{"ok":true,...,"productionHardened":true}` | 200 ok:true | PASS |
| 1 | STAGING | GET | /api/health | 200 `{"ok":true,...}` | 200 ok:true | PASS |
| 2 | PROD | GET | /api/owner-operator/dashboard (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | PROD | GET | /api/admin/compliance/me (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | PROD | GET | /api/admin/users (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | PROD | GET | /api/shipper/dashboard (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | PROD | GET | /api/compliance/documents (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | PROD | GET | /api/owner-operator/dashboard (garbage Bearer token) | 401 `{"error":"Invalid token"}` | 401 | PASS |
| 2 | PROD | GET | /api/admin/compliance/me (garbage Bearer token) | 401 `{"error":"Invalid token"}` | 401 | PASS |
| 2 | STAGING | GET | /api/owner-operator/dashboard (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | STAGING | GET | /api/admin/compliance/me (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | STAGING | GET | /api/admin/users (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | STAGING | GET | /api/shipper/dashboard (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | STAGING | GET | /api/compliance/documents (unauth) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 2 | STAGING | GET | /api/owner-operator/dashboard (garbage Bearer token) | 401 `{"error":"Invalid token"}` | 401 | PASS |
| 3 | PROD | GET | /api/beta/status | 200 `betaMode:true, fleetCarrierPersonaEnabled:false` | persona false, wall on | PASS |
| 3 | STAGING | GET | /api/beta/status | 200 `betaMode:false, fleetCarrierPersonaEnabled:true` | persona true, wall off | PASS |
| 3 | PROD | POST | /api/auth/signup/carrier (empty body) | 403 `{"code":"PERSONA_DISABLED"}` | 403 PERSONA_DISABLED | PASS |
| 3 | STAGING | POST | /api/auth/signup/carrier (empty body) | 400 field-validation errors (email/password/legalName) | 400 validation | PASS |
| 4 | PROD | GET | /api/compliance/canopy/status (unauth, **correct path**) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 4 | PROD | GET | /api/compliance/canopy/connect-session (unauth, **correct path**) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 4 | PROD | POST | /api/webhooks/canopy (bad signature) | 404 Not Found | disabled on prod | PASS-ish, anomaly noted — see LS-3 |
| 4 | STAGING | GET | /api/compliance/canopy/status (unauth, **correct path**) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 4 | STAGING | GET | /api/compliance/canopy/connect-session (unauth, **correct path**) | 401 `{"error":"No token provided"}` | 401 | PASS |
| 4 | STAGING | POST | /api/webhooks/canopy (bad signature) | 401 `{"error":"malformed_signature_header"}` | 401 signature_mismatch | PASS (401 confirmed; exact error code differs — see notes) |
| 5 | PROD | GET | /api/health (security headers) | HSTS, X-Content-Type-Options, CSP, X-Frame-Options, no wildcard CORS all present | present | PASS |
| 5 | STAGING | GET | /api/health (security headers) | Same header set present | present | PASS |
| 5 | PROD | GET | /api/owner-operator/dashboard, Origin: allowlisted (loadleadapp.com) | 401, `Access-Control-Allow-Origin: https://loadleadapp.com` (reflected, not `*`) | non-wildcard CORS | PASS |
| 5 | PROD | OPTIONS | /api/beta/status, Origin: allowlisted | 204, correct ACAO/ACAM headers | 204 preflight ok | PASS |
| 5 | PROD | GET/OPTIONS | any route, Origin: disallowed (evil.example.com) | **500 Internal Server Error** | should ignore/reject gracefully (no ACAO, normal or 4xx response) | **FAIL — see LS-1** |
| 5 | STAGING | GET/OPTIONS | any route, Origin: disallowed (evil.example.com) | **500 Internal Server Error** | should ignore/reject gracefully | **FAIL — see LS-1** |
| 6 | PROD | GET | / (FE) | 200, HTML shell, refs `assets/index-BChsy2fk.js`, `vendor-x8phs9wn.js`, `tour-vendor-Clia7UrK.js`; CSP/HSTS/X-Frame-Options/X-Content-Type-Options present | 200 + bundle refs | PASS |
| 6 | STAGING | GET | / (FE) | 200, HTML shell, refs `assets/index-CSpQMgsn.js`, `vendor-DHJO9Y8z.js`, `tour-vendor-Clia7UrK.js`; **no CSP/HSTS/X-Frame-Options/X-Content-Type-Options/Referrer-Policy at all** | 200 + bundle refs + headers | **FAIL (headers) — see LS-2** |
| — | PROD | GET | http://api.loadleadapp.com/api/health (plaintext) | 301 → https | 301 redirect | PASS |
| — | PROD | GET | http://loadleadapp.com/ (plaintext) | 301 → https | 301 redirect | PASS |
| — | STAGING | GET | http://api-staging.loadleadapp.com/api/health (plaintext) | 301 → https | 301 redirect | PASS |
| — | STAGING | GET | http://staging.loadleadapp.com/ (plaintext) | 301 → https | 301 redirect | PASS |

---

## Findings

### LS-1 — CORS origin-check throws unhandled 500 on every route, both environments
**Severity: HIGH**

**Evidence** (prod, health endpoint — the simplest possible route — with a non-allowlisted `Origin`):
```
$ curl -sv -m 10 -H "Origin: https://evil.example.com" https://api.loadleadapp.com/api/health
> GET /api/health HTTP/1.1
> Host: api.loadleadapp.com
> Origin: https://evil.example.com
<
< HTTP/1.1 500 Internal Server Error
< Content-Type: application/json; charset=utf-8
...
{"message":"Internal Server Error","statusCode":500}
```

Control (same route, no Origin header): `{"ok":true,...}` / `200`.
Control (same route, allowlisted Origin `https://loadleadapp.com`): `200` with correct `Access-Control-Allow-Origin: https://loadleadapp.com` reflected.

Reproduced across:
- GET `/api/health` (public, unauthenticated route) → 500
- GET `/api/owner-operator/dashboard` (protected route) → 500 (**instead of the expected 401** — the CORS check throws before the auth guard middleware ever runs)
- OPTIONS preflight on `/api/beta/status` → 500 (instead of a clean CORS rejection, e.g. 204 without ACAO, or 403)
- POST `/api/auth/signup/carrier` → 500 (instead of the expected 403 PERSONA_DISABLED)
- Identical behavior on **both** api.loadleadapp.com and api-staging.loadleadapp.com

```
$ curl -s -m 10 -w "\n%{http_code}\n" -H "Origin: https://evil.example.com" https://api.loadleadapp.com/api/owner-operator/dashboard
{"message":"Internal Server Error","statusCode":500}
500

$ curl -s -m 10 -w "\n%{http_code}\n" -X OPTIONS -H "Origin: https://evil.example.com" -H "Access-Control-Request-Method: GET" https://api.loadleadapp.com/api/beta/status
{"message":"Internal Server Error","statusCode":500}
500

$ curl -s -m 10 -w "\n%{http_code}\n" -X POST -H "Content-Type: application/json" -H "Origin: https://evil.example.com" -d '{}' https://api.loadleadapp.com/api/auth/signup/carrier
{"message":"Internal Server Error","statusCode":500}
500

$ curl -s -m 10 -D - -o /dev/null -X OPTIONS -H "Origin: https://evil.example.com" -H "Access-Control-Request-Method: GET" https://api-staging.loadleadapp.com/api/beta/status
HTTP/2 500
```

**Isolation check** — confirmed the bug is specific to the *disallowed*-origin code path, not preflight handling in general: an OPTIONS preflight on the same protected route with an *allowlisted* Origin works perfectly on both environments (204, correct `Access-Control-Allow-Origin`/`Access-Control-Allow-Headers`/`Access-Control-Allow-Methods`, `Access-Control-Allow-Credentials: true`):
```
$ curl -s -m 10 -D - -o /dev/null -X OPTIONS -H "Origin: https://loadleadapp.com" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization" https://api.loadleadapp.com/api/owner-operator/dashboard
HTTP/1.1 204 No Content
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: authorization
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Origin: https://loadleadapp.com

$ curl -s -m 10 -D - -o /dev/null -X OPTIONS -H "Origin: https://staging.loadleadapp.com" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization" https://api-staging.loadleadapp.com/api/owner-operator/dashboard
HTTP/2 204
access-control-allow-origin: https://staging.loadleadapp.com
access-control-allow-credentials: true
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
```
So the allowlist-match branch is entirely healthy on both environments; the bug is narrowly the reject/no-match branch of the same origin-check function.

**Confirmed root cause** (repo-side investigation, `/Users/ayodejiejidiran/loadlead-fullstack`, read-only — file/line citations below):

`backend/src/index.ts:153-165` — the only `cors()` call in the backend:
```ts
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);              // curl/Postman/server-to-server: allowed
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));   // <-- plain Error, no .statusCode
  },
  credentials: true,
}));
```
This runs before every route (including preflight `OPTIONS`, which goes through the same origin callback). Express correctly propagates the `Error` to `errorHandler` at `index.ts:355` — middleware order is fine, nothing is silently swallowed.

The actual defect is in `backend/src/middleware/errorHandler.ts:34-64`:
```ts
const statusCode = Number(err?.statusCode || err?.status || 500);   // line 41 — plain Error has neither, defaults to 500
const message = err?.message || 'Internal Server Error';             // line 42
...
const exposeStack = process.env.EXPOSE_ERROR_STACK === 'true';
const safeMessage = statusCode >= 500 && !exposeStack ? 'Internal Server Error' : message;  // line 53
```
Because `callback(new Error(...))` creates a bare `Error` with no `.statusCode`, it defaults to 500, and the ≥500 branch masks the real message down to the literal string `"Internal Server Error"` — exactly reproducing `{"message":"Internal Server Error","statusCode":500}` observed live on both environments.

**Why now, and why both environments identically:** `git log` shows the CORS `callback(new Error(...))` pattern is unchanged since the very first backend commit (`c8918be`, 2026-06-12). The message-masking in `errorHandler.ts` was added later, deliberately, by `4a4ed3e` — *"SCRUM-56: harden(security): app-owned security headers + no error disclosure (DAST cleanup)"* (2026-06-30) — to stop leaking internal error text to a DAST scanner. That hardening pass wasn't written with CORS rejections in mind, but a rejected-origin error is 5xx-shaped by accident (no `.statusCode` set), so it got swept into the same masking. Net effect: **a disallowed Origin header is now treated identically to a genuine unhandled server fault** instead of a controlled 403. This is unconditional, environment-independent code, which is why it reproduces identically on prod and staging.

**Impact:**
- Any client that sends a non-allowlisted `Origin` header — third-party scanners/uptime bots, browser extensions, another site's stray `fetch()`, a developer pointed at prod from `localhost`, or an automated security scanner (which this audit itself is a proxy for) — turns every single request into a 500, on **every route including the liveness probe** `/api/health`. This is explicitly called out as HIGH in the audit rubric ("500 on core route"); here it's *all* routes, not just one.
- Not a data-exposure or auth-bypass issue by itself (response body is generic, no stack trace since `EXPOSE_ERROR_STACK` is off in these environments, still fails closed on protected routes — no data leaks through). But it: (a) makes `/api/health` an unreliable liveness signal for any monitor that varies its Origin header or runs from a browser context, (b) pollutes error-rate dashboards/alerting with 500s trivially triggerable by anyone rotating an Origin header, and (c) means the CORS layer — not the auth layer — is the first thing a cross-origin probe hits on a protected route (today it fails closed; that's incidental to how the shared error handler happens to default, not a deliberate design).
- Confirmed identical on both prod and staging — one shared-codebase bug, not an environment misconfiguration; fixing it once fixes both.

**COA:**
1. In `backend/src/index.ts:159`, replace `callback(new Error(...))` with either `callback(null, false)` (cors then omits `Access-Control-Allow-Origin` and calls `next()` with no error — request proceeds server-side, browser enforces the block client-side) — or throw a proper `AppError('CORS origin not allowed', 403)` (the `AppError` class already exists at `backend/src/middleware/errorHandler.ts:9` and is exactly what carries a `.statusCode` through to line 41 correctly).
2. Add a regression test: request any route with a non-allowlisted `Origin` header and assert the response is NOT 500.
3. Re-run this exact curl against both environments after the fix to confirm `/api/health` returns 200 (or a clean 403) regardless of Origin header value.
4. Since prod's `ALLOWED_ORIGINS` is managed out-of-band (see LS-3 note on Terraform `ignore_changes`), this fix ships via the normal backend deploy pipeline, not a config change — no infra ticket needed, just the code fix.

---

### LS-2 — Staging frontend serves zero security headers (prod FE has full set)
**Severity: MEDIUM**

**Evidence:**
```
$ curl -s -m 10 -I https://loadleadapp.com/          # PROD FE
HTTP/2 200
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
x-permitted-cross-domain-policies: none
x-xss-protection: 0

$ curl -s -m 10 -I https://staging.loadleadapp.com/  # STAGING FE
HTTP/2 200
content-type: text/html
content-length: 2296
last-modified: Sun, 12 Jul 2026 04:32:24 GMT
x-amz-server-side-encryption: AES256
x-amz-version-id: U6VGg6kUGuPHRHz9t7nzVZxOH0cdrxnv
accept-ranges: bytes
server: AmazonS3
...
x-cache: RefreshHit from cloudfront
via: 1.1 a4bc94cc88031e1df6397417521ad3ae.cloudfront.net (CloudFront)
# (no content-security-policy / strict-transport-security / x-frame-options / x-content-type-options / referrer-policy at all)

$ curl -s -m 10 -D - -o /dev/null https://staging.loadleadapp.com/ | grep -iE "content-security-policy|strict-transport|x-frame-options|x-content-type-options"
NONE OF THESE HEADERS FOUND
```
Both FEs are otherwise identically served (same S3+CloudFront pattern, same 2296-byte shell, same `content-length`), which rules out "different app" — this is a CloudFront distribution/response-headers-policy gap on staging only.

**Impact:** the staging frontend has no clickjacking protection (no `X-Frame-Options`/frame-ancestors), no HSTS (downgrade-to-HTTP window on first visit), no `X-Content-Type-Options` (MIME-sniffing exposure), and no CSP (no defense-in-depth against injected script if any XSS vector exists). Staging is internet-reachable (not IP-allowlisted, per this audit's ability to reach it directly), carries real auth flows and now `fleetCarrierPersonaEnabled:true` (the full-app mirror), so this isn't a throwaway sandbox — it's a target.

**COA:**
1. Compare the CloudFront distribution config (or Lambda@Edge / CloudFront Function / Response Headers Policy) attached to the prod FE distribution vs. the staging FE distribution; the prod one clearly has a Response Headers Policy attached and staging does not.
2. Attach the same (or an environment-appropriate, e.g. staging-scoped `connect-src`) Response Headers Policy to the staging distribution.
3. Re-run `curl -I https://staging.loadleadapp.com/` after the fix and confirm the same six headers prod returns are present.

---

### LS-3 — Canopy GET routes correctly gated on both envs; webhook receiver present on staging but 404 on prod (informational anomaly)
**Severity: LOW (informational — fails safe, not a confirmed security defect)**

**Correction to my own initial probing:** I first guessed 9 plausible paths (`/api/canopy/session`, `/api/canopy/config`, `/api/canopy-connect/*`, etc.) — all 404 on both environments. A repo-side check of `backend/src/routes/canopy.ts` and `backend/src/index.ts` (mount points at lines 254 and 180-184) found the actual routes live under a different resource noun than guessed:

| Method | Real path | Auth |
|---|---|---|
| GET | `/api/compliance/canopy/connect-session` | `requireOwnerOperator` |
| POST | `/api/compliance/canopy/callback` | `requireOwnerOperator` |
| GET | `/api/compliance/canopy/status` | `requireOwnerOperator` |
| POST | `/api/webhooks/canopy` | none (raw-body HMAC signature check inside handler) |

Retested with the correct paths — this is the real result for check #4:
```
$ curl -s -m 10 -w "\n%{http_code}\n" https://api.loadleadapp.com/api/compliance/canopy/status
{"error":"No token provided"}
401

$ curl -s -m 10 -w "\n%{http_code}\n" https://api.loadleadapp.com/api/compliance/canopy/connect-session
{"error":"No token provided"}
401

$ curl -s -m 10 -w "\n%{http_code}\n" https://api-staging.loadleadapp.com/api/compliance/canopy/status
{"error":"No token provided"}
401

$ curl -s -m 10 -w "\n%{http_code}\n" https://api-staging.loadleadapp.com/api/compliance/canopy/connect-session
{"error":"No token provided"}
401
```
**Clean PASS** — both GET routes are live and correctly auth-gated (401, not 200, not 500) on both prod and staging. This reverses my earlier "inconclusive" read; check #4's session/config-route requirement is fully satisfied.

**The anomaly worth flagging is narrower than originally framed:** the webhook receiver behaves *differently* from the GET routes on prod specifically:
```
$ curl -s -m 10 -w "\n%{http_code}\n" -X POST -H "x-canopy-signature: bad_signature_test" -d '{"test":"data"}' https://api.loadleadapp.com/api/webhooks/canopy
{"message":"Not found","statusCode":404}      # exact shape of index.ts's app-level /api catch-all (line ~350) — request reached Express, no handler matched

$ curl -s -m 10 -w "\n%{http_code}\n" -X POST -H "x-canopy-signature: bad_signature_test" -d '{"test":"data"}' https://api-staging.loadleadapp.com/api/webhooks/canopy
{"error":"malformed_signature_header"}
401      # staging: route exists, signature check is live and rejecting bad signatures
```
The webhook 404 body on prod is exactly the app's own generic `/api` catch-all shape (`{"message":"Not found","statusCode":404}`), not an HTML error page or an infra/WAF-shaped block — meaning the request reaches the Express process and no route matches. Since `/api/compliance/canopy/status` (mounted at `index.ts:254`, same file) *does* resolve on prod, but `POST /api/webhooks/canopy` (registered at `index.ts:180-184`, also unconditional, no env/flag guard per source) does *not*, prod's currently-running process appears to be on a build where the canopy router is mounted but the standalone webhook handler isn't yet — i.e., a partial/older deploy relative to current `main`, not a deliberate feature flag (the code has no such flag for this route).

This lines up directionally with the project's documented posture — `infra/terraform/envs/prod/canopy.tf` states prod is intentionally "sandbox-first... connect-disabled (manual path only) until real Canopy production credentials exist," and prod deploys require manual `workflow_dispatch` (staging auto-deploys on every push to `main`) — so a prod backend that's a few commits behind staging on this feature is expected, not alarming. It does mean: if the external Canopy vendor were to POST a real webhook event at prod today, it would get a 404 (safe failure, no data processed) rather than being received-but-rejected for bad signature — functionally equivalent for security purposes, just worth knowing before flipping prod's Canopy connect on for real.

**COA:**
1. No security action needed — fails safe on prod (404, not 200/500), and the GET routes (which matter for the "needs auth" check) are correctly gated on both environments.
2. Before enabling Canopy Connect on prod (per the existing SCRUM-60 rollout plan already tracked in project memory as "not yet prod-deployed, sandbox-first"), confirm prod's deployed backend version includes the `index.ts:180-184` webhook registration — compare the EB `loadlead-backend-prod` deployed version/commit against `6c62d3f` or later.
3. Update this audit's canopy test paths for future rounds to `/api/compliance/canopy/status` and `/api/compliance/canopy/connect-session`, not `/api/canopy/*` — the latter will always 404 regardless of deploy state.

---

### LS-4 — staging is fully crawlable/indexable, no noindex control, while hosting the pre-release persona surface
**Severity: MEDIUM**

**Evidence:**
```
$ curl -s -m 8 https://staging.loadleadapp.com/robots.txt
User-agent: Googlebot
Allow: /
User-agent: Bingbot
Allow: /
User-agent: Twitterbot
Allow: /
User-agent: facebookexternalhit
Allow: /
User-agent: *
Allow: /
200

$ grep -i "robots" staging-fe.html
(no <meta name="robots"> tag found)

$ curl -s -m 10 -D - -o /dev/null https://staging.loadleadapp.com/ | grep -i x-robots-tag
(no X-Robots-Tag header found)
```
No robots.txt disallow, no `<meta name="robots" content="noindex">`, no `X-Robots-Tag` response header — three independent layers where staging could have been excluded from indexing, none of them present. (Prod's robots.txt is identically permissive, which is correct for prod — but the same allow-all file appears to have been deployed unchanged to staging.)

**Impact:** combined with LS-3's confirmation that staging is directly internet-reachable with no auth wall in front of it, and with `fleetCarrierPersonaEnabled:true` (dimension-3 gate check, this report) exposing the pre-release fleet-carrier persona that is deliberately muted on prod — staging is a fully crawlable, unauthenticated window onto a product surface that hasn't shipped yet. A search engine, SEO scraper, or competitive-intelligence bot has no technical barrier to indexing it. This is lower urgency than LS-1/LS-2 (no immediate exploit path, purely a discoverability/premature-disclosure risk) but is a real, easily-fixed gap.

**COA:**
1. Add `Disallow: /` to the robots.txt served at staging.loadleadapp.com (or template it per-environment so prod stays permissive and every non-prod host defaults to disallow).
2. Belt-and-suspenders: add `X-Robots-Tag: noindex, nofollow` at the CloudFront response-headers-policy level for the staging distribution (same fix location as LS-2, could be bundled into the same change).
3. Consider whether staging should be IP-allowlisted or behind a basic-auth wall at the CDN edge given it now carries the un-gated persona — that's a bigger decision than this audit's scope, but worth flagging to the team given the "beta dual-surface" pattern already in use for prod (apex private-beta wall).

---

## Summary of what passed cleanly

- Both health endpoints: 200, `ok:true`.
- All 14 unauthenticated protected-route probes (7 distinct sensitive paths × 2 environments, including the two canopy routes once retested at their correct path, plus 2 with a malformed bearer token) returned 401, never 200, never a data payload.
- The core prod-vs-staging gate behavior is correct and matches spec exactly: prod has `fleetCarrierPersonaEnabled:false` + beta wall on + carrier signup blocked with `403 PERSONA_DISABLED`; staging has persona `true` + beta off + carrier signup open to normal `400` validation.
- Canopy GET routes (`/api/compliance/canopy/status`, `/api/compliance/canopy/connect-session`) are live and correctly 401-gated on both environments. Canopy webhook signature verification is confirmed live and rejecting bad signatures on staging (401).
- CORS is not wildcard-open anywhere tested — `Access-Control-Allow-Origin` reflects only the specific allowlisted origin, never `*`, and only appears when a matching Origin is sent. Confirmed via repo-side check: staging's allowlist is Terraform-managed (`infra/terraform/envs/staging/staging.auto.tfvars:19` → `https://staging.loadleadapp.com` only); prod's is applied out-of-band (EB environment properties, `lifecycle.ignore_changes` in Terraform) and not visible in-repo, consistent with prod correctly reflecting `https://loadleadapp.com` live.
- HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy all present on both API backends, and legitimate (allowlisted-origin) preflight requests work correctly on both, including on protected routes.
- Both frontends return 200 with a proper HTML shell referencing hashed JS bundles (`assets/index-*.js`, `vendor-*.js`) — no blank page, no error page, on either environment.
- HTTP→HTTPS redirects (301) confirmed on both FE and API, both environments.
- No 5xx observed on any health check or any route under normal (no hostile-Origin) conditions.

## Net severity count
- CRITICAL: 0
- HIGH: 1 (LS-1 — CORS-triggered 500 on every route, both environments; root cause confirmed at `backend/src/index.ts:159` × `backend/src/middleware/errorHandler.ts:41-53`)
- MEDIUM: 2 (LS-2 — staging FE missing all security headers; LS-4 — staging fully crawlable/indexable with pre-release persona exposed)
- LOW: 1 (LS-3 — informational only; canopy GET routes are a confirmed PASS once tested at the correct path, webhook fails safe on prod)
