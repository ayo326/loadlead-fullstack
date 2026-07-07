############################################################################
# S3 (private, OAC-only access) + CloudFront, for the Next.js static export.
# Mirrors the existing prod hosting model (S3 + CloudFront E38CZNP7L2DB98) —
# `next build && next export` (or `output: 'export'`) produces a static
# `out/` directory that gets synced here by CI.
############################################################################

resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
  tags   = merge(var.tags, { Name = var.bucket_name, Environment = var.env })
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration { status = "Enabled" }
}

# Old object versions are dead weight in dev/staging — expire after 14 days.
resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {} # applies to every object; silences the provider's required-filter warning
    noncurrent_version_expiration { noncurrent_days = 14 }
  }
}

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = "loadlead-${var.env}-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = var.price_class
  aliases             = var.domain_name == null ? [] : [var.domain_name]
  comment             = "loadlead-${var.env}-frontend"

  origin {
    domain_name              = aws_s3_bucket.this.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # AWS managed: CachingOptimized
  }

  # frontend-v2 is a client-routed Vite SPA (not per-route static HTML), so a
  # deep-route refresh hits an S3 key that doesn't exist. With the private
  # OAC-only bucket (no s3:ListBucket), a missing key returns 403, not 404 —
  # so BOTH codes must fall back to the SPA entrypoint with a 200 to let the
  # router take over. error_caching_min_ttl = 0 keeps CloudFront from caching
  # the fallback, so a real key that appears on the next deploy is served
  # immediately. Mirrors the prod customer distro (E38CZNP7L2DB98).
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.domain_name == null
    acm_certificate_arn            = var.domain_name == null ? null : var.acm_certificate_arn
    ssl_support_method             = var.domain_name == null ? null : "sni-only"
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = merge(var.tags, { Name = "loadlead-${var.env}-frontend", Environment = var.env })
}

data "aws_iam_policy_document" "s3_oac_only" {
  statement {
    sid       = "AllowCloudFrontOAC"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.s3_oac_only.json
}
