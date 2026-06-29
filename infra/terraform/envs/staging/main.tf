locals {
  env    = "staging"
  prefix = "LoadLead-Staging-"
  tags = {
    Project     = "LoadLead"
    Environment = "staging"
    ManagedBy   = "Terraform"
  }
}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_caller_identity" "current" {}

module "network" {
  source     = "../../modules/network"
  env        = local.env
  vpc_cidr   = "10.20.0.0/16"
  azs        = ["us-east-1a", "us-east-1b"]
  enable_nat = true # staging should behave like prod's network path (private subnet + NAT)
  tags       = local.tags
}

module "dynamodb" {
  source              = "../../modules/dynamodb_tableset"
  env                  = local.env
  prefix               = local.prefix
  deletion_protection  = false # staging data is disposable; flip to true if it starts holding anything you'd miss
  tags                 = local.tags
}

resource "aws_s3_bucket" "pod_uploads" {
  bucket = "loadlead-staging-pod-uploads"
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
    allowed_origins  = ["https://${var.staging_domain}"]
    allowed_headers  = ["*"]
  }
}

# ACM cert for the staging CloudFront alias — must be requested in us-east-1
resource "aws_acm_certificate" "staging" {
  provider          = aws.us_east_1
  domain_name       = var.staging_domain
  validation_method = "DNS"
  tags              = local.tags
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "staging_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.staging.domain_validation_options : dvo.domain_name => {
      name = dvo.resource_record_name
      type = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "staging" {
  provider                = aws.us_east_1
  certificate_arn          = aws_acm_certificate.staging.arn
  validation_record_fqdns  = [for r in aws_route53_record.staging_cert_validation : r.fqdn]
}

module "frontend" {
  source              = "../../modules/frontend"
  env                  = local.env
  bucket_name          = "loadlead-staging-frontend"
  domain_name           = var.staging_domain
  acm_certificate_arn   = aws_acm_certificate_validation.staging.certificate_arn
  price_class           = "PriceClass_100"
  tags                  = local.tags
}

resource "aws_route53_record" "staging_alias" {
  zone_id = var.route53_zone_id
  name    = var.staging_domain
  type    = "A"
  alias {
    name                   = module.frontend.distribution_domain_name
    zone_id                = "Z2FDTNDATAQYW2" # CloudFront's fixed hosted zone ID — same for every distribution
    evaluate_target_health = false
  }
}

module "backend" {
  source                 = "../../modules/backend_eb"
  env                     = local.env
  vpc_id                  = module.network.vpc_id
  subnet_ids              = module.network.private_subnet_ids # behind NAT, like prod's path will be
  elb_subnet_ids           = module.network.public_subnet_ids
  security_group_id       = module.network.eb_instance_sg_id
  instance_type           = "t3.small" # match prod's instance size — catches perf regressions before prod does
  min_instances           = 1
  max_instances           = 2
  environment_type        = "LoadBalanced" # exercise the same ALB health-check path prod uses
  dynamodb_table_prefix    = local.prefix
  env_vars                 = merge(var.backend_env_vars, {
    NODE_ENV                        = "staging"
    FRONTEND_URL                    = "https://${var.staging_domain}"
    DYNAMODB_USERS_TABLE            = "${local.prefix}Users"
    DYNAMODB_DRIVERS_TABLE          = "${local.prefix}Drivers"
    DYNAMODB_SHIPPERS_TABLE         = "${local.prefix}Shippers"
    DYNAMODB_RECEIVERS_TABLE        = "${local.prefix}Receivers"
    DYNAMODB_LOADS_TABLE            = "${local.prefix}Loads"
    DYNAMODB_OFFERS_TABLE           = "${local.prefix}Offers"
    DYNAMODB_BOL_TABLE              = "${local.prefix}BOL"
    DYNAMODB_ORGS_TABLE             = "${local.prefix}Organizations"
    DYNAMODB_MEMBERSHIPS_TABLE      = "${local.prefix}Memberships"
    DYNAMODB_INVITATIONS_TABLE      = "${local.prefix}Invitations"
    DYNAMODB_OWNER_OPERATORS_TABLE  = "${local.prefix}OwnerOperators"
    DYNAMODB_FLEET_INVITES_TABLE    = "${local.prefix}FleetInvites"
    DYNAMODB_VERIFICATIONS_TABLE    = "${local.prefix}Verifications"
    DYNAMODB_FACTORING_OPTINS_TABLE = "${local.prefix}FactoringOptIns"
    DYNAMODB_SIGNATURES_TABLE        = "${local.prefix}Signatures"
    DYNAMODB_POD_PHOTOS_TABLE        = "${local.prefix}PodPhotos"
    DYNAMODB_BETA_ALLOWLIST_TABLE    = "${local.prefix}BetaAllowlist"
    DYNAMODB_WAITLIST_TABLE          = "${local.prefix}Waitlist"
    DYNAMODB_BETA_APPLICATIONS_TABLE = "${local.prefix}BetaApplications"
    DYNAMODB_BETA_TRUST_EVENTS_TABLE = "${local.prefix}BetaTrustEvents"
    POD_S3_BUCKET                    = "loadlead-staging-pod-uploads"
  })
  tags = local.tags
}

module "github_deploy_role" {
  source                     = "../../modules/github_oidc_role"
  env                         = local.env
  github_oidc_provider_arn   = data.aws_iam_openid_connect_provider.github.arn
  github_repo                 = var.github_repo
  allowed_ref                 = "refs/heads/main" # merges to main deploy to staging
  dynamodb_table_prefix       = local.prefix
  eb_environment_name         = module.backend.environment_name
  frontend_bucket_arn          = "arn:aws:s3:::loadlead-staging-frontend"
  frontend_distribution_arn    = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${module.frontend.distribution_id}"
  tags                         = local.tags
}

output "frontend_url" {
  value = "https://${var.staging_domain}"
}

output "backend_url" {
  value = module.backend.cname
}

output "github_deploy_role_arn" {
  value = module.github_deploy_role.role_arn
}
