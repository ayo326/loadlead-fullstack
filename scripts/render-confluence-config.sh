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

PARENT="${CONFLUENCE_PARENT_PAGE_ID:-}"

cat > .markdown-confluence.json <<JSON
{
  "folderToPublish": "docs",
  "firstHeadingPageTitle": false,
  "confluenceBaseUrl": "${CONFLUENCE_BASE_URL}",
  "confluenceSpaceKey": "${CONFLUENCE_SPACE_KEY}",
  "atlassianUserName": "${CONFLUENCE_EMAIL}"$( [ -n "$PARENT" ] && printf ',\n  "confluenceParentId": "%s"' "$PARENT" || true ),
  "ignore": [
    "**/CREDENTIALS.md",
    "**/FINAL_IMPLEMENTATION_CHECKLIST.md",
    "**/node_modules/**"
  ]
}
JSON

echo "✓ rendered .markdown-confluence.json (space=${CONFLUENCE_SPACE_KEY}${PARENT:+ parent=${PARENT}})"
