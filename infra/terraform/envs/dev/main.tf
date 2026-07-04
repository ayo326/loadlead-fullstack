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
  source              = "../../modules/dynamodb_tableset"
  env                 = local.env
  prefix              = local.prefix
  deletion_protection = false
  tags                = local.tags
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
    allowed_origins = ["*"] # presigned-URL uploads from the driver app — tighten to the dev frontend origin once it's stable
    allowed_headers = ["*"]
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

# ACM cert for the dev CloudFront alias — must be requested in us-east-1
resource "aws_acm_certificate" "dev" {
  provider          = aws.us_east_1
  domain_name       = var.dev_domain
  validation_method = "DNS"
  tags              = local.tags
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "dev_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.dev.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "dev" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.dev.arn
  validation_record_fqdns = [for r in aws_route53_record.dev_cert_validation : r.fqdn]
}

module "frontend" {
  source              = "../../modules/frontend"
  env                 = local.env
  bucket_name         = "loadlead-dev-frontend"
  domain_name         = var.dev_domain
  acm_certificate_arn = aws_acm_certificate_validation.dev.certificate_arn
  price_class         = "PriceClass_100"
  tags                = local.tags
}

resource "aws_route53_record" "dev_alias" {
  zone_id = var.route53_zone_id
  name    = var.dev_domain
  type    = "A"
  alias {
    name                   = module.frontend.distribution_domain_name
    zone_id                = "Z2FDTNDATAQYW2" # CloudFront's fixed hosted zone ID — same for every distribution
    evaluate_target_health = false
  }
}

module "backend" {
  source                = "../../modules/backend_eb"
  env                   = local.env
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.public_subnet_ids # no NAT in dev → instance must be public
  elb_subnet_ids        = module.network.public_subnet_ids
  security_group_id     = module.network.eb_instance_sg_id
  instance_type         = "t3.micro"
  min_instances         = 1
  max_instances         = 1
  environment_type      = "SingleInstance" # no ALB cost
  dynamodb_table_prefix = local.prefix
  env_vars = merge(var.backend_env_vars, {
    NODE_ENV                         = "development"
    FRONTEND_URL                     = "https://${var.dev_domain}"
    DYNAMODB_USERS_TABLE             = "${local.prefix}Users"
    DYNAMODB_DRIVERS_TABLE           = "${local.prefix}Drivers"
    DYNAMODB_SHIPPERS_TABLE          = "${local.prefix}Shippers"
    DYNAMODB_RECEIVERS_TABLE         = "${local.prefix}Receivers"
    DYNAMODB_LOADS_TABLE             = "${local.prefix}Loads"
    DYNAMODB_OFFERS_TABLE            = "${local.prefix}Offers"
    DYNAMODB_BOL_TABLE               = "${local.prefix}BOL"
    DYNAMODB_ORGS_TABLE              = "${local.prefix}Organizations"
    DYNAMODB_MEMBERSHIPS_TABLE       = "${local.prefix}Memberships"
    DYNAMODB_INVITATIONS_TABLE       = "${local.prefix}Invitations"
    DYNAMODB_OWNER_OPERATORS_TABLE   = "${local.prefix}OwnerOperators"
    DYNAMODB_FLEET_INVITES_TABLE     = "${local.prefix}FleetInvites"
    DYNAMODB_VERIFICATIONS_TABLE     = "${local.prefix}Verifications"
    DYNAMODB_FACTORING_OPTINS_TABLE  = "${local.prefix}FactoringOptIns"
    DYNAMODB_SIGNATURES_TABLE        = "${local.prefix}Signatures"
    DYNAMODB_POD_PHOTOS_TABLE        = "${local.prefix}PodPhotos"
    DYNAMODB_BETA_ALLOWLIST_TABLE    = "${local.prefix}BetaAllowlist"
    DYNAMODB_WAITLIST_TABLE          = "${local.prefix}Waitlist"
    DYNAMODB_BETA_APPLICATIONS_TABLE = "${local.prefix}BetaApplications"
    DYNAMODB_BETA_TRUST_EVENTS_TABLE = "${local.prefix}BetaTrustEvents"
    # identity / infra
    DYNAMODB_PUSH_TABLE             = "${local.prefix}PushSubscriptions"
    DYNAMODB_RESET_TABLE            = "${local.prefix}PasswordResets"
    DYNAMODB_SETUP_TOKENS_TABLE     = "${local.prefix}SetupTokens"
    DYNAMODB_NOTIFICATIONS_TABLE    = "${local.prefix}Notifications"
    DYNAMODB_MEMBERSHIP_AUDIT_TABLE = "${local.prefix}MembershipAuditLogs"
    DYNAMODB_BOOTSTRAP_AUDIT_TABLE  = "${local.prefix}AdminBootstrapAttempts"
    # negotiation
    DYNAMODB_LOAD_NEGOTIATIONS_TABLE  = "${local.prefix}LoadNegotiations"
    DYNAMODB_NEGOTIATION_OFFERS_TABLE = "${local.prefix}NegotiationOffers"
    DYNAMODB_NEGOTIATION_LOCKS_TABLE  = "${local.prefix}NegotiationLocks"
    # payments / financing
    DYNAMODB_PLATFORM_FEE_POLICY_TABLE            = "${local.prefix}PlatformFeePolicy"
    DYNAMODB_ACCESSORIAL_POLICIES_TABLE           = "${local.prefix}AccessorialPolicies"
    DYNAMODB_ACCESSORIAL_POLICY_ACCEPTANCES_TABLE = "${local.prefix}AccessorialPolicyAcceptances"
    DYNAMODB_SHIPPER_AGREEMENTS_TABLE             = "${local.prefix}ShipperAgreements"
    DYNAMODB_STOP_EVENTS_TABLE                    = "${local.prefix}StopEvents"
    DYNAMODB_ACCESSORIAL_CHARGES_TABLE            = "${local.prefix}AccessorialCharges"
    DYNAMODB_CHARGE_STATUS_HISTORY_TABLE          = "${local.prefix}AccessorialChargeStatusHistory"
    DYNAMODB_FACTORING_ASSIGNMENTS_TABLE          = "${local.prefix}FactoringAssignments"
    DYNAMODB_FACTORING_PROFILES_TABLE             = "${local.prefix}CarrierFactoringProfiles"
    DYNAMODB_FACTORING_SUBMISSIONS_TABLE          = "${local.prefix}FactoringSubmissions"
    DYNAMODB_FACTOR_CONTACTS_TABLE                = "${local.prefix}FactorContacts"
    DYNAMODB_FUNDING_ADVANCES_TABLE               = "${local.prefix}FundingAdvances"
    DYNAMODB_NOTICES_OF_ASSIGNMENT_TABLE          = "${local.prefix}NoticesOfAssignment"
    DYNAMODB_RECONCILIATION_OUTCOMES_TABLE        = "${local.prefix}ReconciliationOutcomes"
    # compliance / oversight
    DYNAMODB_ADMIN_AUDIT_LOG_TABLE          = "${local.prefix}AdminAuditLog"
    DYNAMODB_COMPLIANCE_GRANTS_TABLE        = "${local.prefix}ComplianceGrants"
    DYNAMODB_ADJUDICATIONS_TABLE            = "${local.prefix}Adjudications"
    DYNAMODB_LEGAL_HOLDS_TABLE              = "${local.prefix}LegalHolds"
    DYNAMODB_LAW_ENFORCEMENT_REQUESTS_TABLE = "${local.prefix}LawEnforcementRequests"
    DYNAMODB_DISCLOSURES_TABLE              = "${local.prefix}Disclosures"
    DYNAMODB_PAYOUT_INTERCEPTS_TABLE        = "${local.prefix}PayoutIntercepts"
    # support / helpdesk
    DYNAMODB_SUPPORT_TICKETS_TABLE  = "${local.prefix}SupportTickets"
    DYNAMODB_SUPPORT_MESSAGES_TABLE = "${local.prefix}SupportMessages"
    DYNAMODB_SUPPORT_SETTINGS_TABLE = "${local.prefix}SupportSettings"
    DYNAMODB_SUPPORT_INBOUND_TABLE  = "${local.prefix}SupportInbound"
    POD_S3_BUCKET                   = "loadlead-dev-pod-uploads"
  })
  tags = local.tags
}

module "github_deploy_role" {
  source                    = "../../modules/github_oidc_role"
  env                       = local.env
  github_oidc_provider_arn  = data.aws_iam_openid_connect_provider.github.arn
  github_repo               = var.github_repo
  allowed_ref               = "refs/heads/dev" # only the dev branch can assume this role
  dynamodb_table_prefix     = local.prefix
  eb_environment_name       = module.backend.environment_name
  frontend_bucket_arn       = "arn:aws:s3:::loadlead-dev-frontend"
  frontend_distribution_arn = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${module.frontend.distribution_id}"
  tags                      = local.tags
}

data "aws_caller_identity" "current" {}

output "frontend_url" {
  value = "https://${var.dev_domain}"
}

output "backend_url" {
  value = module.backend.cname
}

output "github_deploy_role_arn" {
  value = module.github_deploy_role.role_arn
}
