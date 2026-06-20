#!/usr/bin/env bash
# =============================================================
# LoadLead Frontend — S3 + CloudFront Deploy Script
# Usage: ./deploy-frontend.sh
# Prerequisites: AWS CLI v2 installed + configured
# Run ONCE first: create the S3 bucket and CloudFront distribution
#   (instructions printed on first run)
# =============================================================
set -euo pipefail

REGION="us-east-1"
BUCKET="loadlead-frontend-prod"          # must be globally unique — change if taken
DOMAIN="loadleadapp.com"

# ── Build ──────────────────────────────────────────────────────────────────
echo "▶  Building frontend for production..."
npm --prefix frontend-v2 run build
# Vite reads .env.production automatically: VITE_API_URL=https://api.loadleadapp.com

# ── Check if bucket exists ─────────────────────────────────────────────────
BUCKET_EXISTS=$(aws s3api head-bucket --bucket "$BUCKET" 2>&1 || true)

if echo "$BUCKET_EXISTS" | grep -q "404\|NoSuchBucket\|Not Found"; then
  echo "▶  Creating S3 bucket: $BUCKET"
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    $([ "$REGION" != "us-east-1" ] && echo "--create-bucket-configuration LocationConstraint=$REGION" || echo "")

  echo "▶  Enabling static website hosting..."
  aws s3 website "s3://$BUCKET/" \
    --index-document index.html \
    --error-document index.html   # SPA fallback — all 404s → index.html

  echo "▶  Setting public read policy..."
  aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"PublicReadGetObject\",
      \"Effect\": \"Allow\",
      \"Principal\": \"*\",
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::$BUCKET/*\"
    }]
  }"
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  FIRST-TIME SETUP — do these steps once in AWS Console"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  echo "1. Request an ACM certificate (free SSL):"
  echo "   → ACM Console (us-east-1 region!) → Request certificate"
  echo "   → Add both:  loadleadapp.com  AND  www.loadleadapp.com"
  echo "   → Choose DNS validation → Create Route 53 records (1-click)"
  echo ""
  echo "2. Create a CloudFront distribution:"
  echo "   → CloudFront Console → Create distribution"
  echo "   → Origin domain: $BUCKET.s3-website-$REGION.amazonaws.com"
  echo "   → Origin protocol: HTTP only"
  echo "   → Viewer protocol: Redirect HTTP to HTTPS"
  echo "   → Alternate domain names: loadleadapp.com  www.loadleadapp.com"
  echo "   → Custom SSL certificate: (choose the ACM cert from step 1)"
  echo "   → Default root object: index.html"
  echo "   → Error pages: 403/404 → /index.html, status 200  (for React Router)"
  echo "   → Copy the CloudFront domain (xxxx.cloudfront.net)"
  echo ""
  echo "3. Point Route 53 to CloudFront:"
  echo "   → Route 53 → Hosted zones → $DOMAIN"
  echo "   → Create A record (Alias): loadleadapp.com → CloudFront distribution"
  echo "   → Create A record (Alias): www.loadleadapp.com → same distribution"
  echo ""
  echo "4. Set CLOUDFRONT_DIST_ID below and re-run this script"
  echo "═══════════════════════════════════════════════════════"
fi

# ── Sync files to S3 ───────────────────────────────────────────────────────
echo "▶  Syncing dist/ to s3://$BUCKET/..."
aws s3 sync frontend-v2/dist/ "s3://$BUCKET/" \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

# index.html must never be cached (so new deploys are picked up immediately)
aws s3 cp frontend-v2/dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html"

echo "✅  S3 sync complete."

# ── Invalidate CloudFront cache ────────────────────────────────────────────
# Set your distribution ID here after first setup:
CLOUDFRONT_DIST_ID="E38CZNP7L2DB98"

if [ -n "$CLOUDFRONT_DIST_ID" ]; then
  echo "▶  Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DIST_ID" \
    --paths "/*"
  echo "✅  Cache invalidated. Live in ~60s at https://$DOMAIN"
else
  echo ""
  echo "ℹ️  Set CLOUDFRONT_DIST_ID in this script to auto-invalidate cache on future deploys."
  echo "   File is live in S3 but not yet behind CloudFront+SSL."
fi

# ── Jira deploy record (best-effort) ────────────────────────────────────────
# Same shape as deploy-backend.sh. Frontend deploys default to env "prod"
# since this script targets the prod bucket; override via DEPLOY_ENV.
DEPLOY_ENV_TAG="${DEPLOY_ENV:-prod}"
if [ "$DEPLOY_ENV_TAG" = "prod" ] && [ -z "${DEPLOY_MSG:-}" ]; then
  echo ""
  echo "❌  DEPLOY_MSG is required for production frontend deploys."
  echo "    Re-run: DEPLOY_MSG=\"why this matters\" bash deploy-frontend.sh"
  exit 1
fi
DEPLOY_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
# Prefer system Python (see deploy-backend.sh for rationale).
if   [ -x /usr/bin/python3 ];                  then PY=/usr/bin/python3
elif command -v python3 >/dev/null;            then PY=python3
else                                                PY=""; fi
if [ -n "$DEPLOY_SHA" ] && [ -n "$PY" ]; then
  echo ""
  echo "▶  Recording frontend deploy in Jira (best-effort)..."
  "$PY" jira/post-deploy.py \
    --env "$DEPLOY_ENV_TAG" \
    --sha "$DEPLOY_SHA" \
    --message "${DEPLOY_MSG:-}" \
    || echo "   (Jira post failed — deploy already succeeded, ignoring)"
fi
