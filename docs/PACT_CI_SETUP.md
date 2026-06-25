---
title: Pact CI Setup — PactFlow + GitHub Actions
status: runbook
companion_to: LoadLead_CrossPersona_Contract_UAT_BDD.md
---

# Pact CI setup — PactFlow + GH Actions wire-up

The cross-persona contract suite from [the spec](LoadLead_CrossPersona_Contract_UAT_BDD.md)
ran locally in earlier commits (broker on `docker-compose`, manual
publish + verify + can-i-deploy). This runbook is the one-time setup
to lift that into CI with a hosted broker.

## What CI does after this is wired up

```
push to main (frontend pact change)
  ↓
.github/workflows/frontend-pact.yml
  - npx vitest run frontend-v2/tests/contract/
  - npx pact-broker publish pact/pacts ...
  - (on main) record-deployment of each consumer to "production"
                                                            ↓
                                                       PactFlow Broker
                                                            ↓
push to main (backend route/service change)
  ↓
.github/workflows/verify-provider.yml
  - npx tsx backend/tests/contract/verify-provider.ts
  - publishVerificationResult=true so the broker records pass/fail
                                                            ↓
                                                            ↓
workflow_dispatch on .github/workflows/deploy-backend.yml
  ↓
  can-i-deploy --pacticipant loadlead-api --to-environment production
    pass → proceed to EB deploy
    fail → BLOCK, names broken consumer in CI log
  ↓
  record-deployment of provider to "production"
```

## One-time setup (your turn — I can't do this from here)

### 1. Sign up for PactFlow

- Go to https://pactflow.io and create a free account
- Name your tenant `loadlead` (free tier is fine for one team /
  ~5 contracts / 100 verifications per month — we'll fit)
- Your broker URL becomes `https://loadlead.pactflow.io`

### 2. Generate an API token

PactFlow → Settings → API Tokens. Generate:
- **Read/Write token** for the CI workflows (frontend-pact +
  verify-provider). Treat this as a secret.

(For local dev you can also generate a Read-only token; not needed
for CI.)

### 3. Set the GitHub secrets

```bash
gh secret set PACT_BROKER_BASE_URL --body "https://loadlead.pactflow.io"
gh secret set PACT_BROKER_TOKEN     --body "<your-read-write-token>"
```

Both should be **repository-level** secrets (Settings → Secrets and
variables → Actions). They're read by all three workflows.

### 4. Seed the broker

The very first time you set the secrets, the broker is empty. Manually
trigger both workflows to seed it:

```bash
gh workflow run frontend-pact.yml   --ref main
gh workflow run verify-provider.yml --ref main
```

After both succeed, the broker has 6 consumer pacts + 1 provider
verification result per pact = 6 verification results, all green.
You're in the "no missing dependencies" state for can-i-deploy.

### 5. Mark currently-deployed environments

Tell the broker that the current SHA is what's in production right now,
so future can-i-deploy queries have a reference:

```bash
SHA=$(git rev-parse --short HEAD)
for c in driver-web shipper-web carrier-web oo-web receiver-web admin-console; do
  npx pact-broker record-deployment --pacticipant "$c" \
    --version "$SHA" --environment production \
    --broker-base-url=https://loadlead.pactflow.io \
    --broker-token="$PACTFLOW_TOKEN"
done
npx pact-broker record-deployment --pacticipant loadlead-api \
  --version "$SHA" --environment production \
  --broker-base-url=https://loadlead.pactflow.io \
  --broker-token="$PACTFLOW_TOKEN"
```

(This is also automated going forward — `deploy-backend.yml` records
the provider deployment on every successful run; `frontend-pact.yml`
records the consumer deployments on every main push.)

## Reproducing the @H11 cross-persona break demo via CI

Once secrets are set, the deliberate-break demo can be run from CI
without editing source:

```bash
gh workflow run verify-provider.yml \
  --ref main \
  -f deliberate_break=oo-web
```

Watch the run logs — you should see:
- 5/6 consumers verified green (admin-console, carrier-web, driver-web,
  receiver-web, shipper-web)
- 1/6 failed (oo-web — "$.selfDriver missing isSelf")
- Workflow exits non-zero

Then immediately attempt `gh workflow run deploy-backend.yml --ref
main` — the `can-i-deploy` step will block the deploy and the log will
name `oo-web` as the broken consumer.

To clear the demo state, run verify-provider.yml again with no
`deliberate_break` input; the next can-i-deploy will pass.

## Failure-mode graceful degradation

All three workflows are coded to **skip Pact steps when secrets are
unset**, not fail. That's intentional:

- Lets the workflow YAML files land BEFORE PactFlow exists
- Means an outage of PactFlow doesn't block deploys (just removes the
  gate temporarily — operator decision whether that's acceptable)
- Lets dev branches push without the gate when iterating

To make the gate **mandatory** (no-secret = blocked deploy), change
the `if: ${{ secrets.PACT_BROKER_BASE_URL != '' }}` conditions to
`if: always()` in deploy-backend.yml. Don't do that until PactFlow is
verified working in CI for at least one release cycle.

## Cost

PactFlow free tier:
- 1 organization
- Unlimited consumers/providers
- 100 verification runs / month
- Pacts retained 30 days

We currently have 6 verifications per CI run × ~20 CI runs/month = 120
verifications/mo if we run on every push. To stay under free tier:
- Pin the workflow trigger to `push: branches: [main]` only (already
  done)
- Skip PR runs that don't change contract files (already done via the
  `paths:` filter)

If we exceed free tier, the Foundation paid plan is ~$30/seat/month.
Or self-host the OSS broker (see "Alternative: self-hosted broker"
below).

## Alternative: self-hosted broker on AWS

If PactFlow's vendor lock-in or pricing becomes a concern, the same
OSS broker we're running locally (`pactfoundation/pact-broker` image)
can run on AWS:

- ECS Fargate (1 task, 0.25 vCPU / 0.5 GB RAM) for the broker
- RDS Postgres (t4g.micro) for the database
- ALB w/ ACM cert for `pact.loadleadapp.com`
- Secret in Secrets Manager for the basic-auth credentials

Switching costs: update `PACT_BROKER_BASE_URL` secret, update
`PACT_BROKER_TOKEN` → `PACT_BROKER_USERNAME` + `PACT_BROKER_PASSWORD`
in the workflows + verify-provider.ts. The pact files themselves are
re-publishable; no contract content lost. Estimated AWS cost: ~$30/mo
idle.

Phase 2 candidate; not blocking.
