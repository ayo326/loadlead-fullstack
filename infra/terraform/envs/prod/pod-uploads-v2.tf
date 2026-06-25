############################################################################
# pod-uploads-v2.tf — POD photo bucket A-tier: immutable BY DESIGN.
#
# v1 (loadlead-pod-uploads) is delete-resistant by bucket policy: Deny on
# DeleteObject/Version. Same effective protection in normal operation,
# but the policy itself can be lifted by anyone with PutBucketPolicy,
# so it's "by-policy" not "by-design."
#
# v2 (this file) is Object Lock COMPLIANCE on the bucket. AWS API
# REFUSES to shorten retention or hard-delete versions, even from
# root. Same posture as the signatures WORM sink — see worm-sink.tf.
#
# Migration (current state: only the 3 e2e photos in v1):
#   1. This TF creates v2 with Object Lock at CREATION TIME.
#   2. Out-of-band: `aws s3 sync v1 v2` while v1 still receives writes.
#   3. EB env: set POD_S3_BUCKET=loadlead-pod-uploads-v2  +  redeploy.
#   4. v1 becomes read-only (kept for back-reference only).
#   5. (Phase 3) retire v1 — long after all hot loads have rolled over.
#
# Object Lock CANNOT be added to an existing bucket — that's why v2 is
# a new bucket, not an in-place change. Same constraint as the
# signatures WORM bucket.
############################################################################

resource "aws_s3_bucket" "pod_uploads_v2" {
  bucket              = "loadlead-pod-uploads-v2"
  object_lock_enabled = true # MUST be set at create time

  tags = merge(local.tags, { Component = "attestation-pod", Tier = "legal-evidence" })
}

resource "aws_s3_bucket_versioning" "pod_uploads_v2" {
  bucket = aws_s3_bucket.pod_uploads_v2.id
  versioning_configuration {
    status = "Enabled" # required for Object Lock
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "pod_uploads_v2" {
  bucket = aws_s3_bucket.pod_uploads_v2.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "pod_uploads_v2" {
  bucket                  = aws_s3_bucket.pod_uploads_v2.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS for browser-driven uploads via presigned URLs (Phase 1 client flow).
# Matches the v1 bucket's effective CORS.
resource "aws_s3_bucket_cors_configuration" "pod_uploads_v2" {
  bucket = aws_s3_bucket.pod_uploads_v2.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = [
      "https://app.loadleadapp.com",
      "https://admin.loadleadapp.com",
    ]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# NOTE: Object Lock is enabled on the bucket (set at create time, see
# aws_s3_bucket.pod_uploads_v2.object_lock_enabled), but we deliberately
# do NOT set a bucket-level DefaultRetention here.
#
# Why: Bucket-level default retention forces AWS to require
# Content-MD5 (or x-amz-checksum-*) on every PutObject. The browser
# presigned-URL upload flow can't reliably compute that for arbitrary
# blobs without client-side changes, so a bucket-default lock breaks
# the existing presign → PUT contract.
#
# Instead: the server applies Object Lock per-object during the
# finalizeUpload step (podPhotoService.ts), which runs AFTER the bytes
# land and after the sha256 hash is computed. This is the same
# COMPLIANCE-mode lock with 2555d retention — applied with full
# server-controlled provenance rather than client-side.
#
# The bucket policy below still denies s3:DeleteObject so the same
# delete-resistant posture applies whether or not the per-object lock
# has been set yet.

# Sentinel object so anyone running `aws s3api get-object-lock-configuration`
# on this bucket sees a clear "enabled but no default retention" answer
# rather than an unhelpful 404. AWS returns
# ObjectLockConfiguration.ObjectLockEnabled: "Enabled" once the bucket
# is created with object_lock_enabled = true; no extra config needed.

# Deny s3:DeleteObject / s3:DeleteObjectVersion at the policy level, same
# pattern as the signatures WORM bucket — Object Lock alone allows
# delete-marker creation which hides the object without removing it. We
# want apparent deletes to fail loudly.
resource "aws_s3_bucket_policy" "pod_uploads_v2_no_delete" {
  bucket = aws_s3_bucket.pod_uploads_v2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyAllDeletes"
      Effect    = "Deny"
      Principal = "*"
      Action    = [
        "s3:DeleteObject",
        "s3:DeleteObjectVersion",
        "s3:DeleteObjectTagging",
        "s3:DeleteObjectVersionTagging",
      ]
      Resource = "${aws_s3_bucket.pod_uploads_v2.arn}/*"
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.pod_uploads_v2]
}

output "pod_uploads_v2_bucket" { value = aws_s3_bucket.pod_uploads_v2.bucket }
output "pod_uploads_v2_arn"    { value = aws_s3_bucket.pod_uploads_v2.arn }
