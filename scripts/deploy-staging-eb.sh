#!/usr/bin/env bash
# Manual one-off deploy of the backend to the STAGING Elastic Beanstalk env.
#
# Use after `make staging-resume` has brought the env up. Uploads the prebuilt
# deploy-staging.zip as a new application version and points the staging env at
# it, then waits for the env to go Ready/Green. Env vars (DYNAMODB_*, JWT, etc.)
# already live on the env from Terraform — this ships code only.
#
#   ./scripts/deploy-staging-eb.sh            # uses ./deploy-staging.zip
#   ./scripts/deploy-staging-eb.sh path.zip
set -euo pipefail

APP="loadlead-backend"
ENV_NAME="loadlead-backend-staging"
ZIP="${1:-deploy-staging.zip}"
REGION="${AWS_REGION:-us-east-1}"
LABEL="staging-$(date -u +%Y%m%d%H%M%S)"

[ -f "$ZIP" ] || { echo "error: $ZIP not found — build it first (cd backend && npm run build && zip ...)"; exit 2; }

echo "› EB storage bucket…"
BUCKET="$(aws elasticbeanstalk create-storage-location --region "$REGION" --query S3Bucket --output text)"
KEY="$APP/$LABEL.zip"

echo "› upload $ZIP → s3://$BUCKET/$KEY"
aws s3 cp "$ZIP" "s3://$BUCKET/$KEY" --region "$REGION"

echo "› create application version $LABEL"
aws elasticbeanstalk create-application-version \
  --region "$REGION" \
  --application-name "$APP" \
  --version-label "$LABEL" \
  --source-bundle "S3Bucket=$BUCKET,S3Key=$KEY" \
  --process >/dev/null

echo "› deploy $LABEL → $ENV_NAME"
aws elasticbeanstalk update-environment \
  --region "$REGION" \
  --environment-name "$ENV_NAME" \
  --version-label "$LABEL" >/dev/null

echo "› waiting for $ENV_NAME to go Ready…"
aws elasticbeanstalk wait environment-updated --region "$REGION" --environment-names "$ENV_NAME"

aws elasticbeanstalk describe-environments --region "$REGION" \
  --environment-names "$ENV_NAME" \
  --query "Environments[0].[Status,Health,VersionLabel]" --output text
echo "✓ deployed. Smoke: curl -sf https://api-staging.loadleadapp.com/api/health"
