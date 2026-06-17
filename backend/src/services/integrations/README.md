# services/integrations — external call adapters

Every external network call LoadLead's backend makes — Didit (KYC/KYB/AML),
FMCSA QCMobile, Google Maps, Resend (email), Web Push — goes through exactly
one adapter module in this directory. Nothing outside this directory reads
`DIDIT_API_KEY`, `FMCSA_WEBKEY`, `GOOGLE_MAPS_API_KEY`, `RESEND_API_KEY`, or
the VAPID keys directly, and nothing outside this directory calls `fetch()`
against those providers or `webpush.sendNotification()`.

## Why

So that "what mode is X in" has exactly one answer, and so production can be
hard-locked to live-only without trusting every call site to remember to
check.

## The modules

| File | Wraps | Modes |
|---|---|---|
| `modeResolver.ts` | — | The single `resolveMode(integration)` function every adapter and guard calls. **Read this first.** |
| `bootGuard.ts` | — | Fail-closed boot-time checks + the production self-check. |
| `captureStore.ts` | — | In-memory store backing `GET /_test/outbox` (non-production only route). |
| `didit.ts` | KYC/KYB/AML | `live` \| `sandbox` — no logic branch; sandbox just means this environment's `DIDIT_*` credentials point at Didit's sandbox app. |
| `fmcsa.ts` | Carrier authority lookup | `live` \| `stub` — stub returns canned QCMobile-shaped responses for seeded test MC/DOT numbers (`stubs/fmcsaStub.ts`). |
| `maps.ts` | Geocoding / distance matrix | `live` \| `stub` — stub returns canned, deterministic shapes (`stubs/mapsStub.ts`). |
| `email.ts` | Resend | `live` \| `test` — test mode rewrites every recipient to a safe `@resend.dev` address (labeled per original recipient) and records the attempt to the capture store. Still makes a real Resend call, to the safe address, using a separate staging key. |
| `push.ts` | Web Push | `live` \| `capture` — capture mode never calls `webpush.sendNotification()` at all; it just records to the capture store. |

`stubs/` and the non-production route in `routes/_test/` are **not** part of
the production artifact — see "Physical exclusion" below.

## Mode resolution — `resolveMode(integration)`

```ts
import { resolveMode } from './modeResolver';
resolveMode('didit'); // 'live' | 'sandbox'
```

- **In production** (`APP_ENV=production`): always returns the live value,
  for every integration, full stop. The mode env var
  (`DIDIT_ENV`/`FMCSA_MODE`/`MAPS_MODE`/`EMAIL_MODE`/`PUSH_MODE`) is not
  consulted by `resolveMode()` in production at all.
- **Outside production**: the env var's value, or a safe default if unset
  (`sandbox` for Didit, `stub` for FMCSA/Maps, `test` for Email, `capture`
  for Push).

`APP_ENV`, not `NODE_ENV`, is what every check here keys off. EB/npm tooling
often forces `NODE_ENV=production` for every environment (dev/staging
included) as a build flag — `APP_ENV` is the deliberate, explicit signal for
"this is really production."

## The boot guard — fail-closed, no warnings

Three checks run before the HTTP server starts listening (`index.ts`):

1. **`assertProductionNotContaminated()`** — if `APP_ENV=production` and
   *any* of the five mode env vars is set to a non-live value, **refuse to
   boot**, naming the variable. Presence alone is disqualifying — production
   never reads these env vars for behavior, but their presence signals this
   environment's config leaked from (or was copied out of) a non-production
   environment, which may also carry sandbox secrets.
2. **`assertNonProductionSafe()`** — outside production, if Didit, Email, or
   Push ever resolve to `live`, **refuse to boot**. These three can touch a
   real identity, a real inbox, or a real device — there is no "warn and
   continue" for them. FMCSA/Maps `live` outside production is allowed (e.g.
   a deliberate staging smoke test against the real FMCSA registry) but logs
   a loud warning every boot.
3. **`assertProductionHardened(app)`** — runs after all routes (including
   the conditionally-mounted test route) are assembled, right before
   `listen()`. Independently re-verifies: every integration resolves live,
   and no `/_test*` route is registered on the live app instance. This is
   the belt for the suspenders in (1)/(2) and the guarded-import pattern
   below — not a duplicate of the same check.

Any failure prints a clear `[BOOT REFUSED]` message and calls
`process.exit(1)`. There is no environment where this is downgraded to a
warning.

## Physical exclusion from production

`services/integrations/stubs/**` and `routes/_test/**` are reachable **only**
via a guarded dynamic import:

```ts
if (config.appEnv !== 'production') {
  const path = './stubs/' + 'fmcsa' + 'Stub'; // built from parts — see below
  const stub = await import(path);
}
```

Two independent layers enforce this:

- **Logically**: `resolveMode()` always returns `live` in production, so the
  `if (mode !== 'live')` branch that imports a stub is structurally
  unreachable there.
- **Physically**: `deploy-backend.sh` deletes `dist/services/integrations/stubs/`
  and `dist/routes/_test/` from the compiled output before zipping a
  production deploy, and then greps the result for forbidden markers
  (stub/test paths and identifiers) before it will upload to S3/EB. If a
  static `import` of either directory ever existed in a file that ships to
  production, deleting the directory would crash that file at module-load
  time — that's exactly why every reference to them uses a *dynamic* import
  built from string fragments (e.g. `'./stubs/' + 'fmcsa' + 'Stub'` instead
  of `'./stubs/fmcsaStub'`), so the literal name never appears as one
  contiguous string in a file the scanner has to pass. **Don't "simplify"
  these into a single string literal** — see the comments at each call site.

## Where real secrets live

Never in this repo. `.env.staging` (committed) is placeholders only. Real
sandbox/staging values are set in EB Console → Configuration → Environment
properties for that environment, or in CI secrets for the deploy pipeline —
never in `.env`, never in a commit.

## Adding a new integration

1. Add it to `IntegrationName`, `MODE_ENV_VAR`, `LIVE_MODE`,
   `DEFAULT_NONPROD_MODE` in `modeResolver.ts`.
2. Decide: can a non-live mode of this integration touch a real person, real
   money, or real data outside production? If yes, add it to
   `NEVER_LIVE_OUTSIDE_PROD` in `bootGuard.ts`. If it's read-only/no-PII
   (like FMCSA/Maps), add it to `WARN_IF_LIVE_OUTSIDE_PROD` instead.
3. Write the adapter in this directory. If it needs a stub, put the stub
   under `stubs/` and reference it only via a dynamic import built from
   string fragments, exactly like `fmcsa.ts`/`maps.ts`.
4. Update `.env.staging` with the new mode var and any placeholder secrets.
5. Update `deploy-backend.sh`'s forbidden-marker list if the new stub
   introduces a new module name or literal string that must never ship.
