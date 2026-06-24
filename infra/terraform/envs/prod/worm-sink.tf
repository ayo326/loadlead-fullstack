############################################################################
# worm-sink.tf — second-copy LEGAL EVIDENCE store for LoadLead_Signatures.
#
# Architecture:
#   LoadLead_Signatures table  (already append-only, IAM-Deny on Update/Delete)
#       │
#       │ DDB Streams (NEW_IMAGE)   ← enabled via stream_enabled on the module
#       ▼
#   AWS Lambda (lambda/signatures-worm-sink/index.mjs)
#       │
#       │ PutObject ObjectLockMode=COMPLIANCE  RetainUntil=now+7y
#       ▼
#   s3://loadlead-signatures-worm-sink/loads/:loadId/:signatureId.json
#       (versioning ON, public access blocked, Object Lock COMPLIANCE on bucket)
#
# Why this is true WORM, not delete-resistant:
#   - Object Lock COMPLIANCE = AWS API will REJECT PutObjectRetention to
#     shorten retention, even from root. Only valid escape is to delete
#     the AWS account.
#   - Contrast with the primary loadlead-pod-uploads bucket which is
#     delete-resistant via Deny-on-Delete bucket policy: same protection
#     in normal operation, but the policy itself can be lifted by anyone
#     who can edit the bucket policy. That's by-policy, not by-design.
#   - Phase 1d audit doc was explicit: "B is delete-resistant by policy.
#     A is immutable by design." This is the A-tier sink for signatures.
############################################################################

# ── S3 bucket — Object Lock enabled at CREATION TIME (can't be added later) ──
resource "aws_s3_bucket" "signatures_worm" {
  bucket              = "loadlead-signatures-worm-sink"
  object_lock_enabled = true

  tags = merge(local.tags, { Component = "attestation-worm", Tier = "legal-evidence" })
}

resource "aws_s3_bucket_versioning" "signatures_worm" {
  bucket = aws_s3_bucket.signatures_worm.id

  versioning_configuration {
    status = "Enabled" # required for Object Lock
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "signatures_worm" {
  bucket = aws_s3_bucket.signatures_worm.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# Bucket policy — deny s3:DeleteObject and s3:DeleteObjectVersion outright.
#
# Object Lock COMPLIANCE prevents PERMANENT data deletion, but a user with
# s3:DeleteObject can still create a "delete marker" (versioned-bucket
# behavior) which hides the object from default GETs. The underlying data
# is recoverable via versionId, but anyone watching the bucket sees an
# apparent successful delete.
#
# For legal-evidence WORM we want apparent deletes to FAIL LOUDLY. The
# Lambda role uses s3:PutObject only — it has no business deleting. Deny
# both DeleteObject (the marker-creation API) and DeleteObjectVersion
# (the permanent-delete API; would-fail anyway against Object Lock but
# we want a clean policy denial instead of a per-object lock denial).
resource "aws_s3_bucket_policy" "signatures_worm_no_delete" {
  bucket = aws_s3_bucket.signatures_worm.id

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
      Resource = "${aws_s3_bucket.signatures_worm.arn}/*"
    }]
  })

  # Apply after public-access-block so the bucket can't briefly accept a
  # policy with public access blocked-but-not-locked.
  depends_on = [aws_s3_bucket_public_access_block.signatures_worm]
}

resource "aws_s3_bucket_public_access_block" "signatures_worm" {
  bucket                  = aws_s3_bucket.signatures_worm.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Object Lock CONFIGURATION — applies a default retention to every new
# object. The Lambda also sets ObjectLockMode/RetainUntil per-PutObject
# so this is belt-and-suspenders; the bucket-level default is the safety
# net for any future writer that forgets the per-object lock fields.
resource "aws_s3_bucket_object_lock_configuration" "signatures_worm" {
  bucket = aws_s3_bucket.signatures_worm.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 2555 # ~7 years — IRS business records retention. Cannot be shortened in COMPLIANCE mode.
    }
  }

  depends_on = [aws_s3_bucket_versioning.signatures_worm]
}

# ── Lambda zip ─────────────────────────────────────────────────────────────
data "archive_file" "signatures_worm_sink_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/signatures-worm-sink"
  output_path = "${path.module}/.build/signatures-worm-sink.zip"
  excludes    = [".build"]
}

# ── IAM role for the Lambda ────────────────────────────────────────────────
resource "aws_iam_role" "signatures_worm_sink_lambda" {
  name = "loadlead-prod-signatures-worm-sink-lambda"

  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "signatures_worm_sink_lambda" {
  name = "loadlead-prod-signatures-worm-sink-policy"
  role = aws_iam_role.signatures_worm_sink_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudWatch Logs — Lambda's own logs.
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      # DDB Streams — read the signatures stream only.
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams",
        ]
        Resource = "${module.ddb_signatures.arn}/stream/*"
      },
      # S3 PutObject ONLY into the WORM bucket. Includes object-lock
      # fields per IAM doc requirements.
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectRetention",
          "s3:PutObjectLegalHold",
        ]
        Resource = "${aws_s3_bucket.signatures_worm.arn}/*"
      },
    ]
  })
}

# ── Lambda ────────────────────────────────────────────────────────────────
resource "aws_lambda_function" "signatures_worm_sink" {
  function_name    = "loadlead-prod-signatures-worm-sink"
  role             = aws_iam_role.signatures_worm_sink_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.signatures_worm_sink_zip.output_path
  source_code_hash = data.archive_file.signatures_worm_sink_zip.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      WORM_BUCKET  = aws_s3_bucket.signatures_worm.bucket
      RETAIN_DAYS  = "2555"
    }
  }

  tags = local.tags
}

# ── Event source mapping: DDB stream → Lambda ──────────────────────────────
resource "aws_lambda_event_source_mapping" "signatures_stream" {
  event_source_arn  = module.ddb_signatures.stream_arn
  function_name     = aws_lambda_function.signatures_worm_sink.arn
  starting_position = "LATEST" # only mirror NEW signatures; back-fill is a separate, manual job

  batch_size                         = 10
  maximum_batching_window_in_seconds = 5
  parallelization_factor             = 1
  # Failures keep retrying; we WANT the stream to back up rather than
  # silently drop legal evidence. Add a DLQ once we have alarms on the
  # iterator-age metric.
  maximum_retry_attempts = -1
}

output "signatures_worm_bucket"        { value = aws_s3_bucket.signatures_worm.bucket }
output "signatures_worm_sink_function" { value = aws_lambda_function.signatures_worm_sink.function_name }
