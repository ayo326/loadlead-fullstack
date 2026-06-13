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

# Membership audit log table (new — spec §6.5)
ensure_table LoadLead-MembershipAuditLogs \
  --attribute-definitions \
    AttributeName=logId,AttributeType=S \
    AttributeName=orgId,AttributeType=S \
  --key-schema AttributeName=logId,KeyType=HASH \
  --global-secondary-indexes \
    '[{"IndexName":"orgId-index","KeySchema":[{"AttributeName":"orgId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]'

echo ""
echo "▶  Building TypeScript..."
npm --prefix backend run build

echo "▶  Creating deployment zip..."
cd backend
zip -r "../$ZIP" . \
  --exclude "node_modules/*" \
  --exclude ".env" \
  --exclude "*.log" \
  --exclude ".DS_Store"
cd ..

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
echo "    DYNAMODB_INVITATIONS_TABLE = LoadLead_Invitations"
echo "    FRONTEND_URL               = https://loadleadapp.com"
echo "    RESEND_API_KEY             = <your-resend-key>"

rm -f "$ZIP"
