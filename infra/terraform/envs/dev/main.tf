locals {
  env    = "dev"
  prefix = "LoadLead-Dev-"
  tags = {
    Project     = "LoadLead"
    Environment = "dev"
    ManagedBy   = "Terraform"
  }
}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

module "network" {
  source     = "../../modules/network"
  env        = local.env
  vpc_cidr   = "10.10.0.0/16"
  azs        = ["us-east-1a", "us-east-1b"]
  enable_nat = false # dev EB instance sits in a public subnet — no NAT cost
  tags       = local.tags
}

module "dynamodb" {
  source               = "../../modules/dynamodb_tableset"
  env                  = local.env
  prefix               = local.prefix
  deletion_protection  = false
  tags                 = local.tags
}

resource "aws_s3_bucket" "pod_uploads" {
  bucket = "loadlead-dev-pod-uploads"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "pod_uploads" {
  bucket                  = aws_s3_bucket.pod_uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "pod_uploads" {
  bucket = aws_s3_bucket.pod_uploads.id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins  = ["*"] # presigned-URL uploads from the driver app — tighten to the dev frontend origin once it's stable
    allowed_headers  = ["*"]
  }
}

# Auto-delete dev POD test photos after 30 days — nobody needs dev test data forever
resource "aws_s3_bucket_lifecycle_configuration" "pod_uploads" {
  bucket = aws_s3_bucket.pod_uploads.id
  rule {
    id     = "expire-old-test-uploads"
    status = "Enabled"
    expiration { days = 30 }
  }
}

module "frontend" {
  source      = "../../modules/frontend"
  env         = local.env
  bucket_name = "loadlead-dev-frontend"
  domain_name = null # use the CloudFront default domain — no Route53/ACM needed for dev
  price_class = "PriceClass_100"
  tags        = local.tags
}

module "backend" {
  source                = "../../modules/backend_eb"
  env                    = local.env
  vpc_id                 = module.network.vpc_id
  subnet_ids             = module.network.public_subnet_ids # no NAT in dev → instance must be public
  elb_subnet_ids          = module.network.public_subnet_ids
  security_group_id      = module.network.eb_instance_sg_id
  instance_type          = "t3.micro"
  min_instances          = 1
  max_instances          = 1
  environment_type       = "SingleInstance" # no ALB cost
  dynamodb_table_prefix  = local.prefix
  env_vars               = merge(var.backend_env_vars, {
    NODE_ENV                       = "development"
    FRONTEND_URL                   = "https://${module.frontend.distribution_domain_name}"
    DYNAMODB_USERS_TABLE           = "${local.prefix}Users"
    DYNAMODB_DRIVERS_TABLE         = "${local.prefix}Drivers"
    DYNAMODB_SHIPPERS_TABLE        = "${local.prefix}Shippers"
    DYNAMODB_RECEIVERS_TABLE       = "${local.prefix}Receivers"
    DYNAMODB_LOADS_TABLE           = "${local.prefix}Loads"
    DYNAMODB_OFFERS_TABLE          = "${local.prefix}Offers"
    DYNAMODB_BOL_TABLE             = "${local.prefix}BOL"
    DYNAMODB_ORGS_TABLE            = "${local.prefix}Organizations"
    DYNAMODB_MEMBERSHIPS_TABLE     = "${local.prefix}Memberships"
    DYNAMODB_INVITATIONS_TABLE     = "${local.prefix}Invitations"
    DYNAMODB_OWNER_OPERATORS_TABLE = "${local.prefix}OwnerOperators"
    DYNAMODB_FLEET_INVITES_TABLE   = "${local.prefix}FleetInvites"
    DYNAMODB_VERIFICATIONS_TABLE   = "${local.prefix}Verifications"
    DYNAMODB_FACTORING_OPTINS_TABLE = "${local.prefix}FactoringOptIns"
    POD_S3_BUCKET                   = "loadlead-dev-pod-uploads"
  })
  tags = local.tags
}

module "github_deploy_role" {
  source                     = "../../modules/github_oidc_role"
  env                         = local.env
  github_oidc_provider_arn   = data.aws_iam_openid_connect_provider.github.arn
  github_repo                 = var.github_repo
  allowed_ref                 = "refs/heads/dev" # only the dev branch can assume this role
  dynamodb_table_prefix       = local.prefix
  eb_environment_name         = module.backend.environment_name
  frontend_bucket_arn          = "arn:aws:s3:::loadlead-dev-frontend"
  frontend_distribution_arn    = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${module.frontend.distribution_id}"
  tags                         = local.tags
}

data "aws_caller_identity" "current" {}

output "frontend_url" {
  value = "https://${module.frontend.distribution_domain_name}"
}

output "backend_url" {
  value = module.backend.cname
}

output "github_deploy_role_arn" {
  value = module.github_deploy_role.role_arn
}
