#!/usr/bin/env bash
# Deploy the admin-only bundle to its own S3 bucket + CloudFront distribution.
#
# The admin bundle (frontend-v2/dist-admin/, built by `npm run build:admin`)
# only contains the login screen and /admin. The customer bundle is built and
# deployed separately by deploy-frontend.sh and is unaffected by this script.
#
# Required environment:
#   APP_ENV=production            -- guard against accidental local runs
#   ADMIN_BUCKET=loadlead-admin-prod   (default)
#   ADMIN_DIST_ID=E1ABC2DEF345GH       (no default -- caller must supply)

set -euo pipefail

if [[ "${APP_ENV:-}" != "production" ]]; then
  echo "Refusing to deploy: APP_ENV is \"${APP_ENV:-<unset>}\", not \"production\"." >&2
  echo "Set APP_ENV=production in the calling shell to confirm." >&2
  exit 1
fi

ADMIN_BUCKET="${ADMIN_BUCKET:-loadlead-admin-prod}"
ADMIN_DIST_ID="${ADMIN_DIST_ID:?set ADMIN_DIST_ID to the CloudFront distribution ID for admin.loadleadapp.com}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR/frontend-v2"

echo "Building admin bundle (LL_BUILD=admin)..."
npm ci
LL_BUILD=admin npm run build:admin

if [[ ! -f dist-admin/admin.html ]]; then
  echo "Build did not produce dist-admin/admin.html -- aborting." >&2
  exit 1
fi

echo "Syncing dist-admin/ to s3://$ADMIN_BUCKET/..."
aws s3 sync dist-admin/ "s3://$ADMIN_BUCKET/" \
  --delete \
  --cache-control 'public,max-age=300,must-revalidate'

echo "Invalidating CloudFront ($ADMIN_DIST_ID)..."
aws cloudfront create-invalidation --distribution-id "$ADMIN_DIST_ID" --paths '/*' >/dev/null

echo "Done. Admin bundle live at https://admin.loadleadapp.com (allow ~60s for invalidation)."
