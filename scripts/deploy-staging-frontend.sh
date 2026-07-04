#!/usr/bin/env bash
# Build + deploy the frontend-v2 SPA to the STAGING frontend bucket/CloudFront.
#
# Builds with VITE_API_URL pointed at the staging API, syncs the static bundle
# to s3://loadlead-staging-frontend, and invalidates the CloudFront cache. The
# frontend is independent of the backend pause state (CloudFront/S3 are ~$0
# idle) — it just calls a 502 API while the backend is paused.
#
#   ./scripts/deploy-staging-frontend.sh
set -euo pipefail

BUCKET="loadlead-staging-frontend"
API_URL="https://api-staging.loadleadapp.com"
ALIAS="staging.loadleadapp.com"
REGION="${AWS_REGION:-us-east-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Pull the staging env start/pause Lambda URL from Terraform so the homepage
# button is wired in (empty is fine — the button just won't render).
TOGGLE_URL="$(cd "$ROOT/infra/terraform/envs/staging" && tofu output -raw staging_toggle_url 2>/dev/null || true)"
echo "› build frontend-v2 (VITE_API_URL=$API_URL, toggle=${TOGGLE_URL:-none})"
( cd "$ROOT/frontend-v2" && VITE_API_URL="$API_URL" VITE_STAGING_TOGGLE_URL="$TOGGLE_URL" npm run build )

# Use the caller's real profile creds (the app .env carries dummy local keys).
eval "$(aws configure export-credentials --format env 2>/dev/null)"

echo "› sync dist → s3://$BUCKET"
aws s3 sync "$ROOT/frontend-v2/dist/" "s3://$BUCKET/" --delete --region "$REGION"

echo "› invalidate CloudFront"
DIST="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items[0]=='$ALIAS'].Id | [0]" --output text)"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" \
  --query "Invalidation.[Id,Status]" --output text

echo "✓ deployed → https://$ALIAS"
