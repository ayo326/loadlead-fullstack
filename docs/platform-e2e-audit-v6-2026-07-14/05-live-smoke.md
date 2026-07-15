# Platform E2E Audit v6 (2026-07-14) - Dimension 5: Live prod/staging smoke

**Method:** read-only unauthenticated curl GET/HEAD probes only. Zero state-changing requests. One POST (`/api/capacity/declare`) was rejected at auth middleware (401) before any handler or body parser ran.

## Verdict
Production is healthy and correctly hardened. No HIGH or CRITICAL findings. Router + auth gating is genuine (real 401s on mounted protected routes, 404 on unmounted path). Two INFO/LOW items: CORS hard-403 behavior on disallowed origins; staging API paused.

## Smoke summary

| Endpoint | Env | Observed | Expected | Result |
|---|---|---|---|---|
| GET /api/health | prod | 200 `productionHardened:true` | 200 + hardened | PASS |
| GET /api/capacity/me | prod | 401 | 401 | PASS |
| POST /api/capacity/declare | prod | 401 (pre-handler) | 401 | PASS |
| GET /api/driver/loadboard | prod | 401 | 401 | PASS |
| GET /api/owner-operator/dashboard | prod | 401 | 401 | PASS |
| GET /api/admin/compliance/me | prod | 401 | 401 | PASS |
| GET /api/factoring, /factoring/accounts | prod | 401 | 401 | PASS |
| GET /api/accessorials/rate-card, /loads/x/charges | prod | 401 | 401 | PASS |
| GET /api/zzz-not-a-route | prod | 404 | 404 | PASS |
| GET /api/health (bogus Origin) | prod | 403 CORS reject | record | INFO (F1) |
| GET /api/beta/status | prod | 200 `betaMode:true, cohort wave-1` | 200 | PASS |
| GET / (apex) | prod | 200 private-beta wall shell | 200 | PASS |
| GET / (beta subdomain) | prod | 200 full-app shell (same build) | 200 | PASS |
| /assets/* JS+CSS bundles | prod | 200 (4/4, correct MIME) | 200 | PASS |
| GET /login (SPA deep-link) | prod | 200 (rewrite) | 200 | PASS |
| GET /api/health | staging | 000 (origin hang) | 200 | BLOCKED - paused (F2) |
| GET / (staging web) | staging | 200 (S3/CloudFront) | 200 | PASS |

## Findings

### F1 - LOW/INFO: CORS returns hard 403 on /api/health for disallowed origins
- Evidence: `GET api.loadleadapp.com/api/health` with `Origin: https://evil-attacker.example.com` returns 403 `{"message":"CORS: origin ... not allowed","statusCode":403}`. No Origin returns 200; valid Origin returns 200 with `Access-Control-Allow-Origin: loadleadapp.com`.
- Analysis: the CORS allowlist middleware runs before the route/handler and rejects the whole request server-side, rather than the conventional pattern of serving 200 and omitting the ACAO header. The allowlist itself is correct. This is the previously-noted "bad origin handling."
- Impact: narrow. ALB/EB health checks and uptime monitors send no Origin header (unaffected, 200). Only a browser-based synthetic monitor or partner injecting an unlisted Origin would get a hard 403 on the public health endpoint.
- COA: confirm no prod synthetic monitor sends an Origin header to /api/health. Optionally exempt /api/health from the CORS allowlist, or downgrade disallowed-origin handling to header-omission instead of a 403 body.

### F2 - INFO: Staging API is PAUSED (blocks staging drift comparison)
- Evidence: `api-staging.loadleadapp.com/api/health` connects fast (connect 0.14s) then origin hangs to http 000 at timeout. Staging web `staging.loadleadapp.com` returns 200 (server AmazonS3, CloudFront RefreshHit).
- Analysis: CloudFront up, EB backend origin unresponsive - consistent with the staging start/pause toggle being paused. Static S3 frontend stays served while the API is down. Not a bug.
- Impact: staging vs prod version/hardening drift comparison could not be executed. Also, staging web returning 200 while its API is dead could mislead a tester into thinking staging is fully live.
- COA: resume staging via the start toggle before any staging-dependent smoke, then re-run `{staging}/api/health` to compare against prod.

### F3 - INFO (confirmed healthy): Beta dual-surface is a client-side split on one shared build
- Evidence: apex and beta both return byte-identical SPA shells referencing the same assets. `frontend-v2/src/lib/host.ts`: `isBetaHost()` = `hostname.startsWith("beta.")`. `Login.tsx`: `betaWall = betaMode && !isBetaHost()`, gated on live `/api/beta/status`, fails closed. Live flag: `betaMode:true, currentCohort:wave-1, tallyConnected:true, fleetCarrierPersonaEnabled:false`.
- Analysis: working as designed. Apex = private-beta wall, beta subdomain = full app, both from the same deploy; differentiation is entirely runtime/client-side. Fail-closed means a backend outage keeps the wall up (safe).
- Impact: none.

### F4 - PASS: Frontend integrity intact
All four /assets/* bundles return 200 with correct MIME types (index JS 142 KB, vendor 414 KB, index CSS 104 KB, tour-vendor 42 KB). SPA deep-link /login rewrites to 200. No blank/broken bundle.

### F5 - PASS: Router + auth gating proven genuine
404 on /api/zzz-not-a-route alongside 401s on all mounted protected routes proves the 401s are real router+authenticate gating, not a blanket catch-all. `POST /api/capacity/declare` 401 fires at auth middleware before body parsing (no state mutated).

**Safety attestation:** zero state-changing requests. Only GET/HEAD and one pre-auth POST rejected at 401 before any handler.
