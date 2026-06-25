#!/usr/bin/env bash
# rotate-confluence-token.sh — propagate a freshly-minted Atlassian API token
# to every surface the publish pipeline reads it from, in one command.
#
# Surfaces updated:
#   1. macOS Keychain (so ~/.zshrc can read it back without ever writing the
#      token to a dotfile in plaintext)
#   2. GitHub Actions repo secret CONFLUENCE_API_TOKEN
#   3. The rendered local .markdown-confluence.json (via re-render)
#
# What the operator still does manually (Atlassian's design, not ours):
#   • Generate the new token at https://id.atlassian.com/manage-profile/security/api-tokens
#   • Revoke the previous one in the same UI
#
# Usage:
#   scripts/rotate-confluence-token.sh
#     → prompts for the new token (hidden input); no shell history footprint
#   scripts/rotate-confluence-token.sh --verify
#     → just hits the Confluence API with the currently-Keychained token and
#       reports whether it works; does NOT prompt or rotate
set -euo pipefail

KEYCHAIN_SERVICE="loadlead-confluence-token"
GH_SECRET_NAME="CONFLUENCE_API_TOKEN"

# ── helpers ───────────────────────────────────────────────────────────────────
die() { echo "✗ $*" >&2; exit 1; }
ok()  { echo "✓ $*"; }
note(){ echo "  $*"; }

# Pull the email + base URL from the existing rendered config if it exists;
# fall back to env. We need them for the API smoke test below.
if [ -f .markdown-confluence.json ]; then
  EMAIL=$(python3 -c "import json,sys; print(json.load(open('.markdown-confluence.json')).get('atlassianUserName',''))" 2>/dev/null || true)
  BASE=$(python3  -c "import json,sys; print(json.load(open('.markdown-confluence.json')).get('confluenceBaseUrl',''))" 2>/dev/null || true)
  SPACE=$(python3 -c "import json,sys; print(json.load(open('.markdown-confluence.json')).get('confluenceSpaceKey',''))" 2>/dev/null || true)
fi
EMAIL="${EMAIL:-${CONFLUENCE_EMAIL:-}}"
BASE="${BASE:-${CONFLUENCE_BASE_URL:-}}"
SPACE="${SPACE:-${CONFLUENCE_SPACE_KEY:-}}"
[ -n "$EMAIL" ] || die "couldn't infer CONFLUENCE_EMAIL — set it in env or run \`make publish-docs\` once first to render the config"
[ -n "$BASE"  ] || die "couldn't infer CONFLUENCE_BASE_URL — same fix"
[ -n "$SPACE" ] || die "couldn't infer CONFLUENCE_SPACE_KEY — same fix"

BASE_REST="${BASE%/wiki}/wiki"

verify_token() {
  local tok="$1"
  curl -fsS -u "$EMAIL:$tok" "${BASE_REST}/api/v2/spaces?keys=${SPACE}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('results') else 1)" \
    >/dev/null 2>&1
}

# ── --verify mode: just check the stored token works ─────────────────────────
if [ "${1:-}" = "--verify" ]; then
  CURRENT=$(security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)
  [ -n "$CURRENT" ] || die "no token in Keychain under service \"$KEYCHAIN_SERVICE\""
  if verify_token "$CURRENT"; then ok "Keychain token works against $BASE_REST (space $SPACE)"
  else                              die "Keychain token rejected by Confluence — rotate it"; fi
  exit 0
fi

# ── rotate mode ──────────────────────────────────────────────────────────────
echo "Rotate the Atlassian API token everywhere it's used by the docs pipeline."
echo "  • Atlassian UI:  https://id.atlassian.com/manage-profile/security/api-tokens"
echo "  • Email on file: $EMAIL"
echo "  • Confluence:    $BASE_REST  (space $SPACE)"
echo ""
echo "Paste the new token (input is hidden):"
read -rs NEW_TOKEN
echo ""
[ -n "$NEW_TOKEN" ] || die "empty token; nothing changed"

# Smoke test BEFORE persisting — if the token is broken, fail fast and leave
# the working token in place rather than half-rotating.
echo "→ verifying new token against Confluence …"
verify_token "$NEW_TOKEN" || die "new token rejected by Confluence (check email + scope); NOTHING CHANGED"
ok  "Confluence accepted the new token"

# 1) macOS Keychain
echo "→ writing to macOS Keychain (service: $KEYCHAIN_SERVICE) …"
security delete-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1 || true
security add-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w "$NEW_TOKEN" \
  -T /usr/bin/security -T /bin/bash -T /bin/zsh \
  || die "Keychain write failed"
ok  "Keychain updated"

# 2) GitHub Actions secret
if command -v gh >/dev/null 2>&1; then
  echo "→ updating GitHub Actions secret $GH_SECRET_NAME …"
  if printf '%s' "$NEW_TOKEN" | gh secret set "$GH_SECRET_NAME" --body - 2>/dev/null; then
    ok "GitHub secret $GH_SECRET_NAME updated"
  else
    note "✗ gh secret set failed (token still in Keychain). Check: gh auth status — needs repo scope."
  fi
else
  note "✗ gh CLI not installed; skipping GitHub Actions secret. Install: brew install gh"
fi

# 3) Re-render the local config (uses the env var; export it for the subshell)
echo "→ re-rendering .markdown-confluence.json …"
export CONFLUENCE_API_TOKEN="$NEW_TOKEN"
export CONFLUENCE_EMAIL="$EMAIL"
export CONFLUENCE_BASE_URL="$BASE"
export CONFLUENCE_SPACE_KEY="$SPACE"
export CONFLUENCE_PARENT_PAGE_ID="${CONFLUENCE_PARENT_PAGE_ID:-$(python3 -c "import json;print(json.load(open('.markdown-confluence.json')).get('confluenceParentId',''))" 2>/dev/null)}"
bash scripts/render-confluence-config.sh >/dev/null 2>&1 \
  && ok ".markdown-confluence.json re-rendered with new token" \
  || note "✗ render-confluence-config.sh failed — token IS in Keychain + GH; .markdown-confluence.json may be stale. Re-run \`make publish-docs\` to refresh."

# Clear the in-memory variable so it doesn't leak into child processes / history
unset NEW_TOKEN
unset CONFLUENCE_API_TOKEN

echo ""
echo "Next steps:"
echo "  1. Revoke the OLD token at https://id.atlassian.com/manage-profile/security/api-tokens"
echo "  2. (one-time, if not done) Add this to ~/.zshrc:"
echo "       export CONFLUENCE_API_TOKEN=\$(security find-generic-password -a \"\$USER\" -s \"$KEYCHAIN_SERVICE\" -w 2>/dev/null)"
echo "  3. Open a new shell (or source ~/.zshrc) and verify:"
echo "       scripts/rotate-confluence-token.sh --verify"
