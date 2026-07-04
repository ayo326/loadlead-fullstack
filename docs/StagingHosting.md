---
title: Staging Hosting (cheapest tier, pausable)
owner: Platform Engineering
status: active
---

# Staging Hosting — cheapest tier, pause to $0

Staging (`staging.loadleadapp.com` + `api-staging.loadleadapp.com`) is designed
to **rest at ~$0** and only cost money while a backend instance is actually
running.

## What it's made of

| Piece | Service | Cost |
|---|---|---|
| Subdomains | Route53 records in the existing `loadleadapp.com` zone | $0 |
| TLS certs | ACM (frontend + api) | $0 |
| Frontend | S3 (private) + CloudFront | ~$0 idle |
| **API HTTPS** | dedicated CloudFront → EB over HTTP | ~$0 idle |
| Data | 50 DynamoDB tables, on-demand | ~$0 idle |
| **Backend compute** | Elastic Beanstalk **SingleInstance, t3.micro** | **~$7.50/mo running, $0 paused** |
| NAT / ALB | *none* (public subnet + IGW; CloudFront terminates TLS) | $0 |

There is **no ALB and no NAT gateway** — those were the two standing charges,
and both are removed. HTTPS for the API is done by a CloudFront distribution
that fronts the SingleInstance EB env over plain HTTP. The EB instance SG only
accepts port 80 from CloudFront's origin-facing IP ranges.

## The pause switch

The billable EB environment is gated by the `backend_enabled` Terraform
variable, which **defaults to `false`**. So the resting state of staging is
"backend torn down, everything else idle" → **~$0**.

The EB CNAME is pinned (`loadlead-backend-staging.us-east-1.elasticbeanstalk.com`)
and the API CloudFront origin points at that fixed name — so pausing/resuming
the backend never touches the API URL. Clients just get a 502 while it's down.

```sh
cd infra/terraform

make staging-resume   # backend up  (~$0.01/hr, live in ~3-4 min)
make staging-status   # UP or PAUSED
make staging-pause    # backend down → ~$0
```

`staging-resume`/`staging-pause` are just `terraform apply -var backend_enabled=<bool>`.
IAM roles, the instance profile, network, tables, and both CloudFront
distributions persist across a pause (all free), so resume only has to recreate
the EB env.

## Typical flow (verify, then park)

1. `make staging-resume` — bring the backend up.
2. Deploy the app to it (GitHub Actions `deploy-backend` on `main`, or the deploy
   script targeting `loadlead-backend-staging`).
3. Smoke: `curl https://api-staging.loadleadapp.com/api/health`.
4. Run whatever you needed staging for (e.g. the rec #4 admin-MFA smoke).
5. `make staging-pause` — back to ~$0.

## Frontend build note

The frontend must be built with its API base pointing at
`https://api-staging.loadleadapp.com` (the Vite env, e.g. `VITE_API_BASE_URL`)
for the staging bundle. Same-origin is not required — the API CloudFront sends
permissive CORS via the app's `FRONTEND_URL=https://staging.loadleadapp.com`
setting.

## Promotion flow — staging first, always

Everything ships to **staging before prod**:

- A push/merge to `main` **auto-deploys the backend to staging** (`deploy-backend.yml` → `deploy-staging`), and staging frontend is redeployed via `scripts/deploy-staging-frontend.sh`.
- **Prod is a separate, gated step**: the `deploy-prod` job runs only on manual `workflow_dispatch` and is bound to the `production` GitHub Environment (required reviewers). It never fires automatically.
- So the path is: change → `main` → **staging** (validate here) → manually dispatch → **prod**.

## Beta gate: prod-only

The private-beta wall (`BETA_MODE`) is **on in prod** (the flag defaults to on when
unset) and **off in staging** (`BETA_MODE=off` in this env's `env_vars`). Staging is
the full app with no beta wall, so we can exercise every flow end-to-end before it
reaches the gated prod surface. Do not turn `BETA_MODE` on in staging.

## Cost guardrails

- Default state = paused = ~$0. You have to opt *in* to spend.
- Running 24/7 ≈ $7.50/mo (t3.micro). If you ever leave it up, consider a
  scheduled `staging-pause` (e.g. nightly cron) to cut that ~75%.
- Nothing here provisions a NAT gateway or ALB — the two line items that used to
  dominate the estimate.
