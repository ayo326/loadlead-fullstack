############################################################################
# frontend-buckets-imported.tf — the two static-site origin buckets that
# back the CloudFront distros declared in cloudfront-imported.tf.
#
#   loadlead-frontend-prod  (customer site)
#     - PUBLIC bucket, served via S3 website endpoint
#     - PublicReadGetObject policy lets anyone HTTP GET /*
#     - CloudFront default behavior pulls from the website endpoint
#       (custom_origin_config, not s3_origin_config)
#
#   loadlead-admin-prod  (admin app)
#     - PRIVATE bucket, all-public-access blocked
#     - Bucket policy only admits the admin CloudFront distro via OAC
#       (Condition: AWS:SourceArn = arn:aws:cloudfront::552011299815:distribution/E1RPGX7HLJI48U)
#     - This is the "modern" OAC pattern; customer bucket should migrate
#       to this someday (logged as a backlog item, not in this commit).
#
# Both buckets contain ~11 SPA artifacts. They're rewritten on every
# frontend deploy; their CONTENTS aren't TF-managed. Only the bucket
# config (public access, encryption, website hosting, policy) is.
############################################################################

# ─── CUSTOMER FRONTEND BUCKET (public, website hosting) ───────────────────
resource "aws_s3_bucket" "frontend_customer" {
  bucket = "loadlead-frontend-prod"

  tags = merge(
    local.tags,
    {
      Component = "customer-frontend"
      Name      = "loadlead-frontend-prod"
    },
  )
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend_customer" {
  bucket = aws_s3_bucket.frontend_customer.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# Customer bucket is intentionally PUBLIC — it's served via the S3 website
# endpoint as the CloudFront origin. All four flags = false matches the
# pre-TF reality. Tightening to OAC + private bucket would also require
# changing the CloudFront origin from custom_origin_config to s3_origin_
# config; flagged as a backlog migration, NOT a config change here.
resource "aws_s3_bucket_public_access_block" "frontend_customer" {
  bucket                  = aws_s3_bucket.frontend_customer.id
  block_public_acls       = false
  ignore_public_acls      = false
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_website_configuration" "frontend_customer" {
  bucket = aws_s3_bucket.frontend_customer.id

  index_document {
    suffix = "index.html"
  }

  # SPA fallback: 404s also serve index.html so React Router can handle
  # client-side routes. Matches the CloudFront custom_error_response
  # behavior — belt + suspenders.
  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_policy" "frontend_customer" {
  bucket = aws_s3_bucket.frontend_customer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadGetObject"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend_customer.arn}/*"
    }]
  })
}

# ─── ADMIN FRONTEND BUCKET (private, OAC-restricted to CF distro) ─────────
resource "aws_s3_bucket" "frontend_admin" {
  bucket = "loadlead-admin-prod"

  tags = merge(
    local.tags,
    {
      Component = "admin-frontend"
      Name      = "loadlead-admin-prod"
      Surface   = "admin" # preserved from pre-TF state
    },
  )
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend_admin" {
  bucket = aws_s3_bucket.frontend_admin.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "frontend_admin" {
  bucket                  = aws_s3_bucket.frontend_admin.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# Admin bucket policy = CloudFront-only access via OAC. Pinned to the
# admin distro's ARN by Condition.AWS:SourceArn so even if someone else
# discovered the bucket name, only this CF distro can pull from it.
#
# Note the policy Version is "2008-10-17" (matches live, set by the AWS
# console when the bucket was wired up to OAC). The slightly older version
# is functionally identical to 2012-10-17 for this policy shape; kept as-is
# to make `tofu plan` a no-op against pre-TF state.
resource "aws_s3_bucket_policy" "frontend_admin" {
  bucket = aws_s3_bucket.frontend_admin.id
  policy = jsonencode({
    Version = "2008-10-17"
    Id      = "PolicyForCloudFrontPrivateContent"
    Statement = [{
      Sid       = "AllowCloudFrontServicePrincipal"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend_admin.arn}/*"
      Condition = {
        ArnLike = {
          "AWS:SourceArn" = aws_cloudfront_distribution.admin.arn
        }
      }
    }]
  })
}

output "frontend_customer_bucket" { value = aws_s3_bucket.frontend_customer.bucket }
output "frontend_admin_bucket"    { value = aws_s3_bucket.frontend_admin.bucket }
