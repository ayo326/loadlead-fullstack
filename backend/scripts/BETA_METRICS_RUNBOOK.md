# Lane Liquidity (beta metrics) verification runbook

Repeatable, local-only scaffolding to prove the admin Lane Liquidity endpoint
(`GET /api/admin/liquidity`) and its dashboard panel work against real loads.

Nothing here runs against prod or staging. The seed and teardown refuse to run
unless `APP_ENV` is `development`, `dev`, `local`, or `test`, and (outside the
unit harness) refuse unless `DYNAMODB_ENDPOINT` points at a local DynamoDB.

## What the scripts do

| Script | npm command | Effect |
|--------|-------------|--------|
| `scripts/seedBetaMetrics.ts` | `npm run seed:beta-metrics` | Upserts 22 deterministic loads (fixed `SEEDLIQ-*` ids) across two lanes and four recent complete weeks, via the app's `Database` layer and the `aLoad()` test factory. Re-running is an upsert, never a duplicate. |
| `scripts/verifyBetaMetrics.ts` | `npm run test:beta-metrics` | Mints an admin JWT the same way the app does (`Helpers.generateToken`), calls the live endpoint, and asserts HTTP 200, the full payload shape and types, and that the no-show and trust-incident dials are present and read 0. |
| `scripts/teardownBetaMetrics.ts` | `npm run teardown:beta-metrics` | Deletes exactly the 22 `SEEDLIQ-*` loads by id, nothing else. |

## Prerequisites

1. DynamoDB Local running on `127.0.0.1:8000` with a `LoadLead_Loads` table.
   The repo's `backend/.env` already sets `DYNAMODB_ENDPOINT=http://127.0.0.1:8000`.
2. The backend running locally against that endpoint:
   ```
   cd backend
   APP_ENV=development npm run dev      # serves http://localhost:4000
   ```

## Verify (one pass)

```
cd backend
npm run seed:beta-metrics      # insert the deterministic loads
npm run test:beta-metrics      # assert the live endpoint (exits non-zero on any failure)
```

Expected tail:
```
beta metrics endpoint verified: 200, full shape, zero-state dials locked.
```

## See it in the running admin app

1. Start the admin frontend (Vite proxies `/api` to the backend):
   ```
   cd frontend-v2
   LL_BUILD=admin npm run dev
   ```
2. Sign in as an admin, then open the panel:
   ```
   http://localhost:5173/admin/liquidity
   ```
   You should see six gate dials (no-show and trust incident both 0), a per-lane
   fill table including `Austin to Houston` and `Austin to Dallas-Fort Worth`, and
   the two paired charts with the 65 percent and 4 hour gate reference lines.

## Tear down

```
cd backend
npm run teardown:beta-metrics
```

## Phase 2: recording no-show and trust-incident events

The no-show and trust-incident dials are backed by their own store
(`LoadLead_BetaTrustEvents`), intentionally separate from the Load model. They
read a real 0 until events are recorded. To populate them:

From the dashboard (`/admin/liquidity`): use the "Record a trust or no-show
event" card under the dials. Pick a type, enter a load id and carrier id, submit.
The matching dial updates within the 60 second cache window.

By API (admin session required):
```
# record
curl -X POST http://localhost:4000/api/admin/beta/trust-events \
  -H "Content-Type: application/json" -b "ll_token=<admin cookie>" \
  -d '{"eventType":"NO_SHOW","loadId":"<load id>","carrierId":"<carrier id>"}'

# aggregate counts the dials use
curl http://localhost:4000/api/admin/beta/trust-events/summary -b "ll_token=<admin cookie>"
```
`eventType` is `NO_SHOW` or `TRUST_INCIDENT`. Non-admins get the inherited
401/403. Recording one event moves the matching dial by one; the loads table is
never read or written.

To create the table locally: `DYNAMODB_ENDPOINT=http://127.0.0.1:8000 node scripts/createTables.mjs`.

## Notes

- `BASE_URL` overrides the endpoint the verifier targets (default
  `http://localhost:4000`).
- The endpoint caches results for 60 seconds. After re-seeding, either wait out
  the cache or restart the backend before re-verifying.
- The verifier asserts the seed's contribution with `>=`, not exact totals, so it
  is correct even when the local table holds other dev loads.
