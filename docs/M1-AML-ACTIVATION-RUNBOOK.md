# M1 AML activation runbook (audit v6, SCRUM-59)

Two-step, compliance-gated activation of the AML enforcement gate. The wiring
shipped inert in PR #97; this turns it on. Read the whole document first.

## What it does

`deriveStatus` currently treats a never-screened entity (`amlStatus===undefined`)
as AML-clear when `AML_REQUIRED` is off. Turning the flag on makes only
`amlStatus==='pass'` count as clear, closing the M1 hole. The gate
(`requireVerifiedCarrier`) reads the STORED `verificationStatus`, and
`deriveStatus` only re-runs inside `recomputeAndPersist` (a verification event),
so the flip is:

- **Immediate for NEW verifications** - a carrier/driver cannot reach VERIFIED
  without a real AML pass. This is the fix.
- **Deferred for the EXISTING VERIFIED** - their stored status holds until their
  next recompute (reverify cycle or a new webhook), at which point an undefined
  `amlStatus` would drop them to PENDING. The backfill prevents that.

## Blast radius (measure it, do not assume)

The set of affected entities is exactly the VERIFIED verification records that
lack a definitive `amlStatus`. Get the current count from **Step 1** (the dry
run) against the target environment; it prints the number to screen and makes no
external calls or writes. Review that count with compliance before Step 2. Do
not record specific prod figures or entity identifiers in this repo.

## Prerequisites (all required before step 2)

- [ ] **Compliance sign-off** on running real AML screens + enforcing the gate.
- [ ] `DIDIT_API_KEY` present in the run environment (the operator sets this; it
      is never printed or handled by tooling). The backfill must run in LIVE mode
      (`APP_ENV=production`) so it hits the real Didit AML API - running it
      without live mode would write a STUB `amlStatus` and is NOT a real screen.
- [ ] AWS creds with read/write on `LoadLead_Verifications`.

## Running the script (runner + env gotchas)

`ts-node` is not installed here; run the script with `tsx` (`npx --yes tsx`).
Two env overrides are required so the script targets PROD and not local dev:

- `DYNAMODB_ENDPOINT=` (empty) - `backend/.env` points DynamoDB at a local
  endpoint (`localhost:8000`); the empty inline value clears it so the AWS SDK
  uses the real regional endpoint. `dotenv` does not override an inline value.
- Real AWS creds must win over the dummy `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` in `backend/.env`. Load your real session creds into
  the shell first (they are already set, so `dotenv` will not overwrite them):
  `eval "$(aws configure export-credentials --format env)"` (does not print the
  secret). Confirm the account is the prod account before Step 2.

## Step 1 - dry run (read-only)

```
cd backend
eval "$(aws configure export-credentials --format env)"   # real creds into the shell
DYNAMODB_ENDPOINT= \
AWS_REGION=us-east-1 \
DYNAMODB_VERIFICATIONS_TABLE=LoadLead_Verifications \
  npx --yes tsx scripts/backfillAml.ts
```

Lists what it WOULD screen; no external calls, no writes, no names printed. The
count it reports is the backfill work list for Step 2.

## Step 2 - backfill for real (LIVE, compliance-gated)

```
cd backend
eval "$(aws configure export-credentials --format env)"   # real creds into the shell
APP_ENV=production \
DYNAMODB_ENDPOINT= \
AWS_REGION=us-east-1 \
DYNAMODB_VERIFICATIONS_TABLE=LoadLead_Verifications \
DIDIT_API_KEY=***                                    # operator supplies; do not echo \
  npx --yes tsx scripts/backfillAml.ts --apply
```

`APP_ENV=production` puts the Didit adapter in LIVE mode. Runs a real Didit AML
screen for each entity on the Step 1 work list via the SAME `screenEntityAml`
the post-KYB/IDV webhook uses, and persists `amlStatus`.

## Step 3 - verify the backfill (read-only)

```
# Re-run the dry run: it must now report "Nothing to backfill".
eval "$(aws configure export-credentials --format env)"
DYNAMODB_ENDPOINT= \
AWS_REGION=us-east-1 \
DYNAMODB_VERIFICATIONS_TABLE=LoadLead_Verifications \
  npx --yes tsx scripts/backfillAml.ts
```

Confirm every entity on the work list ended `amlStatus=pass`. If any came back
`fail`, that entity is now REJECTED - stop and route it to compliance for review
BEFORE the flip (do not flip with an unresolved fail; that is a real AML hit to
adjudicate).

## Step 4 - flip the flag (prod EB)

```
aws elasticbeanstalk update-environment \
  --environment-name loadlead-backend-prod \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=AML_REQUIRED,Value=true
```

`AML_REQUIRED` is a non-secret boolean flag. EB rolls the env (~2-4 min). The
deploy pipeline preserves it thereafter.

## Step 5 - verify activation

```
# Env var is set:
aws elasticbeanstalk describe-configuration-settings \
  --application-name loadlead-backend --environment-name loadlead-backend-prod \
  --query "ConfigurationSettings[0].OptionSettings[?OptionName=='AML_REQUIRED']"

# Health green:
curl -s -o /dev/null -w "%{http_code}\n" https://api.loadleadapp.com/api/health

# The backfilled entities are still VERIFIED (amlStatus=pass survives a recompute).
# A fresh carrier/driver now cannot reach VERIFIED without an AML pass.
```

## Rollback

`AML_REQUIRED` is a single flag. To revert, set `Value=false` and roll. Because
the existing entities were backfilled to `amlStatus=pass`, no stored status was
damaged; reverting simply relaxes the gate for new verifications again.

## Notes

- A `fail` is a real AML/sanctions hit and must be adjudicated by compliance -
  never auto-cleared.
- The org (KYB) screen uses the business legal name as the person name today; a
  beneficial-owner refinement is documented as a follow-up in `verification.ts`.
