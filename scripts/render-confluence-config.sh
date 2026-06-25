#!/usr/bin/env bash
# Render .markdown-confluence.json from env vars. The @markdown-confluence/cli
# JSON config has NO env-var interpolation, so we materialize the final file
# right before invoking the CLI (in CI and locally).
#
# Required env vars:
#   CONFLUENCE_BASE_URL    e.g. https://loadlleadllc.atlassian.net/wiki
#   CONFLUENCE_EMAIL       the Atlassian account email
#   CONFLUENCE_SPACE_KEY   e.g. ENG
# Optional:
#   CONFLUENCE_PARENT_PAGE_ID   numeric ID; if absent, docs land at space root
#
# ATLASSIAN_API_TOKEN is read by the CLI directly from env; never written here.
set -euo pipefail

: "${CONFLUENCE_BASE_URL:?missing CONFLUENCE_BASE_URL}"
: "${CONFLUENCE_EMAIL:?missing CONFLUENCE_EMAIL}"
: "${CONFLUENCE_SPACE_KEY:?missing CONFLUENCE_SPACE_KEY}"

# CONFLUENCE_BASE_URL must be the bare site root (e.g. https://x.atlassian.net)
# because @markdown-confluence/cli auto-appends /wiki/... — but the REST calls
# in this script need /wiki explicitly. Normalize both forms so the operator
# can set either.
BASE_BARE="${CONFLUENCE_BASE_URL%/}"
BASE_BARE="${BASE_BARE%/wiki}"
BASE_REST="${BASE_BARE}/wiki"

PARENT="${CONFLUENCE_PARENT_PAGE_ID:-}"
: "${CONFLUENCE_API_TOKEN:?missing CONFLUENCE_API_TOKEN (needed to look up space home page)}"

# The CLI requires confluenceParentId. If the operator didn't pin one, fall
# back to the space's home page ID so docs land at the space root.
if [ -z "$PARENT" ]; then
  echo "→ no CONFLUENCE_PARENT_PAGE_ID set; resolving home page of space ${CONFLUENCE_SPACE_KEY}…"
  PARENT=$(curl -fsS -u "${CONFLUENCE_EMAIL}:${CONFLUENCE_API_TOKEN}" \
    "${BASE_REST}/api/v2/spaces?keys=${CONFLUENCE_SPACE_KEY}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("results",[]); print(r[0]["homepageId"] if r else "", end="")')
  if [ -z "$PARENT" ]; then
    echo "::error::could not resolve home page for space ${CONFLUENCE_SPACE_KEY}. Verify the space exists and the token can read it."
    exit 1
  fi
  echo "✓ using space home page ${PARENT} as parent"
fi

# Inline the token into the config file too. The CLI is supposed to read it
# from ATLASSIAN_API_TOKEN, but in CI that env var doesn't always make it
# through to the npx subprocess — pages then come back as the Confluence
# "Page Not Found" HTML (unauthenticated response).
cat > .markdown-confluence.json <<JSON
{
  "folderToPublish": "docs",
  "firstHeadingPageTitle": false,
  "confluenceBaseUrl": "${BASE_BARE}",
  "confluenceSpaceKey": "${CONFLUENCE_SPACE_KEY}",
  "atlassianUserName": "${CONFLUENCE_EMAIL}",
  "atlassianApiToken": "${CONFLUENCE_API_TOKEN}",
  "confluenceParentId": "${PARENT}",
  "ignore": [
    "**/CREDENTIALS.md",
    "**/FINAL_IMPLEMENTATION_CHECKLIST.md",
    "**/node_modules/**",
    "**/.build/**"
  ]
}
JSON
chmod 600 .markdown-confluence.json

echo "✓ rendered .markdown-confluence.json (space=${CONFLUENCE_SPACE_KEY} parent=${PARENT})"
