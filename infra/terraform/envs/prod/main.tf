############################################################################
# Prod is intentionally NOT fully managed by this Terraform yet.
#
# loadlead-backend-prod (EB), the LoadLead_* DynamoDB tables, and the
# E38CZNP7L2DB98 CloudFront distribution already exist and are running.
# Writing fresh `aws_elastic_beanstalk_environment` / `aws_dynamodb_table` /
# `aws_cloudfront_distribution` resources here — without first running
# `terraform import` against every one of them and confirming a clean,
# no-diff plan — risks Terraform either erroring on "already exists" or,
# worse, succeeding and silently drifting prod's real config toward
# whatever guesses are encoded here.
#
# So this stack only adds the ONE thing prod is missing for the new CI/CD
# flow: a GitHub-OIDC deploy role, scoped to the EXISTING resources by their
# real, literal names/ARNs — gated behind a GitHub Environment
# ("production") with required reviewers, so promotion to prod is a human
# decision even though credentials are short-lived and scoped.
#
# Path to bring the rest of prod under Terraform later (do this once, calmly,
# not as part of standing up dev/staging):
#   terraform import aws_elastic_beanstalk_environment.prod  loadlead-backend-prod
#   terraform import aws_dynamodb_table.users                 LoadLead_Users
#   ...(one import per existing table)...
#   terraform import aws_cloudfront_distribution.prod         E38CZNP7L2DB98
#   terraform plan   # must show "no changes" before this is trustworthy
############################################################################

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws     = { source = "hashicorp/aws",     version = "~> 6.0" } # 6.x adds TLSv1.3_2025 to cloudfront min protocol
    archive = { source = "hashicorp/archive", version = "~> 2.0" } # used by lambda zip in worm-sink.tf
  }

  backend "s3" {
    bucket         = "loadlead-terraform-state"
    key            = "envs/prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "loadlead-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = "us-east-1"
}

variable "github_repo" {
  type    = string
  default = "ayo326/loadlead-fullstack"
}

locals {
  tags = { Project = "LoadLead", Environment = "prod", ManagedBy = "Terraform" }
}

# ── github_deploy_role — RE-ENABLED ────────────────────────────────────────
# Three blockers fixed (see prior commits in the log):
#   - OIDC provider now exists in this account (applied via _bootstrap stack)
#   - max_session_duration in the shared module raised 1800 -> 3600 (AWS min)
#   - frontend_bucket_arn / frontend_distribution_arn / eb_environment_name
#     now reference the TF-managed resources rather than hand-typed ARNs
#     with placeholder account IDs. The references give us a free guarantee
#     that the role's permissions can't drift out of sync with the resources
#     it's supposed to deploy to — if the bucket or distro is renamed, the
#     role's policy regenerates automatically.
#
# Trust policy: AssumeRole is only allowed for GitHub Actions runs whose
# sub claim is `repo:<owner>/<repo>:environment:production`. That binds
# credential issuance to the GitHub "production" Environment — the
# required-reviewers gate on that Environment is enforced at the AWS
# layer, not just the GitHub UI.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

module "github_deploy_role" {
  source                   = "../../modules/github_oidc_role"
  env                      = "prod"
  github_oidc_provider_arn = data.aws_iam_openid_connect_provider.github.arn
  github_repo              = var.github_repo
  allowed_environment      = "production"

  dynamodb_table_prefix    = "LoadLead_"
  eb_application_name      = aws_elastic_beanstalk_application.backend.name
  eb_environment_name      = aws_elastic_beanstalk_environment.backend_prod.name
  frontend_bucket_arn       = aws_s3_bucket.frontend_customer.arn
  frontend_distribution_arn = aws_cloudfront_distribution.customer.arn

  tags = local.tags
}

output "github_deploy_role_arn" {
  description = "Set this on the GitHub repo as variable AWS_PROD_DEPLOY_ROLE_ARN (Environment-scoped to 'production')."
  value       = module.github_deploy_role.role_arn
}

############################################################################
# Attestation Phase 1 — NEW DDB tables.
#
# These are NEW (no `terraform import` required). The TF module sets
# point_in_time_recovery + deletion_protection by default, so the new
# tables inherit a known-good baseline. Existing prod tables stay outside
# TF; that's tracked as a separate backlog item.
#
# IAM Deny on UpdateItem/DeleteItem/BatchWriteItem for LoadLead_Signatures
# is applied OUT-OF-BAND via attestation-bootstrap-ops.sh, because the
# EB instance profile role (aws-elasticbeanstalk-ec2-role) is not in TF.
# When the role is brought under TF (Phase 2), wire infra/terraform/modules/iam_signatures/.
############################################################################

module "ddb_signatures" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_Signatures"
  hash_key            = "signatureId"
  attributes = [
    { name = "signatureId", type = "S" },
    { name = "loadId",      type = "S" },
    { name = "signedAt",    type = "S" },
  ]
  global_secondary_indexes = [
    { name = "loadId-signedAt-index", hash_key = "loadId", range_key = "signedAt", projection_type = "ALL" },
  ]
  deletion_protection = true
  # DDB Streams feed the WORM sink Lambda (see worm-sink.tf). NEW_IMAGE
  # is enough — we ship every successful PutItem row in full; MODIFY/
  # REMOVE should never fire (IAM Deny) but the Lambda still alerts on
  # them as an integrity event.
  stream_enabled      = true
  stream_view_type    = "NEW_IMAGE"
  tags                = local.tags
}

module "ddb_pod_photos" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_PodPhotos"
  hash_key            = "photoId"
  attributes = [
    { name = "photoId", type = "S" },
    { name = "loadId",  type = "S" },
  ]
  global_secondary_indexes = [
    { name = "loadId-index", hash_key = "loadId", projection_type = "ALL" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_BetaTrustEvents ───────────────────────────────────────────────
# Beta-admin trust/operational events (no-show, trust incident). Deliberately
# SEPARATE from the loads table: these records reference a load and carrier by
# id only and never live on the Load model. Same posture as the other trust
# tables (PITR on via the module, deletion protection on) since they are an
# append-only trust signal.
module "ddb_beta_trust_events" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_BetaTrustEvents"
  hash_key            = "eventId"
  attributes = [
    { name = "eventId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_PlatformFeePolicy ─────────────────────────────────────────────
# Append-only platform fee policy changes (linehaul take rate + beta waiver).
# The current policy is the newest row; rows are never updated or deleted, and
# each change carries an actor and a timestamp. Same append-only trust posture
# as the tables above (PITR on via the module, deletion protection on).
module "ddb_platform_fee_policy" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_PlatformFeePolicy"
  hash_key            = "changeId"
  attributes = [
    { name = "changeId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_AccessorialPolicies ───────────────────────────────────────────
# Per-load accessorial policy (detention/layover terms), keyed by loadId.
# Editable until a charge freezes a snapshot; references the load by id only and
# never lives on the Load model.
module "ddb_accessorial_policies" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_AccessorialPolicies"
  hash_key            = "loadId"
  attributes = [
    { name = "loadId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_AccessorialPolicyAcceptances ──────────────────────────────────
# Append-only ESIGN/UETA acceptances of a load's accessorial policy. Pins the
# accepted version + policy hash; rows are never updated or deleted.
module "ddb_accessorial_policy_acceptances" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_AccessorialPolicyAcceptances"
  hash_key            = "acceptanceId"
  attributes = [
    { name = "acceptanceId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_StopEvents ────────────────────────────────────────────────────
# Append-only stop-events log (check-in/check-out evidence). Detention and
# layover compute from these immutable events; references load + stop by id
# only. Same append-only posture as the trust tables.
module "ddb_stop_events" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_StopEvents"
  hash_key            = "eventId"
  attributes = [
    { name = "eventId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_AccessorialCharges ────────────────────────────────────────────
# Accessorial charge ledger (DETENTION/LAYOVER). Deterministic chargeId so a
# recompute updates in place; the live row carries status + amount and the
# immutable trail lives in the status-history table below.
module "ddb_accessorial_charges" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_AccessorialCharges"
  hash_key            = "chargeId"
  attributes = [
    { name = "chargeId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_AccessorialChargeStatusHistory ────────────────────────────────
# Append-only charge status transitions (original/new amounts on adjust).
module "ddb_charge_status_history" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_AccessorialChargeStatusHistory"
  hash_key            = "historyId"
  attributes = [
    { name = "historyId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_FactoringAssignments ──────────────────────────────────────────
# Append-only factoring assignment log. A release/change is a new row; the
# active assignment resolves with invoice-level precedence over account-level.
module "ddb_factoring_assignments" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_FactoringAssignments"
  hash_key            = "assignmentId"
  attributes = [
    { name = "assignmentId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_NoticesOfAssignment ───────────────────────────────────────────
# Append-only Notices of Assignment (legal redirection snapshots). References
# the assignment, carrier, invoice, and debtor by id.
module "ddb_notices_of_assignment" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_NoticesOfAssignment"
  hash_key            = "noaId"
  attributes = [
    { name = "noaId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_FundingAdvances ───────────────────────────────────────────────
# Append-only funding advances. No advance against a non-APPROVED accessorial;
# idempotent per (invoice, line). References invoice/carrier/charge by id.
module "ddb_funding_advances" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_FundingAdvances"
  hash_key            = "advanceId"
  attributes = [
    { name = "advanceId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_ReconciliationOutcomes ────────────────────────────────────────
# Append-only reconciliation + recourse outcomes (payment routing, reserve
# release, supplemental advance, recourse buyback, non-recourse loss).
module "ddb_reconciliation_outcomes" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_ReconciliationOutcomes"
  hash_key            = "outcomeId"
  attributes = [
    { name = "outcomeId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_FactorContacts ────────────────────────────────────────────────
# Saved factor contact per carrier/owner-operator (pre-fills the send recipient).
module "ddb_factor_contacts" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_FactorContacts"
  hash_key            = "carrierId"
  attributes = [
    { name = "carrierId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

# ─── LoadLead_FactoringSubmissions ──────────────────────────────────────────
# Append-only factoring submission records: the disclosure trail of what
# financial documents left the platform, to whom, and when.
module "ddb_factoring_submissions" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_FactoringSubmissions"
  hash_key            = "submissionId"
  attributes = [
    { name = "submissionId", type = "S" },
  ]
  deletion_protection = true
  tags                = local.tags
}

output "signatures_table_arn" { value = module.ddb_signatures.arn }
output "pod_photos_table_arn" { value = module.ddb_pod_photos.arn }
output "platform_fee_policy_table_arn" { value = module.ddb_platform_fee_policy.arn }
output "accessorial_policies_table_arn" { value = module.ddb_accessorial_policies.arn }
output "accessorial_policy_acceptances_table_arn" { value = module.ddb_accessorial_policy_acceptances.arn }
output "stop_events_table_arn" { value = module.ddb_stop_events.arn }
output "accessorial_charges_table_arn" { value = module.ddb_accessorial_charges.arn }
output "charge_status_history_table_arn" { value = module.ddb_charge_status_history.arn }
output "factoring_assignments_table_arn" { value = module.ddb_factoring_assignments.arn }
output "notices_of_assignment_table_arn" { value = module.ddb_notices_of_assignment.arn }
output "funding_advances_table_arn" { value = module.ddb_funding_advances.arn }
output "reconciliation_outcomes_table_arn" { value = module.ddb_reconciliation_outcomes.arn }
