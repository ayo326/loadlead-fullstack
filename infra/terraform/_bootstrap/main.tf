############################################################################
# _bootstrap — apply this ONCE, by hand, before any environment stack.
# Creates the account-wide singletons that dev/staging/prod all reference
# by name/ARN, but that must not be owned by any single environment's state
# (so destroying "dev" can never destroy something staging/prod depend on).
#
#   terraform init && terraform apply
#
# Creates:
#   1. S3 bucket + DynamoDB table for remote Terraform state (all envs)
#   2. GitHub OIDC provider (so Actions can assume AWS roles with no stored keys)
#   3. The Elastic Beanstalk Application (environments are per-env, the
#      Application is the shared "folder" they live under in the EB console)
############################################################################

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = "us-east-1"
}

# ── Terraform remote state backend ────────────────────────────────────────
resource "aws_s3_bucket" "tf_state" {
  bucket = "loadlead-terraform-state"

  tags = { Project = "LoadLead", ManagedBy = "Terraform", Component = "tf-state" }
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tf_lock" {
  name         = "loadlead-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
  tags = { Project = "LoadLead", ManagedBy = "Terraform", Component = "tf-state" }
}

# ── GitHub Actions OIDC provider (one per AWS account) ────────────────────
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  tags            = { Project = "LoadLead", ManagedBy = "Terraform" }
}

# ── Elastic Beanstalk Application (shared "folder" for dev/staging/prod envs) ─
resource "aws_elastic_beanstalk_application" "loadlead_backend" {
  name        = "LoadLead-Backend"
  description = "LoadLead Express/Node backend — one Application, one Environment per env (dev/staging/prod)"

  appversion_lifecycle {
    service_role          = aws_iam_role.eb_service_role.arn
    max_count              = 30
    delete_source_from_s3  = true
  }

  tags = { Project = "LoadLead", ManagedBy = "Terraform" }
}

resource "aws_iam_role" "eb_service_role" {
  name = "loadlead-eb-service-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "elasticbeanstalk.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "sts:ExternalId" = "elasticbeanstalk" } }
    }]
  })
  tags = { Project = "LoadLead", ManagedBy = "Terraform" }
}

resource "aws_iam_role_policy_attachment" "eb_service_health" {
  role       = aws_iam_role.eb_service_role.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkEnhancedHealth"
}

resource "aws_iam_role_policy_attachment" "eb_service_managed_updates" {
  role       = aws_iam_role.eb_service_role.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy"
}

output "github_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "tf_state_bucket" {
  value = aws_s3_bucket.tf_state.bucket
}

output "tf_lock_table" {
  value = aws_dynamodb_table.tf_lock.name
}
