############################################################################
# compliance-documents.tf — carrier compliance documents infra (SCRUM-59).
#
# Three things the compliance-documents backend needs in prod:
#   1. A dedicated KMS key for W9-TIN envelope encryption (GenerateDataKey/
#      Decrypt), rotation ON, usable ONLY by the backend EB instance role.
#   2. Five append-only DynamoDB tables (documents, verification events, W9
#      access log, shipper policies, policy attachments). NEW tables — no
#      `terraform import` needed. deletion_protection + PITR (module default).
#   3. A private, Object-Lock, versioned, SSE'd S3 bucket for the document
#      objects, served only via 300s presigned GET URLs.
#
# Prod's EB environment is identity-only in TF (see eb-imported.tf:
# ignore_changes = [setting]), so the APP env vars are NOT set here. They are
# wired OUT-OF-BAND — see the "OUT-OF-BAND WIRING" note at the bottom of this
# file for the exact values. The DDB table names below equal the code defaults
# (LoadLead_*), and the bucket name equals complianceStorage.ts's default
# (loadlead-compliance-docs), so only W9_TIN_KMS_KEY_ID strictly MUST be set
# out-of-band (its code default is '' → fieldCrypto fails closed in prod).
############################################################################

data "aws_caller_identity" "current" {}

# ── W9-TIN envelope-encryption key ─────────────────────────────────────────
# Symmetric, rotation ON. The key policy grants ONLY account-root administration
# (AWS-standard delegation). Day-to-day crypto is granted to the backend EB
# instance role via the IAM role policy at the bottom of this file — no other
# principal or service can use this key. In prod resolveMode('kms') is always
# 'live', so this key is on the hot path for every W9 TIN encrypt/decrypt.
resource "aws_kms_key" "w9_tin" {
  description             = "LoadLead prod — W9 TIN envelope encryption (SCRUM-59)"
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
  tags = merge(local.tags, { Component = "compliance-w9", Tier = "pii-crypto" })
}

resource "aws_kms_alias" "w9_tin" {
  name          = "alias/loadlead-prod-w9-tin"
  target_key_id = aws_kms_key.w9_tin.key_id
}

# ── DynamoDB tables (append-only; deletion_protection + PITR via module) ────
module "ddb_compliance_documents" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_ComplianceDocuments"
  hash_key            = "documentId"
  attributes          = [{ name = "documentId", type = "S" }]
  deletion_protection = true
  tags                = local.tags
}

module "ddb_compliance_verification_events" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_ComplianceVerificationEvents"
  hash_key            = "eventId"
  attributes          = [{ name = "eventId", type = "S" }]
  deletion_protection = true
  tags                = local.tags
}

module "ddb_w9_access_log" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_W9AccessLog"
  hash_key            = "accessId"
  attributes          = [{ name = "accessId", type = "S" }]
  deletion_protection = true
  tags                = local.tags
}

module "ddb_shipper_compliance_policies" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_ShipperCompliancePolicies"
  hash_key            = "policyVersionId"
  attributes          = [{ name = "policyVersionId", type = "S" }]
  deletion_protection = true
  tags                = local.tags
}

module "ddb_shipper_policy_attachments" {
  source              = "../../modules/dynamodb_table"
  name                = "LoadLead_ShipperPolicyAttachments"
  hash_key            = "attachmentId"
  attributes          = [{ name = "attachmentId", type = "S" }]
  deletion_protection = true
  tags                = local.tags
}

# ── Compliance document objects bucket ─────────────────────────────────────
# Object Lock COMPLIANCE-capable, versioned, SSE, all public access blocked.
# Same immutable-by-design posture as pod-uploads-v2 / the signatures WORM
# sink. Objects are written server-side by the backend and read only through
# 300s presigned GET URLs. Bucket name == complianceStorage.ts default so the
# app resolves it even if COMPLIANCE_S3_BUCKET isn't set explicitly.
resource "aws_s3_bucket" "compliance_docs" {
  bucket              = "loadlead-compliance-docs"
  object_lock_enabled = true # MUST be set at create time; can't be added later

  tags = merge(local.tags, { Component = "compliance-docs", Tier = "legal-evidence" })
}

resource "aws_s3_bucket_versioning" "compliance_docs" {
  bucket = aws_s3_bucket.compliance_docs.id
  versioning_configuration {
    status = "Enabled" # required for Object Lock
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "compliance_docs" {
  bucket = aws_s3_bucket.compliance_docs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "compliance_docs" {
  bucket                  = aws_s3_bucket.compliance_docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS for browser downloads of presigned GET URLs. Uploads are server-side
# (complianceStorage.putObject → plain PutObject), so no browser PUT is needed.
resource "aws_s3_bucket_cors_configuration" "compliance_docs" {
  bucket = aws_s3_bucket.compliance_docs.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = [
      "https://app.loadleadapp.com",
      "https://admin.loadleadapp.com",
    ]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# We deliberately do NOT set a bucket-level DefaultRetention (same reasoning as
# pod-uploads-v2): a bucket default would force Content-MD5/x-amz-checksum on
# every PutObject, which the backend's plain PutObject doesn't send — it would
# break uploads. Delete-resistance instead comes from the Deny-all-deletes
# bucket policy below; per-object COMPLIANCE locks can be layered on later,
# server-side, if/when the app computes and applies them at finalize.
resource "aws_s3_bucket_policy" "compliance_docs_no_delete" {
  bucket = aws_s3_bucket.compliance_docs.id

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
      Resource = "${aws_s3_bucket.compliance_docs.arn}/*"
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.compliance_docs]
}

# ── Least-privilege grant to the prod backend EB instance role ─────────────
# data.aws_iam_role.eb_backend ("aws-elasticbeanstalk-ec2-role") is declared in
# imported-tables.tf and is the prod backend's instance profile role (dev/
# staging use their OWN module-created roles, so this grant is prod-scoped).
# GenerateDataKey/Decrypt on the ONE W9-TIN key only; Get/PutObject on the ONE
# compliance bucket only — no deletes (append-only), no other key or bucket.
resource "aws_iam_role_policy" "compliance_backend_access" {
  name = "loadlead-prod-compliance-docs-access"
  role = data.aws_iam_role.eb_backend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "KmsW9TinEnvelopeCrypto"
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = [aws_kms_key.w9_tin.arn]
      },
      {
        Sid      = "S3ComplianceDocsObjectRW"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${aws_s3_bucket.compliance_docs.arn}/*"]
      },
    ]
  })
}

# ── Outputs (feed the out-of-band EB env wiring) ───────────────────────────
output "w9_tin_kms_key_id" { value = aws_kms_key.w9_tin.key_id }
output "w9_tin_kms_key_arn" { value = aws_kms_key.w9_tin.arn }
output "w9_tin_kms_alias" { value = aws_kms_alias.w9_tin.name }
output "compliance_docs_bucket" { value = aws_s3_bucket.compliance_docs.bucket }
output "compliance_documents_table_arn" { value = module.ddb_compliance_documents.arn }
output "compliance_verification_events_table_arn" { value = module.ddb_compliance_verification_events.arn }
output "w9_access_log_table_arn" { value = module.ddb_w9_access_log.arn }
output "shipper_compliance_policies_table_arn" { value = module.ddb_shipper_compliance_policies.arn }
output "shipper_policy_attachments_table_arn" { value = module.ddb_shipper_policy_attachments.arn }

############################################################################
# OUT-OF-BAND WIRING (prod EB settings are not TF-managed — see eb-imported.tf)
#
# After `tofu apply` in envs/prod, set the backend env vars on the prod EB
# environment (one time; the deploy pipeline preserves them thereafter):
#
#   KEY_ID=$(tofu output -raw w9_tin_kms_key_id)
#   aws elasticbeanstalk update-environment \
#     --environment-name loadlead-backend-prod \
#     --option-settings \
#       Namespace=aws:elasticbeanstalk:application:environment,OptionName=W9_TIN_KMS_KEY_ID,Value=$KEY_ID \
#       Namespace=aws:elasticbeanstalk:application:environment,OptionName=COMPLIANCE_S3_BUCKET,Value=loadlead-compliance-docs
#
# W9_TIN_KMS_KEY_ID is REQUIRED: in prod resolveMode('kms')='live' and
# fieldCrypto throws (fails closed) if the key id is unset. COMPLIANCE_S3_BUCKET
# and the five DYNAMODB_COMPLIANCE_*_TABLE names already equal the code defaults,
# so they're optional-but-recommended for explicitness. Do NOT set KMS_MODE in
# prod — the production lock ignores it and always resolves KMS live.
############################################################################
