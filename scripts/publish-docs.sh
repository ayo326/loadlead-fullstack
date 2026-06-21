#!/usr/bin/env bash
# One-shot local publish of /docs to Confluence.
#
# Why this isn't a GitHub Actions job: Atlassian's Free-tier Confluence quietly
# returns 404 HTML to datacenter IPs (incl. GitHub runners) for the v1 REST
# endpoints the publisher uses, even with valid auth. Same call from a
# residential IP returns 200. So we run it from your machine.
#
# Required env (export in your shell before running):
#   CONFLUENCE_BASE_URL    https://loadlleadllc.atlassian.net (no /wiki)
#   CONFLUENCE_EMAIL       your Atlassian login email
#   CONFLUENCE_API_TOKEN   token with Confluence read+write scope
#   CONFLUENCE_SPACE_KEY   e.g. ENG
#   CONFLUENCE_PARENT_PAGE_ID   numeric id of the LoadLead Engineering Docs page
#
# Re-uses scripts/render-confluence-config.sh — never commit the rendered file.
set -euo pipefail

cd "$(dirname "$0")/.."

bash scripts/render-confluence-config.sh

echo ""
echo "── Publishing /docs → Confluence ${CONFLUENCE_SPACE_KEY} ──"
ATLASSIAN_API_TOKEN="${CONFLUENCE_API_TOKEN}" \
  npx --yes @markdown-confluence/cli@latest | tee /tmp/conflu-publish.log

if grep -q "^SUCCESS:" /tmp/conflu-publish.log; then
  count=$(grep -c "^SUCCESS:" /tmp/conflu-publish.log)
  echo ""
  echo "✓ ${count} pages published/updated"
  echo "  log: /tmp/conflu-publish.log"
else
  echo ""
  echo "✗ no pages published — see /tmp/conflu-publish.log"
  exit 1
fi
