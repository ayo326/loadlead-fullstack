# Platform ticket: finish the staging backend auto-deploy (EB deploy-role IAM)

Owner team: Platform Engineering
Status: OPEN (blocked on a deliberate IAM decision)
Related merged PRs: #35 (Pact race), #36 (OIDC trust + EB perms + app-name + CFN read)

## TL;DR

The staging backend auto-deploy (`.github/workflows/deploy-backend.yml` ->
`deploy-staging`) had never worked end to end. Six never-exercised config
bugs were found and fixed (see "Already fixed"). The deploy now runs all the
way to the Elastic Beanstalk environment update, then fails because the CI
deploy role (`loadlead-staging-github-deploy`) lacks the broader
Elastic-Beanstalk-managed deploy permissions. Granting them touches the
shared `github_oidc_role` module (so the prod deploy role too), which is why
this was split out for a deliberate, reviewed change rather than another
reflexive `apply`.

Prod is unaffected throughout: `deploy-prod` is `workflow_dispatch`-only.

## Already fixed (merged, applied live, each validated by the deploy advancing)

| # | Bug | Fix |
|---|-----|-----|
| 1 | Pact `can-i-deploy` raced the separate verify-provider workflow | publish verification inside deploy-staging before the gate (#35) |
| 2 | `AWS_STAGING_DEPLOY_ROLE_ARN` never set on the `staging` GitHub Environment | variable set to the role ARN |
| 3 | OIDC trust used `allowed_ref` but the job uses `environment: staging` (sub is environment-scoped) | `allowed_environment = "staging"` (#36) |
| 4 | deploy role lacked `elasticbeanstalk:CreateStorageLocation` + bucket-locate S3 perms | added, scoped (#36) |
| 5 | staging module never passed `eb_application_name`, defaulted to "LoadLead-Backend"; real app is lowercase "loadlead-backend" -> policy ARNs mismatched | pass correct name (#36) |
| 6 | deploy role lacked `cloudformation:GetTemplate` on the EB `awseb-*` stack | added read-only CFN perms scoped to `stack/awseb-*/*` (#36) |

After these, the run reaches: `Starting deployment of version ... to
environment loadlead-backend-staging`, i.e. `UpdateEnvironment` succeeds and
EB begins rolling the version onto the instance.

## The remaining blocker

During the EB rolling deploy, these appear as environment events attributed
to the `loadlead-staging-github-deploy` role:

```
ERROR: Service:Amazon S3 ... not authorized: s3:GetObjectAcl
ERROR: Service:AmazonAutoScaling ... not authorized: autoscaling:DescribeAutoScalingGroups
```

The role's policy (module `github_oidc_role`) was written hyper-minimal and
was never validated against a real EB deploy. A working EB deploy principal
needs the standard EB-managed deploy permission set, roughly:

- `autoscaling:Describe*` (+ `Suspend/ResumeProcesses`, `UpdateAutoScalingGroup` for rolling)
- `ec2:Describe*`
- `elasticloadbalancing:Describe*`
- `s3:GetObjectAcl` on the EB app-versions bucket (in addition to the existing Get/Put)
- `cloudwatch:Describe*/GetMetricStatistics/PutMetricAlarm`
- `sns:Get*/List*` (EB env notifications)
- `logs:Describe*` (if log streaming enabled)
- possibly `cloudformation:UpdateStack`/`GetStackPolicy` on `awseb-*`

AWS's managed baselines to model against (do NOT attach wholesale; use as the
menu to build a scoped policy from):
- `AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy`
- `AdministratorAccess-AWSElasticBeanstalk` (too broad; reference only)

## Why this needs a deliberate decision

- It's the **shared** `infra/terraform/modules/github_oidc_role`, so the same
  grant lands on the **dev and prod** deploy roles, not just staging. That is
  a prod IAM change.
- It materially widens a CI role's blast radius (autoscaling/ec2/elb/s3-acl/
  cloudwatch). It should be least-privilege, reviewed, and scoped by resource
  where the actions allow it (many of these Describe* actions do not support
  resource-level scoping and require `*`).

## Proposed approach

1. Draft a new statement (or two) in `github_oidc_role/main.tf` granting the
   EB-managed deploy actions above. Scope by resource where supported (S3
   bucket, `awseb-*` stacks); use `Resource = "*"` only for Describe* actions
   that do not support it, with a comment.
2. `tofu plan` in `envs/staging`, review the exact policy diff, then targeted
   `apply` of `module.github_deploy_role.aws_iam_role_policy.deploy` on staging
   first.
3. Re-run the staging deploy (trigger a FRESH run so the version label's
   run-number changes - do not keep re-running the same run, which collides on
   the S3 source bundle / UNPROCESSED app version; clean up with
   `aws elasticbeanstalk delete-application-version --delete-source-bundle`
   if needed).
4. Once staging is green, apply to dev + prod roles (they share the module;
   a normal `tofu apply` in each env picks it up) so all three are consistent.

## Second, separate risk to verify after IAM is fixed

The staging EB environment (`loadlead-backend-staging`) has been Health
**Grey / "No Data"** and the live endpoint `https://api-staging.loadleadapp.com/api/health`
returns **504** - it has never served. Even after the deploy-role IAM is
complete, confirm the app actually boots healthy on the instance (env vars,
APP_ENV=staging, port binding, instance profile `loadlead-staging-eb-instance-profile`
S3/DynamoDB perms). Budget time for app-level bring-up, not just the deploy.

## Acceptance criteria

- `deploy-staging` completes green on a fresh push to `main` (no manual reruns).
- `https://api-staging.loadleadapp.com/api/health` returns 200.
- The `github_oidc_role` policy is least-privilege and reviewed; dev/staging/
  prod roles are consistent.
- No change to the prod deploy PATH (still `workflow_dispatch`-gated).
