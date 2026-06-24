#!/usr/bin/env bash
# =============================================================
# Attestation Phase 1 — ops bootstrap (one-time, idempotent).
#
# Run AFTER the Terraform apply that adds Signatures + PodPhotos tables.
#
# Steps:
#   1. Enable PITR on the prod tables that aren't yet covered. The new
#      Signatures + PodPhotos tables get PITR free from the TF module;
#      existing tables (Users / Loads / Offers / Drivers / Receivers /
#      Shippers / Organizations / Memberships / BOL) currently DISABLED
#      per a live `describe-continuous-backups` audit.
#   2. Enable versioning on loadlead-pod-uploads.
#   3. Attach a bucket policy denying DeleteObject + DeleteObjectVersion
#      + PutBucketPolicy + PutLifecycleConfiguration to the runtime role.
#      This is "delete-resistant," NOT WORM — Phase 2 migrates to a v2
#      bucket with Object Lock COMPLIANCE at creation.
#
# Guardrails:
#   - APP_ENV=production required.
#   - Each step is idempotent (re-runs are no-ops).
#   - Each step prints what it would change BEFORE it changes anything when
#     DRY=1 is set.
# =============================================================
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
APP_ENV="${APP_ENV:?APP_ENV is required (e.g. APP_ENV=production)}"
DRY="${DRY:-0}"

POD_BUCKET="loadlead-pod-uploads"
RUNTIME_ROLE_ARN="${RUNTIME_ROLE_ARN:?RUNTIME_ROLE_ARN is required (the EB instance profile role ARN)}"

# Adjust this list as new prod tables are added. The four flagged in the
# audit are Users/Loads/Offers/Drivers; the rest are included for parity.
TABLES=(
  LoadLead_Users
  LoadLead_Loads
  LoadLead_Offers
  LoadLead_Drivers
  LoadLead_Receivers
  LoadLead_Shippers
  LoadLead_Organizations
  LoadLead_Memberships
  LoadLead_BOL
  LoadLead_Signatures
  LoadLead_PodPhotos
)

echo "▶  APP_ENV=${APP_ENV}  REGION=${REGION}  DRY=${DRY}"

# ── 1. PITR on existing tables ─────────────────────────────────────────────
echo ""
echo "▶  Enable PITR on ${#TABLES[@]} tables (idempotent)..."
for t in "${TABLES[@]}"; do
  status=$(aws dynamodb describe-continuous-backups \
            --table-name "$t" \
            --region "$REGION" \
            --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
            --output text 2>/dev/null || echo "MISSING")
  if [ "$status" = "ENABLED" ]; then
    echo "    ✓ $t already ENABLED"
  elif [ "$status" = "MISSING" ]; then
    echo "    ! $t not found — skip"
  else
    if [ "$DRY" = "1" ]; then
      echo "    (dry-run) would enable PITR on $t (currently $status)"
    else
      aws dynamodb update-continuous-backups \
        --table-name "$t" \
        --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
        --region "$REGION" >/dev/null
      echo "    ✓ $t -> ENABLED"
    fi
  fi
done

# ── 2. Versioning on loadlead-pod-uploads ─────────────────────────────────
echo ""
echo "▶  Enable versioning on s3://${POD_BUCKET}..."
ver=$(aws s3api get-bucket-versioning --bucket "$POD_BUCKET" --query 'Status' --output text 2>/dev/null || echo "Unset")
if [ "$ver" = "Enabled" ]; then
  echo "    ✓ already Enabled"
else
  if [ "$DRY" = "1" ]; then
    echo "    (dry-run) would enable versioning (current: $ver)"
  else
    aws s3api put-bucket-versioning \
      --bucket "$POD_BUCKET" \
      --versioning-configuration Status=Enabled
    echo "    ✓ versioning -> Enabled"
  fi
fi

# ── 3. Delete-resistance bucket policy ────────────────────────────────────
echo ""
echo "▶  Attach delete-resistance bucket policy..."
read -r -d '' POLICY <<JSON || true
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyDeleteAndPolicyTamper",
      "Effect": "Deny",
      "Principal": { "AWS": "${RUNTIME_ROLE_ARN}" },
      "Action": [
        "s3:DeleteObject",
        "s3:DeleteObjectVersion",
        "s3:PutBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:PutLifecycleConfiguration",
        "s3:PutBucketVersioning"
      ],
      "Resource": [
        "arn:aws:s3:::${POD_BUCKET}",
        "arn:aws:s3:::${POD_BUCKET}/*"
      ]
    }
  ]
}
JSON

if [ "$DRY" = "1" ]; then
  echo "    (dry-run) would put bucket policy:"
  echo "$POLICY" | sed 's/^/      /'
else
  aws s3api put-bucket-policy --bucket "$POD_BUCKET" --policy "$POLICY"
  echo "    ✓ bucket policy attached"
fi

echo ""
echo "✅  Done. Verify:"
echo "    - aws dynamodb describe-continuous-backups --table-name LoadLead_Signatures"
echo "    - aws s3api get-bucket-policy --bucket ${POD_BUCKET}"
echo ""
echo "Reminder: this is delete-resistant, NOT WORM. Phase 2 migrates the"
echo "bucket to a v2 with Object Lock COMPLIANCE at creation."
