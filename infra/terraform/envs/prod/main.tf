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

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

module "github_deploy_role" {
  source                   = "../../modules/github_oidc_role"
  env                       = "prod"
  github_oidc_provider_arn = data.aws_iam_openid_connect_provider.github.arn
  github_repo               = var.github_repo

  # Gated by GitHub Environment, not by branch/tag — this is what forces the
  # required-reviewers approval in GitHub before AWS will even hand out
  # credentials, not just before the deploy step runs.
  allowed_environment = "production"

  dynamodb_table_prefix    = "LoadLead_" # existing prod prefix (underscore, no env suffix)
  eb_environment_name      = "loadlead-backend-prod"
  frontend_bucket_arn       = "arn:aws:s3:::loadlead-frontend-prod" # ← confirm actual prod bucket name before applying
  frontend_distribution_arn = "arn:aws:cloudfront::123456789012:distribution/E38CZNP7L2DB98" # ← replace account ID

  tags = local.tags
}

output "github_deploy_role_arn" {
  value = module.github_deploy_role.role_arn
}
