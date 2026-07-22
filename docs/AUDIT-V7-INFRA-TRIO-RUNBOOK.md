# Audit v7 infra trio apply runbook (INF-1, INF-2, INF-3)

Three prod-only Terraform hygiene items. Prod-only, so the PR carries
`[terraform-prod-only]`. This is a gated, human-run apply - the PR lands the
config; applying follows this runbook. Read it fully first.

## What changed in the PR

- **INF-1** - `envs/prod/worm-sink.tf`: the signatures WORM-sink Lambda runtime
  bumped `nodejs20.x` -> `nodejs22.x` (Node 20 is EOL in Lambda; no updates after
  2027-03-03). The handler (`lambda/signatures-worm-sink/index.mjs`) uses only
  `@aws-sdk/client-s3`, `@aws-sdk/util-dynamodb`, and `process.env` - all Node-22
  safe. The prod EB backend already runs Node 22.
- **INF-2** - deleted `envs/prod/imported-tables.tf.draft`. Inert (Terraform loads
  only `*.tf`) but drifted: it re-declared imported tables and lacked the audit
  v6 M6 GSI. Pure file removal, no state impact.
- **INF-3** - removed the `aws_dynamodb_table.ddb_admin_audit` block
  (`LoadLead_AdminAudit`). No backend reader (the app uses `LoadLead_AdminAuditLog`
  via `module.ddb_admin_audit_log`). The physical table does NOT exist in AWS, but
  the resource IS in prod state - so a normal apply would RE-CREATE an unused
  table. Requires a `state rm` (Step 1) so the block removal is a true no-op.

## Preconditions

- [ ] PR merged to main.
- [ ] `tofu` runnable against `envs/prod` with prod creds.
- [ ] Confirm the mismatch still holds:
      `aws dynamodb describe-table --table-name LoadLead_AdminAudit` -> ResourceNotFoundException,
      and `tofu state list | grep ddb_admin_audit` -> present.

## Step 1 - drop the stale state entry (INF-3)

```
cd infra/terraform/envs/prod
tofu init -input=false
tofu state rm aws_dynamodb_table.ddb_admin_audit
```

This only forgets a state entry for a table that does not exist; it deletes
nothing in AWS. (There is nothing to delete - the table is already gone.)

## Step 2 - re-zip the WORM-sink Lambda if the deploy pipeline does not (INF-1)

The runtime change alone triggers an in-place `update-function-configuration`; the
code zip is unchanged. If `worm-sink.tf` builds the zip from
`lambda/signatures-worm-sink/` via an `archive_file` data source, no manual step
is needed. Confirm from the plan in Step 3 (expect an update, not replace).

## Step 3 - plan review

```
tofu plan -out=trio.plan
```

Expect ONLY:
- `aws_lambda_function.<worm sink>` **update in place** - `runtime` 20.x -> 22.x.
- NOTHING for `aws_dynamodb_table.ddb_admin_audit` (removed from config AND state
  in Step 1, so it is absent from the plan entirely).

**HARD STOP** if the plan shows any `create` for `LoadLead_AdminAudit` (Step 1 was
skipped), any `destroy`, any DynamoDB table change, or the Lambda being
**replaced** rather than updated. The WORM sink is legal-evidence infra - a
replace would recreate the function and could disturb its event-source wiring.

## Step 4 - apply + verify

```
tofu apply trio.plan

# runtime is now 22:
aws lambda get-function-configuration --function-name loadlead-prod-signatures-worm-sink \
  --query "Runtime" --output text        # -> nodejs22.x

# a smoke through the sink still writes (or check recent invocations/CloudWatch):
aws lambda get-function --function-name loadlead-prod-signatures-worm-sink \
  --query "Configuration.{Runtime:Runtime,State:State,LastUpdateStatus:LastUpdateStatus}"
# State Active, LastUpdateStatus Successful.
```

## Rollback

- INF-1: set `runtime = "nodejs20.x"` and apply (Node 20 still runs; it is only
  un-patched, not disabled - so this is a safety valve, not a fix).
- INF-2 / INF-3: `git revert` the file changes. INF-3 has no live effect to roll
  back (the table never existed); re-adding the block would just re-introduce the
  create-on-next-apply problem.
