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
echo "    DYNAMODB_SHIPPERS_TABLE= LoadLead_Shippers"
echo "    DYNAMODB_RECEIVERS_TABLE=LoadLead_Receivers"

rm -f "$ZIP"
