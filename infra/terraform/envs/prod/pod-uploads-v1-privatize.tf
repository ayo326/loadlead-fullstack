############################################################################
# pod-uploads-v1-privatize.tf - audit v6 H9 phase 4 (THE FLIP, SCRUM-59).
#
# Privatize the LIVE, in-use POD bucket loadlead-pod-uploads IN PLACE. This
# bucket predates the IaC and is NOT a terraform-managed aws_s3_bucket (it was
# created out-of-band; its public-read grant lives only on the live bucket).
# PODs are proof-of-delivery: signatures, addresses, legal evidence. After
# phases 2+3, every read is served through a short-lived signed GET behind the
# chain-party resolver, and uploads are size-capped presigned POSTs. Nothing in
# the app depends on public reads anymore, so we close the bucket.
#
# WHY WE ATTACH BY NAME, NOT `terraform import` OF THE BUCKET:
# We deliberately do NOT bring the aws_s3_bucket itself under management. If TF
# owned the bucket resource, a future `-target` destroy or an accidental block
# removal could delete a bucket holding legal evidence. Instead we attach only
# the public-access-block, bucket policy, and an IAM role grant - all keyed by
# the bucket NAME. TF never owns the bucket lifecycle, so it can never delete
# it. This is the "standalone PAB" option the H9 plan calls out.
#
# The privatizing control is the public-access-block. With
# restrict_public_buckets + ignore_public_acls = true, S3 IGNORES any public
# statement still present in the live bucket policy and any public ACL, so the
# bucket is private the instant the PAB applies - independent of the policy
# swap below. The bucket policy resource then REPLACES the live out-of-band
# policy with a clean deny-all-deletes (dropping the now-inert public-read
# statement while preserving delete-resistance).
#
# THIS FILE IS NOT APPLIED BY THIS PR. Apply is a gated, human-run step - see
# docs/H9-POD-BUCKET-FLIP-RUNBOOK.md. The runbook REQUIRES capturing the live
# bucket policy and reviewing the plan diff before apply, and documents a
# PAB-only conservative path (-target the public_access_block first).
#
# Constraints honored: bucket name comes from config (equals the code default
# in podStorage.ts / POD_S3_BUCKET), not invented here; no deletes granted; no
# em/en dashes; the Load model is untouched.
############################################################################

locals {
  # Canonical prod POD bucket. Equals podStorage.ts `config.pod.bucket` default
  # and driver.ts `POD_S3_BUCKET || 'loadlead-pod-uploads'`. Same convention as
  # compliance-documents.tf (bucket literal == the code default).
  pod_v1_bucket     = "loadlead-pod-uploads"
  pod_v1_bucket_arn = "arn:aws:s3:::loadlead-pod-uploads"
}

# ── The privatizing control ────────────────────────────────────────────────
# All four true. restrict_public_buckets + ignore_public_acls make S3 ignore
# the live public-read policy statement and any public ACL immediately; the
# bucket is private the moment this applies. block_public_policy additionally
# rejects any FUTURE attempt to re-add a public statement.
resource "aws_s3_bucket_public_access_block" "pod_uploads_v1" {
  bucket                  = local.pod_v1_bucket
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Clean bucket policy: deny-all-deletes, no public grant ──────────────────
# Same delete-resistant posture as pod-uploads-v2 / the compliance-docs bucket.
# This REPLACES the live out-of-band policy: it drops the (now-inert) public
# read statement and keeps deletes denied so apparent deletes fail loudly.
# depends_on the PAB so the bucket is already private before the policy is
# swapped - there is no public window at any point.
#
# OVERWRITE SAFETY: the live policy is expected to contain exactly a public-read
# grant plus this deny-delete. The runbook mandates `aws s3api get-bucket-policy`
# capture + a plan-diff review before apply, with a hard STOP if the live policy
# carries any statement beyond those two. block_public_policy = true means S3
# would itself reject this Put if it were public - it is not (Deny only).
resource "aws_s3_bucket_policy" "pod_uploads_v1_no_delete" {
  bucket = local.pod_v1_bucket

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyAllDeletes"
      Effect    = "Deny"
      Principal = "*"
      Action = [
        "s3:DeleteObject",
        "s3:DeleteObjectVersion",
        "s3:DeleteObjectTagging",
        "s3:DeleteObjectVersionTagging",
      ]
      Resource = "${local.pod_v1_bucket_arn}/*"
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.pod_uploads_v1]
}

# ── Codify the backend EB role grant on this bucket ─────────────────────────
# data.aws_iam_role.eb_backend ("aws-elasticbeanstalk-ec2-role") is the prod
# backend instance-profile role, declared in imported-tables.tf and reused by
# compliance-documents.tf. The role already has an out-of-band Get/Put grant on
# this bucket (it does the finalize byte-read today); this ADDS an inline policy
# so the grant is codified, reviewable, and least-privilege. Adding an inline
# policy is purely additive - it cannot remove the existing out-of-band access.
# GetObject (sign + finalize read) and PutObject only. No deletes (append-only).
resource "aws_iam_role_policy" "pod_uploads_v1_backend_access" {
  name = "loadlead-prod-pod-uploads-access"
  role = data.aws_iam_role.eb_backend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "S3PodUploadsObjectRW"
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = ["${local.pod_v1_bucket_arn}/*"]
    }]
  })
}

output "pod_uploads_v1_bucket" { value = local.pod_v1_bucket }
output "pod_uploads_v1_arn" { value = local.pod_v1_bucket_arn }
