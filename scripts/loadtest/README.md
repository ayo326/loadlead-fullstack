# Load testing (audit v4 COA-3B)

Staging only. Never point this at prod.

## Pre-beta bar
p95 < 800 ms on reads, < 1% errors, zero `[scan-fallback]` lines in the EB
log, zero DynamoDB throttle alarms - at **10x expected beta volume**.

## Runs
```bash
brew install k6                                      # once
k6 run scripts/loadtest/k6-staging.js                # smoke (5 VUs, 1m)
k6 run -e TARGET_VUS=50 -e DURATION=5m scripts/loadtest/k6-staging.js   # pre-beta
```
Authed scenario (exercises the COA-3A query-first reads): mint a staging OO
token (login as a staging test account), then add `-e AUTH_TOKEN=<jwt>`.
If pushing past the auth limiter for setup, set `AUTH_RATE_LIMIT_BYPASS=1`
on the staging EB env first (refused in production by design) and remove it after.

## While it runs
- `aws logs tail` / EB log stream: grep `[scan-fallback]` (must be absent) and `[outbox]`.
- CloudWatch: the `loadlead-staging-ddb-throttles-*` and `eb-environment-degraded`
  alarms (module `monitoring`) should stay OK.
- Remember staging is a t3.micro SingleInstance - saturation at high VUs measures
  the instance, not the architecture. Scale the env up for the real 10x run.

## Deliberately excluded
- `/api/compliance/w9/render-check` - rate-limited 10/min/IP by design.
- `/api/auth/*` - 15/15min limiter; use a pre-minted token.
