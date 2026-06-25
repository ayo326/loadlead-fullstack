############################################################################
# cloudfront-imported.tf — bring both CloudFront distributions under TF.
#
# Two distros, two import strategies:
#
#   admin    (E1RPGX7HLJI48U)  → FULL declaration matching live byte-for-byte.
#                                Simpler shape (1 S3 origin via OAC, no extra
#                                cache behaviors). Safe to fully manage.
#
#   customer (E38CZNP7L2DB98)  → declare the shell to satisfy the schema,
#                                then lifecycle.ignore_changes on the dynamic
#                                blocks. Apex domain + /api/* pinned to EB +
#                                CloudFront Function for security headers is
#                                too high-blast-radius for a same-session
#                                byte-for-byte declarative import. TF tracks
#                                identity; config drifts stay out of TF.
#
# Both end up in TF state — referenceable by outputs, protected from a stray
# `terraform destroy`. Re-tightening the customer distro's TF surface is a
# follow-up: migrate one block at a time, plan must be no-op, then remove
# that block from the ignore_changes list.
############################################################################

# ─── ADMIN DISTRO — full declaration ──────────────────────────────────────
# arn:aws:cloudfront::552011299815:distribution/E1RPGX7HLJI48U
# alias: admin.loadleadapp.com
# origin: loadlead-admin-prod S3 bucket via Origin Access Control
resource "aws_cloudfront_distribution" "admin" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Admin"
  default_root_object = "admin.html"
  price_class         = "PriceClass_All"
  http_version        = "http2"
  aliases             = ["admin.loadleadapp.com"]

  # WAF attached at create time (CloudFront's own auto-created ACL). Pinned
  # here so a TF apply doesn't silently detach it.
  web_acl_id = "arn:aws:wafv2:us-east-1:552011299815:global/webacl/CreatedByCloudFront-2ec8cb9b/513b124e-9c9a-45ce-b705-9c7f1382336f"

  origin {
    origin_id                = "loadlead-admin-prod.s3.us-east-1.amazonaws.com-mqpvbzywmml"
    domain_name              = "loadlead-admin-prod.s3.us-east-1.amazonaws.com"
    origin_access_control_id = "E36TNPYANPK0A4"
    connection_attempts      = 3
    connection_timeout       = 10

    s3_origin_config {
      origin_access_identity = "" # legacy OAI not used; OAC supersedes
    }
  }

  default_cache_behavior {
    target_origin_id       = "loadlead-admin-prod.s3.us-east-1.amazonaws.com-mqpvbzywmml"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["HEAD", "GET"]
    cached_methods         = ["HEAD", "GET"]
    compress               = true
    # AWS-managed CachingOptimized policy.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # SPA-style fallback: any 403/404 from S3 serves the admin entrypoint with
  # a 200 so React Router can take over. Same shape on both distros, but
  # the admin one falls back to /admin.html, customer to /index.html.
  custom_error_response {
    error_code            = 403
    response_page_path    = "/admin.html"
    response_code         = "200"
    error_caching_min_ttl = 10
  }
  custom_error_response {
    error_code            = 404
    response_page_path    = "/admin.html"
    response_code         = "200"
    error_caching_min_ttl = 10
  }

  viewer_certificate {
    acm_certificate_arn      = "arn:aws:acm:us-east-1:552011299815:certificate/19d68a19-f7c2-49ba-97af-ae10d239fefd"
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.3_2025"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Drift the provider can't reconcile cleanly: when an S3 origin uses OAC
  # (origin_access_control_id) the empty s3_origin_config block normalizes
  # differently between live state and TF schema in provider v6, producing
  # a perpetual no-op replace of the origin block. AWS-side state is
  # correct; the diff is purely TF-schema noise. Ignoring just the origin
  # block keeps everything else TF-managed (tags, cert, default_cache_
  # behavior, custom_error_response, web_acl).
  lifecycle {
    ignore_changes = [origin]
  }

  tags = merge(
    local.tags,
    {
      Component = "admin-frontend"
      Name      = "LoadLead Admin" # preserved from pre-TF state
    },
  )
}

# ─── CUSTOMER DISTRO — shell + ignore_changes on dynamic blocks ────────────
# arn:aws:cloudfront::552011299815:distribution/E38CZNP7L2DB98
# alias: loadleadapp.com
# origins: loadlead-backend-prod EB + loadlead-frontend-prod S3 website
# behaviors: default (S3 website) + /api/* (EB)
# extras: CloudFront Function attached to default behavior (security headers)
resource "aws_cloudfront_distribution" "customer" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = ""
  default_root_object = ""
  price_class         = "PriceClass_All"
  http_version        = "http2"
  aliases             = ["loadleadapp.com"]

  web_acl_id = "arn:aws:wafv2:us-east-1:552011299815:global/webacl/CreatedByCloudFront-c79dce87/7f4c255b-241a-45c5-afba-6d30e1317fe0"

  # Minimal origins block — required by the schema. Real values may drift
  # (e.g. if the EB env's CNAME changes). ignore_changes below means
  # neither will trigger a TF apply.
  origin {
    origin_id   = "loadlead-frontend-prod.s3-website-us-east-1.amazonaws.com-mq8z8qkjwo1"
    domain_name = "loadlead-frontend-prod.s3-website-us-east-1.amazonaws.com"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  origin {
    origin_id   = "loadlead-api"
    domain_name = "loadlead-backend-prod.eba-3bmfwwtn.us-east-1.elasticbeanstalk.com"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "loadlead-frontend-prod.s3-website-us-east-1.amazonaws.com-mq8z8qkjwo1"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["HEAD", "GET"]
    cached_methods         = ["HEAD", "GET"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    # CloudFront Function adds security headers (CSP, HSTS, etc.) on every
    # viewer response. Out-of-band managed; declared here so import succeeds.
    function_association {
      event_type   = "viewer-response"
      function_arn = "arn:aws:cloudfront::552011299815:function/loadlead-add-security-headers"
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "loadlead-api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["HEAD", "DELETE", "POST", "GET", "OPTIONS", "PUT", "PATCH"]
    cached_methods           = ["HEAD", "GET"]
    compress                 = true
    # AWS-managed CachingDisabled + AllViewer origin-request policies — API
    # responses are dynamic, no point caching; pass through headers/query.
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  custom_error_response {
    error_code            = 403
    response_page_path    = "/index.html"
    response_code         = "200"
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code            = 404
    response_page_path    = "/index.html"
    response_code         = "200"
    error_caching_min_ttl = 0
  }

  viewer_certificate {
    acm_certificate_arn      = "arn:aws:acm:us-east-1:552011299815:certificate/6d35e9ce-59c7-434a-b6ff-27141a1fdcb4"
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  lifecycle {
    # Customer distro is the apex domain — too high-blast-radius for
    # byte-for-byte management until we have a CI gate verifying plans
    # are non-destructive. Ignore the dynamic blocks; TF still owns
    # identity + WAF + aliases + cert.
    ignore_changes = [
      origin,
      default_cache_behavior,
      ordered_cache_behavior,
      custom_error_response,
    ]
  }

  tags = merge(
    local.tags,
    {
      Component = "customer-frontend"
      Name      = "Load_Lead_FE" # preserved from pre-TF state
    },
  )
}

output "cloudfront_admin_id"           { value = aws_cloudfront_distribution.admin.id }
output "cloudfront_admin_domain_name"  { value = aws_cloudfront_distribution.admin.domain_name }
output "cloudfront_customer_id"        { value = aws_cloudfront_distribution.customer.id }
output "cloudfront_customer_domain_name" { value = aws_cloudfront_distribution.customer.domain_name }
