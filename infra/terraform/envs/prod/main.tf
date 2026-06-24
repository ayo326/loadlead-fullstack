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
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
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

# ── github_deploy_role + OIDC provider data — DISABLED ────────────────────
# Was non-functional from day one: the data source resolves a GitHub OIDC
# provider that doesn't exist in this account yet, and the
# frontend_distribution_arn carried a placeholder account ID
# (123456789012). Any `tofu plan` against the prod stack failed at this
# block, which blocked bringing the DDB tables under management.
#
# Re-enable by:
#   1. Bootstrap stack creates the OIDC provider (already declared there)
#   2. Replace the account ID in frontend_distribution_arn with the real
#      AWS account ID (552011299815)
#   3. Confirm the frontend bucket name
#   4. Uncomment this block
#
# Until then the prod stack still works for everything else (DDB, EB)
# without this OIDC role being in TF.
#
# data "aws_iam_openid_connect_provider" "github" {
#   url = "https://token.actions.githubusercontent.com"
# }
#
# module "github_deploy_role" {
#   source                   = "../../modules/github_oidc_role"
#   env                      = "prod"
#   github_oidc_provider_arn = data.aws_iam_openid_connect_provider.github.arn
#   github_repo              = var.github_repo
#   allowed_environment      = "production"
#   dynamodb_table_prefix    = "LoadLead_"
#   eb_environment_name      = "loadlead-backend-prod"
#   frontend_bucket_arn       = "arn:aws:s3:::loadlead-frontend-prod"
#   frontend_distribution_arn = "arn:aws:cloudfront::552011299815:distribution/E38CZNP7L2DB98"
#   tags = local.tags
# }
#
# output "github_deploy_role_arn" {
#   value = module.github_deploy_role.role_arn
# }

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

output "signatures_table_arn" { value = module.ddb_signatures.arn }
output "pod_photos_table_arn" { value = module.ddb_pod_photos.arn }
