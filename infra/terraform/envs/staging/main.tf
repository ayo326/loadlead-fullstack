locals {
  env    = "staging"
  prefix = "LoadLead-Staging-"
  tags = {
    Project     = "LoadLead"
    Environment = "staging"
    ManagedBy   = "Terraform"
  }

  # Deterministic backend identity — decoupled from the pausable EB env so the
  # API CloudFront origin and the deploy role keep pointing at a stable target
  # even while the env itself is torn down (paused). EB serves this env at
  # <cname_prefix>.<region>.elasticbeanstalk.com.
  backend_cname_prefix = "loadlead-backend-staging"
  backend_env_name     = "loadlead-backend-staging"
  backend_cname        = "${local.backend_cname_prefix}.us-east-1.elasticbeanstalk.com"
}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_caller_identity" "current" {}

module "network" {
  source                = "../../modules/network"
  env                   = local.env
  vpc_cidr              = "10.20.0.0/16"
  azs                   = ["us-east-1a", "us-east-1b"]
  enable_nat            = false # no NAT gateway — avoids the ~$32/mo hourly charge; instances sit in a public subnet behind the SG (like dev), egress via the free Internet Gateway
  allow_cloudfront_http = true  # SingleInstance backend is fronted by the API CloudFront below for TLS
  tags                  = local.tags
}

# Audit v4 COA-3A: staging's mirror of the new loadId-index (AccessorialCharges)
# and ownerId-index (ComplianceDocuments) GSIs arrives through this shared
# tableset module - see modules/dynamodb_tableset in the same change set.
# Audit v6 COA-3 phase 2: likewise, staging's mirror of the new carrierId-index
# (FactoringAssignments) and entityId-index (LegalHolds) GSIs arrives here via the
# same module. Prod declares those two tables directly in envs/prod/main.tf, so the
# staging mirror lives in the module rather than a staging-specific resource.
# Audit v6 M6: same again for the new Loads assignedDriverId-index - staging gets it
# via the tableset module; prod declares LoadLead_Loads in envs/prod/imported-tables.tf.
# Audit v6 H9 residual: the new LoadLead_PodAccessLog table (POD document read audit)
# arrives in staging via this tableset module; prod declares it directly in
# envs/prod/main.tf (module.ddb_pod_access_log).
module "dynamodb" {
  source              = "../../modules/dynamodb_tableset"
  env                 = local.env
  prefix              = local.prefix
  deletion_protection = false # staging data is disposable; flip to true if it starts holding anything you'd miss
  tags                = local.tags
}

# Platform alarms (audit v4 COA-3B): DDB throttles on the request-hot tables
# + EB health -> SNS. Subscribe an email in the console (or set alert_email).
module "monitoring" {
  source = "../../modules/monitoring"
  env    = local.env
  tags   = local.tags
  hot_tables = [
    "${local.prefix}Loads",
    "${local.prefix}LoadNegotiations",
    "${local.prefix}NegotiationOffers",
    "${local.prefix}AccessorialCharges",
    "${local.prefix}ComplianceDocuments",
  ]
  eb_environment_name = local.backend_env_name
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

# audit v6 H9 phase 4: the prod POD-bucket flip (envs/prod/pod-uploads-v1-
# privatize.tf) reduced to a PAB hardening once the Step-0 review found the prod
# bucket already private with a superior live delete/tamper policy. This staging
# bucket is already PAB-private with all four flags true, so it is already at the
# target posture - nothing to mirror here. Left as-is intentionally.
resource "aws_s3_bucket_cors_configuration" "pod_uploads" {
  bucket = aws_s3_bucket.pod_uploads.id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["https://${var.staging_domain}"]
    allowed_headers = ["*"]
  }
}

############################################################################
# Carrier compliance documents — KMS + S3 (SCRUM-59)
#
# W9 TIN envelope-encryption key. Dedicated, symmetric, rotation ON, one per
# env. The key policy grants ONLY the account root the ability to administer
# (the AWS-standard delegation posture); day-to-day GenerateDataKey/Decrypt is
# granted to the backend EB instance role via an IAM role policy in the
# backend_eb module (w9_tin_kms_key_arn below) — so no OTHER principal or
# service can use this key. Staging runs KMS_MODE=live (see env_vars) so this
# key exercises the real envelope path pre-prod; the alias makes the key
# rotatable/replaceable without re-wiring the env var.
############################################################################
resource "aws_kms_key" "w9_tin" {
  description             = "LoadLead staging — W9 TIN envelope encryption (SCRUM-59)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "EnableRootAccountAdmin"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })
  tags = local.tags
}

resource "aws_kms_alias" "w9_tin" {
  name          = "alias/loadlead-staging-w9-tin"
  target_key_id = aws_kms_key.w9_tin.key_id
}

# Private compliance-documents bucket. Objects (W9/COI/LOA PDFs) are served only
# via 300s presigned GET URLs from the backend. Staging data is disposable, so —
# like the staging pod bucket — NO Object Lock here; SSE + versioning + full
# public-access block match the prod bucket's baseline for behavioral parity.
resource "aws_s3_bucket" "compliance_docs" {
  bucket = "loadlead-staging-compliance-docs"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "compliance_docs" {
  bucket                  = aws_s3_bucket.compliance_docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "compliance_docs" {
  bucket = aws_s3_bucket.compliance_docs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "compliance_docs" {
  bucket = aws_s3_bucket.compliance_docs.id
  versioning_configuration { status = "Enabled" }
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

resource "aws_acm_certificate_validation" "staging" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.staging.arn
  validation_record_fqdns = [for r in aws_route53_record.staging_cert_validation : r.fqdn]
}

module "frontend" {
  source              = "../../modules/frontend"
  env                 = local.env
  bucket_name         = "loadlead-staging-frontend"
  domain_name         = var.staging_domain
  acm_certificate_arn = aws_acm_certificate_validation.staging.certificate_arn
  price_class         = "PriceClass_100"
  tags                = local.tags
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
  source = "../../modules/backend_eb"
  env    = local.env
  # Attach to the existing EB application (created by the prod stack, lowercase);
  # one EB application holds many environments. The module default
  # "LoadLead-Backend" does not exist in this account.
  application_name  = "loadlead-backend"
  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.public_subnet_ids # public subnet + public IP, no NAT cost
  elb_subnet_ids    = module.network.public_subnet_ids
  security_group_id = module.network.eb_instance_sg_id
  # t3.small (2 GB) not t3.micro (1 GB): the Node/Express app + EB enhanced-health
  # agent + nginx + log/CW agents overrun 1 GB after warm-up on t3.micro, so ~5 min
  # after a healthy deploy the instance stops sending health data ("No Data" / 504)
  # and EB cycles it (the chronic staging Grey/504). 2 GB gives the headroom to
  # stay Green. ~$15/mo running, still $0 when paused (var.backend_enabled=false).
  instance_type         = "t3.small"
  min_instances         = 1
  max_instances         = 1
  environment_type      = "SingleInstance"    # no ALB — HTTPS is terminated at the API CloudFront below
  enabled               = var.backend_enabled # pause switch: false → env torn down → $0
  cname_prefix          = local.backend_cname_prefix
  dynamodb_table_prefix = local.prefix
  # SCRUM-59: least-privilege grants for the compliance-documents feature —
  # s3:Get/PutObject on the staging compliance bucket, and kms:GenerateDataKey/
  # Decrypt on the staging W9-TIN key ONLY.
  compliance_s3_enabled    = true
  compliance_s3_bucket_arn = aws_s3_bucket.compliance_docs.arn
  w9_tin_kms_enabled       = true
  w9_tin_kms_key_arn       = aws_kms_key.w9_tin.arn
  # Audit v6 (env-parity F3): this literal block is the SECOND arg to merge(), so
  # it WINS over var.backend_env_vars (staging.auto.tfvars). Any NODE_ENV / BETA_MODE
  # / APP_ENV set in that tfvars file is DEAD - the effective values are the ones
  # below. Do not "fix" behavior by editing those tfvars keys; edit here.
  env_vars = merge(var.backend_env_vars, {
    NODE_ENV = "staging"
    # APP_ENV is the deliberate environment signal the boot guard, mode resolver
    # and self-check all key off (NOT NODE_ENV). Declare staging explicitly so it
    # doesn't fall back to 'development'. Still != 'production', so integrations
    # stay in their safe/stub default unless a mode var opts one live.
    APP_ENV = "staging"
    # Beta gate OFF in staging — it's our full-app pre-prod mirror where we
    # validate everything before prod. Only PROD runs the private-beta wall
    # (BETA_MODE defaults to on when unset, so prod needs no override).
    BETA_MODE = "off"
    # Fleet-carrier persona ENABLED in staging. Prod defaults this off (the
    # persona is muted there); staging is the full-app pre-prod mirror, so we
    # run the persona ON to validate the enabled path. Flip to "false" to
    # mirror prod's muted state - no code change, just this env var + roll.
    FLEET_CARRIER_PERSONA_ENABLED = "true"
    # W9-TIN field crypto LIVE in staging (SCRUM-59). resolveMode('kms') defaults
    # to the local stub outside production; KMS_MODE=live opts the real AWS KMS
    # envelope path on so it's validated here before prod (same "run the real
    # path in staging" posture as the persona flag above). W9_TIN_KMS_KEY_ID must
    # be set whenever KMS is live or fieldCrypto fails closed (throws) on encrypt.
    KMS_MODE          = "live"
    W9_TIN_KMS_KEY_ID = aws_kms_key.w9_tin.key_id
    FRONTEND_URL      = "https://${var.staging_domain}"

    # ── Canopy Connect (SCRUM-60) ───────────────────────────────────────────
    # Non-secret, env-specific Canopy config is committed here so it is DURABLE
    # across env recreates. The SECRETS - CANOPY_CLIENT_ID, CANOPY_CLIENT_SECRET,
    # CANOPY_WEBHOOK_SECRET - BELONG in backend_env_vars via the gitignored
    # staging.auto.tfvars (same pattern as the other integration secrets).
    # KNOWN GAP (audit v5 / EP-4, 2026-07-13): they are currently set OUT-OF-BAND
    # directly on the EB env and are NOT yet in tfvars, so a full env recreate
    # WILL wipe all three (it already happened once, for the t3.small /
    # launch-template migration). TODO: move them into backend_env_vars + apply.
    # connectEnabled (canopyConfig.ts) = Boolean(clientId && clientSecret &&
    # publicAlias); the FE CanopyConnectCard renders only when it is true.
    # CANOPY_ENV left unset = sandbox (bootGuard treats canopy like didit: never
    # live outside prod). publicAlias is the browser-safe SDK slug, not a secret.
    CANOPY_UI_MODE      = "widget"
    CANOPY_PUBLIC_ALIAS = "loadlead"

    # ── DynamoDB table names ────────────────────────────────────────────────
    # ONE prefix knob instead of ~50 per-table overrides. environment.ts derives
    # every config.dynamodb table as `prefix + (default minus its LoadLead_ stem)`
    # -> e.g. LoadLead_Users becomes LoadLead-Staging-Users, byte-identical to the
    # values these enumerated vars used to set. This collapse is what keeps the EB
    # EnvironmentVariables aggregate under CloudFormation's 4096-char cap (the full
    # enumeration busted it and blocked the SCRUM-59 env update). Prod sets NO
    # prefix, so it falls through to the LoadLead_* defaults - prod is unchanged.
    DYNAMODB_TABLE_PREFIX = local.prefix

    # Service-file-direct tables: these are read as process.env.* inside service
    # files with NO config.dynamodb slot, so the prefix deriver doesn't reach them
    # and each still needs an explicit override. (Migrating these into config would
    # let them ride the prefix too - future cleanup.)
    DYNAMODB_OWNER_OPERATORS_TABLE    = "${local.prefix}OwnerOperators"
    DYNAMODB_FLEET_INVITES_TABLE      = "${local.prefix}FleetInvites"
    DYNAMODB_VERIFICATIONS_TABLE      = "${local.prefix}Verifications"
    DYNAMODB_FACTORING_OPTINS_TABLE   = "${local.prefix}FactoringOptIns"
    DYNAMODB_FACTORING_PROFILES_TABLE = "${local.prefix}CarrierFactoringProfiles"
    DYNAMODB_PUSH_TABLE               = "${local.prefix}PushSubscriptions"
    DYNAMODB_RESET_TABLE              = "${local.prefix}PasswordResets"
    DYNAMODB_SETUP_TOKENS_TABLE       = "${local.prefix}SetupTokens"
    DYNAMODB_NOTIFICATIONS_TABLE      = "${local.prefix}Notifications"
    DYNAMODB_BOOTSTRAP_AUDIT_TABLE    = "${local.prefix}AdminBootstrapAttempts"

    COMPLIANCE_S3_BUCKET = aws_s3_bucket.compliance_docs.bucket
    POD_S3_BUCKET        = "loadlead-staging-pod-uploads"
  })
  tags = local.tags
}

############################################################################
# API HTTPS — the cheapest-tier alternative to an ALB. A dedicated CloudFront
# distribution terminates TLS for api-staging.loadleadapp.com and forwards to
# the SingleInstance EB env over HTTP. The origin is the DETERMINISTIC EB
# CNAME (local.backend_cname), not the module output, so this distribution is
# unaffected when the backend is paused — it just returns 502 until resume.
############################################################################

# Resolve the AWS-managed CloudFront policies by name (their IDs are not stable
# to hardcode across accounts/partitions). CachingDisabled = never cache the
# API; AllViewerExceptHostHeader = forward all query strings/cookies/headers
# EXCEPT Host, so the EB custom origin receives its own hostname.
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_acm_certificate" "api" {
  provider          = aws.us_east_1
  domain_name       = var.api_staging_domain
  validation_method = "DNS"
  tags              = local.tags
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "api" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]
}

resource "aws_cloudfront_distribution" "api" {
  enabled = true
  comment = "loadlead-staging-api"
  aliases = [var.api_staging_domain]

  origin {
    domain_name = local.backend_cname
    origin_id   = "eb-backend"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # EB SingleInstance serves plain HTTP; CloudFront adds the TLS
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "eb-backend"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  price_class = "PriceClass_100"

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.api.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(local.tags, { Name = "loadlead-staging-api" })
}

resource "aws_route53_record" "api_alias" {
  zone_id = var.route53_zone_id
  name    = var.api_staging_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.api.domain_name
    zone_id                = "Z2FDTNDATAQYW2" # CloudFront's fixed hosted zone ID
    evaluate_target_health = false
  }
}

module "github_deploy_role" {
  source                   = "../../modules/github_oidc_role"
  env                      = local.env
  github_oidc_provider_arn = data.aws_iam_openid_connect_provider.github.arn
  github_repo              = var.github_repo
  # The deploy-staging job runs with `environment: staging`, so the GitHub
  # OIDC token's sub claim is environment-scoped (repo:...:environment:staging),
  # NOT the branch ref. Trust the environment to match (prod does the same with
  # allowed_environment = "production"). Using allowed_ref here made the live
  # trust condition ref:refs/heads/main, which never matches the environment
  # sub, so every staging deploy failed sts:AssumeRoleWithWebIdentity.
  allowed_environment = "staging"
  # Must match the REAL EB application (lowercase "loadlead-backend", created by
  # the prod stack and shared). Omitting this defaulted to the module's
  # "LoadLead-Backend", so the policy's applicationversion/environment ARNs did
  # not match and CreateApplicationVersion was denied.
  eb_application_name       = "loadlead-backend"
  dynamodb_table_prefix     = local.prefix
  eb_environment_name       = local.backend_env_name # deterministic - valid even while the env is paused
  frontend_bucket_arn       = "arn:aws:s3:::loadlead-staging-frontend"
  frontend_distribution_arn = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${module.frontend.distribution_id}"
  tags                      = local.tags
}

output "frontend_url" {
  value = "https://${var.staging_domain}"
}

output "api_url" {
  value = "https://${var.api_staging_domain}"
}

output "backend_eb_cname" {
  description = "Direct EB CNAME (HTTP origin behind the API CloudFront). Null while paused."
  value       = module.backend.cname
}

output "backend_enabled" {
  description = "Whether the billable EB env is currently up (true) or paused to $0 (false)."
  value       = var.backend_enabled
}

output "github_deploy_role_arn" {
  value = module.github_deploy_role.role_arn
}
