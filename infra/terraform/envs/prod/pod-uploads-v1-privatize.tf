############################################################################
# pod-uploads-v1-privatize.tf - audit v6 H9 phase 4 (THE FLIP, SCRUM-59).
#
# Harden the live, in-use POD bucket loadlead-pod-uploads. This bucket predates
# the IaC and is NOT a terraform-managed aws_s3_bucket (created out-of-band).
# PODs are proof-of-delivery: signatures, addresses, legal evidence.
#
# WHAT THE STEP-0 BASELINE REVIEW FOUND (see docs/H9-POD-BUCKET-FLIP-RUNBOOK.md):
# the bucket is ALREADY PRIVATE. All public-URL styles return 403; there is no
# public bucket policy, no public bucket ACL, and no public object ACL. The live
# bucket policy is a bespoke self-protection ("DenyDeleteAndPolicyTamper") that
# denies the EB role s3:DeleteObject/Version AND s3:PutBucketPolicy/
# DeleteBucketPolicy/PutLifecycleConfiguration/PutBucketVersioning on the bucket
# and its objects. That live policy is STRONGER than a plain deny-all-deletes,
# so we deliberately do NOT bring it under Terraform - overwriting it would
# regress the tamper-protection. It is left exactly as-is.
#
# So this file does two safe, additive things and nothing else:
#   1. Tighten the public-access-block. The live PAB has BlockPublicAcls +
#      IgnorePublicAcls true but BlockPublicPolicy + RestrictPublicBuckets
#      FALSE - meaning a future public bucket policy could still take effect.
#      Setting all four true closes that door permanently. No current access is
#      affected: all legitimate reads are signed URLs by authorized principals,
#      and there is no public policy for RestrictPublicBuckets to restrict.
#   2. Codify the backend EB role's Get/PutObject grant on this bucket (additive
#      inline policy; the out-of-band grant already exists).
#
# We attach both by bucket NAME - we never import the aws_s3_bucket itself, so
# Terraform can never delete a bucket holding legal evidence.
#
# THIS FILE IS APPLIED BY A GATED, HUMAN-RUN STEP (the runbook), not silently.
# Constraints honored: bucket name from config (equals the code default in
# podStorage.ts / POD_S3_BUCKET); no deletes granted; the live delete/tamper
# policy is untouched; no em/en dashes; the Load model is untouched.
############################################################################

locals {
  # Canonical prod POD bucket. Equals podStorage.ts `config.pod.bucket` default
  # and driver.ts `POD_S3_BUCKET || 'loadlead-pod-uploads'`. Same convention as
  # compliance-documents.tf (bucket literal == the code default).
  pod_v1_bucket     = "loadlead-pod-uploads"
  pod_v1_bucket_arn = "arn:aws:s3:::loadlead-pod-uploads"
}

# ── Tighten the public-access-block (defense in depth) ─────────────────────
# The bucket is already private; this flips the two still-false flags to true so
# no FUTURE public bucket policy can ever take effect. Purely additive - it
# grants nothing and removes no current, legitimate (signed / authorized)
# access. block_public_acls + ignore_public_acls are already true today.
resource "aws_s3_bucket_public_access_block" "pod_uploads_v1" {
  bucket                  = local.pod_v1_bucket
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Codify the backend EB role grant on this bucket ─────────────────────────
# data.aws_iam_role.eb_backend ("aws-elasticbeanstalk-ec2-role") is the prod
# backend instance-profile role, declared in imported-tables.tf and reused by
# compliance-documents.tf. The role already has an out-of-band Get/Put grant on
# this bucket (it does the finalize byte-read and signs GET URLs today); this
# ADDS an inline policy so the grant is codified, reviewable, and least-
# privilege. Adding an inline policy is purely additive - it cannot remove the
# existing out-of-band access, and it does NOT touch the live bucket policy that
# denies this same role s3:DeleteObject/tamper (Deny always wins; the two do not
# overlap - this Allow is Get/Put only, no deletes).
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
