#!/usr/bin/env bash
# =============================================================
# LoadLead Backend — Elastic Beanstalk Deploy Script
# Usage: ./deploy-backend.sh
# Prerequisites: AWS CLI v2 installed + configured (aws configure)
# =============================================================
set -euo pipefail

APP_NAME="loadlead-backend"
ENV_NAME="loadlead-backend-prod"
REGION="us-east-1"           # change if your account uses a different region
PLATFORM="64bit Amazon Linux 2023 v6.11.1 running Node.js 22"
INSTANCE_TYPE="t3.small"
ZIP="loadlead-backend-$(date +%Y%m%d%H%M%S).zip"

echo "▶  Ensuring DynamoDB tables exist in $REGION..."
# Helper: create table only if it doesn't already exist
ensure_table() {
  local TABLE=$1; shift
  if aws dynamodb describe-table --region "$REGION" --table-name "$TABLE" &>/dev/null; then
    echo "   ✓ $TABLE already exists"
  else
    echo "   + Creating $TABLE..."
    aws dynamodb create-table --region "$REGION" --table-name "$TABLE" \
      --billing-mode PAY_PER_REQUEST "$@"
    aws dynamodb wait table-exists --region "$REGION" --table-name "$TABLE"
    echo "   ✓ $TABLE created"
  fi
}

# Core tables (pre-existing — ensure they're present)
ensure_table LoadLead_Users \
  --attribute-definitions AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH

ensure_table LoadLead_Drivers \
  --attribute-definitions AttributeName=driverId,AttributeType=S \
  --key-schema AttributeName=driverId,KeyType=HASH

ensure_table LoadLead_Shippers \
  --attribute-definitions AttributeName=shipperId,AttributeType=S \
  --key-schema AttributeName=shipperId,KeyType=HASH

ensure_table LoadLead_Receivers \
  --attribute-definitions AttributeName=receiverId,AttributeType=S \
  --key-schema AttributeName=receiverId,KeyType=HASH

ensure_table LoadLead_Loads \
  --attribute-definitions AttributeName=loadId,AttributeType=S \
  --key-schema AttributeName=loadId,KeyType=HASH

ensure_table LoadLead_Offers \
  --attribute-definitions AttributeName=offerId,AttributeType=S \
  --key-schema AttributeName=offerId,KeyType=HASH

# Org tables (new — Organizations, Memberships, Invitations)
ensure_table LoadLead_Organizations \
  --attribute-definitions AttributeName=orgId,AttributeType=S \
  --key-schema AttributeName=orgId,KeyType=HASH

ensure_table LoadLead_Memberships \
  --attribute-definitions \
    AttributeName=membershipId,AttributeType=S \
    AttributeName=orgId,AttributeType=S \
    AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=membershipId,KeyType=HASH \
  --global-secondary-indexes \
    '[{"IndexName":"orgId-index","KeySchema":[{"AttributeName":"orgId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}},
      {"IndexName":"userId-index","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]'

ensure_table LoadLead_Invitations \
  --attribute-definitions \
    AttributeName=token,AttributeType=S \
    AttributeName=orgId,AttributeType=S \
  --key-schema AttributeName=token,KeyType=HASH \
  --global-secondary-indexes \
    '[{"IndexName":"orgId-index","KeySchema":[{"AttributeName":"orgId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]'

# Owner Operator tables (standalone profile + fleet invites)
ensure_table LoadLead_OwnerOperators \
  --attribute-definitions \
    AttributeName=operatorId,AttributeType=S \
    AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=operatorId,KeyType=HASH \
  --global-secondary-indexes \
    '[{"IndexName":"userId-index","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]'

ensure_table LoadLead_FleetInvites \
  --attribute-definitions \
    AttributeName=inviteId,AttributeType=S \
    AttributeName=operatorId,AttributeType=S \
    AttributeName=token,AttributeType=S \
  --key-schema AttributeName=inviteId,KeyType=HASH \
  --global-secondary-indexes \
    '[{"IndexName":"operatorId-index","KeySchema":[{"AttributeName":"operatorId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}},
      {"IndexName":"token-index","KeySchema":[{"AttributeName":"token","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]'

# Notification inbox (Feature 5 — in-app notification bell)
ensure_table LoadLead_Notifications \
  --attribute-definitions \
    AttributeName=notificationId,AttributeType=S \
    AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=notificationId,KeyType=HASH \
  --global-secondary-indexes \
    '[{"IndexName":"userId-index","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]'

# Membership audit log table (new — spec §6.5)
ensure_table LoadLead-MembershipAuditLogs \
  --attribute-definitions \
    AttributeName=logId,AttributeType=S \
    AttributeName=orgId,AttributeType=S \
  --key-schema AttributeName=logId,KeyType=HASH \
  --global-secondary-indexes \
    '[{"IndexName":"orgId-index","KeySchema":[{"AttributeName":"orgId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]'

echo ""
echo "▶  Production deploy guard: confirming this run is actually production..."
# This script only ever targets $ENV_NAME (loadlead-backend-prod). Refuse to
# proceed unless the caller's shell explicitly carries APP_ENV=production —
# this is the same signal the app's own boot guard checks, so running this
# script without it set is a deliberate stop, not a silent assumption.
if [ "${APP_ENV:-}" != "production" ]; then
  echo "❌  Refusing to deploy: APP_ENV is \"${APP_ENV:-<unset>}\", not \"production\"."
  echo "    This script deploys to $ENV_NAME. Set APP_ENV=production in the calling"
  echo "    shell/CI job to confirm that is really what you mean to do."
  exit 1
fi
echo "   ✓ APP_ENV=production confirmed"

echo ""
echo "▶  Building TypeScript..."
npm --prefix backend run build

# ── Physical exclusion of non-production code (defense layer: build artifact) ─
# Logically unreachable in production already (resolveMode() always returns
# 'live' there, and /_test is never mounted) — this removes it from the
# shipped artifact entirely, so a bug in that logic can't ship the code even
# if it could never execute it.
echo ""
echo "▶  Pruning non-production code from the build output..."
prune_nonprod_code() {
  local removed=0
  if [ -d "backend/dist/services/integrations/stubs" ]; then
    rm -rf "backend/dist/services/integrations/stubs"
    echo "   removed dist/services/integrations/stubs/"
    removed=1
  fi
  if [ -d "backend/dist/routes/_test" ]; then
    rm -rf "backend/dist/routes/_test"
    echo "   removed dist/routes/_test/"
    removed=1
  fi
  while IFS= read -r -d '' f; do
    rm -f "$f"
    echo "   removed $f"
    removed=1
  done < <(find backend/dist -name "*.stub.js" -print0 -o -name "*.test-route.js" -print0)
  if [ "$removed" -eq 0 ]; then
    echo "   (nothing to prune — already clean)"
  fi
}
prune_nonprod_code

# ── Deploy-time contamination scan ────────────────────────────────────────────
# Independent of the prune step above — re-verifies the actual artifact
# rather than trusting that the prune ran (or ran correctly). Aborts the
# deploy with a non-zero exit BEFORE anything is uploaded if it finds
# anything. This is checked twice: once against the unzipped dist/ tree
# (clearer error messages with real file paths), and again against the
# zip's own file listing right before upload (catches anything re-added
# between prune and zip).
scan_for_contamination() {
  local target_desc=$1; shift
  local found=0

  echo "   scanning $target_desc for forbidden paths..."
  for marker_path in "routes/_test" "services/integrations/stubs"; do
    local hits
    hits=$("$@" 2>/dev/null | grep -F "$marker_path" || true)
    if [ -n "$hits" ]; then
      echo "   ✗ FOUND forbidden path marker \"$marker_path\":"
      echo "$hits" | sed 's/^/       /'
      found=1
    fi
  done

  if [ "$found" -eq 1 ]; then
    echo ""
    echo "❌  Deploy ABORTED: forbidden non-production paths found in $target_desc."
    echo "    This is a production deploy — routes/_test and"
    echo "    services/integrations/stubs must never ship. Aborting before upload."
    exit 1
  fi
  echo "   ✓ $target_desc is clean (no forbidden paths)"
}

echo ""
echo "▶  Deploy-time scan (pass 1 — dist/ tree, by path)..."
scan_for_contamination "dist/" find backend/dist -type f

# Content-string scan over what will actually ship: every remaining .js file
# under dist/. Markers: a real Resend sandbox test address, the non-prod
# outbox route's full path, and explicit non-live mode assignments — none of
# these should ever appear in compiled output once stubs/_test are pruned,
# because every shipped adapter builds any reference to them from string
# fragments specifically so this scan can't false-positive on legitimate code.
echo ""
echo "▶  Deploy-time scan (pass 2 — compiled output, by content)..."
CONTENT_MARKERS=(
  "FMCSA_MODE=stub" "MAPS_MODE=stub" "EMAIL_MODE=test" "PUSH_MODE=capture" "DIDIT_ENV=sandbox"
  "fmcsaStub" "mapsStub"
)
content_found=0
for marker in "${CONTENT_MARKERS[@]}"; do
  hits=$(grep -rIl -- "$marker" backend/dist 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "   ✗ FOUND forbidden string \"$marker\" in:"
    echo "$hits" | sed 's/^/       /'
    content_found=1
  fi
done
if [ "$content_found" -eq 1 ]; then
  echo ""
  echo "❌  Deploy ABORTED: forbidden non-production strings found in compiled output."
  exit 1
fi
echo "   ✓ compiled output is clean (no forbidden strings)"

echo ""
echo "▶  Creating deployment zip..."
# ONLY what actually runs or configures the EB platform: dist/ (compiled
# output — see .ebextensions/01_npm_build.config: "TypeScript is compiled
# locally before deploy... no build step needed on the server"),
# package.json/.npmrc (npm install on the instance), .platform/.ebextensions
# (EB platform config), Procfile (start command). Deliberately NOT src/ —
# raw TypeScript is never executed at runtime, and shipping it would also
# re-introduce routes/_test and services/integrations/stubs as .ts files
# even after dist/ is pruned, defeating physical exclusion entirely.
cd backend
ZIP_INCLUDE=(dist package.json package-lock.json .npmrc Procfile)
[ -d .platform ]     && ZIP_INCLUDE+=(.platform)
[ -d .ebextensions ]  && ZIP_INCLUDE+=(.ebextensions)
zip -r "../$ZIP" "${ZIP_INCLUDE[@]}" \
  --exclude ".env" \
  --exclude "*.log" \
  --exclude ".DS_Store"
cd ..

echo ""
echo "▶  Deploy-time scan (pass 3 — final zip listing, by path)..."
scan_for_contamination "the deploy zip" unzip -l "$ZIP"

echo ""
echo "▶  Uploading to S3 (EB managed bucket)..."
BUCKET=$(aws elasticbeanstalk create-storage-location \
  --region "$REGION" \
  --query S3Bucket --output text)

aws s3 cp "$ZIP" "s3://$BUCKET/$ZIP" --region "$REGION"

echo "▶  Creating application version..."
aws elasticbeanstalk create-application-version \
  --region "$REGION" \
  --application-name "$APP_NAME" \
  --version-label "${ZIP%.zip}" \
  --source-bundle "S3Bucket=$BUCKET,S3Key=$ZIP" \
  --auto-create-application

echo "▶  Checking if environment exists..."
ENV_EXISTS=$(aws elasticbeanstalk describe-environments \
  --region "$REGION" \
  --application-name "$APP_NAME" \
  --environment-names "$ENV_NAME" \
  --query "Environments[0].Status" --output text 2>/dev/null || echo "None")

if [ "$ENV_EXISTS" = "None" ] || [ "$ENV_EXISTS" = "Terminated" ]; then
  echo "▶  Creating new environment (first deploy — takes ~5 min)..."
  aws elasticbeanstalk create-environment \
    --region "$REGION" \
    --application-name "$APP_NAME" \
    --environment-name "$ENV_NAME" \
    --solution-stack-name "$PLATFORM" \
    --option-settings \
      "Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=$INSTANCE_TYPE" \
      "Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=aws-elasticbeanstalk-ec2-role" \
      "Namespace=aws:elasticbeanstalk:application:environment,OptionName=NODE_ENV,Value=production" \
    --version-label "${ZIP%.zip}"
else
  echo "▶  Deploying to existing environment..."
  aws elasticbeanstalk update-environment \
    --region "$REGION" \
    --environment-name "$ENV_NAME" \
    --version-label "${ZIP%.zip}"
fi

echo ""
echo "✅  Deploy submitted. Monitor at:"
echo "    https://$REGION.console.aws.amazon.com/elasticbeanstalk"
echo ""
echo "⚠️  NEXT: Set these env vars in EB Console → Configuration → Environment properties:"
echo "    ALLOWED_ORIGINS        = https://loadleadapp.com,https://www.loadleadapp.com"
echo "    JWT_SECRET             = <strong-random-string>"
echo "    AWS_REGION             = $REGION"
echo "    AWS_ACCESS_KEY_ID      = <your-key>"
echo "    AWS_SECRET_ACCESS_KEY  = <your-secret>"
echo "    DYNAMODB_USERS_TABLE   = LoadLead_Users"
echo "    DYNAMODB_LOADS_TABLE   = LoadLead_Loads"
echo "    DYNAMODB_OFFERS_TABLE  = LoadLead_Offers"
echo "    DYNAMODB_DRIVERS_TABLE = LoadLead_Drivers"
echo "    DYNAMODB_SHIPPERS_TABLE    = LoadLead_Shippers"
echo "    DYNAMODB_RECEIVERS_TABLE   = LoadLead_Receivers"
echo "    DYNAMODB_ORGS_TABLE        = LoadLead_Organizations"
echo "    DYNAMODB_MEMBERSHIPS_TABLE = LoadLead_Memberships"
echo "    DYNAMODB_INVITATIONS_TABLE     = LoadLead_Invitations"
echo "    DYNAMODB_OWNER_OPERATORS_TABLE = LoadLead_OwnerOperators"
echo "    DYNAMODB_FLEET_INVITES_TABLE   = LoadLead_FleetInvites"
echo "    FRONTEND_URL               = https://loadleadapp.com"
echo "    RESEND_API_KEY             = <your-resend-key>"

rm -f "$ZIP"
