#!/usr/bin/env bash
# Install LoadLead's git hooks + commit message template into this clone.
# Idempotent — safe to re-run.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOKS_SRC="$REPO_ROOT/scripts/hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

# 1) commit-msg hook
install -m 0755 "$HOOKS_SRC/commit-msg" "$HOOKS_DST/commit-msg"
echo "  installed: $HOOKS_DST/commit-msg"

# 2) commit message template
git config commit.template .gitmessage
echo "  configured: commit.template = .gitmessage"

echo
echo "Done. Try: git commit (your editor will show the template)."
echo "To require SCRUM keys: export JIRA_COMMIT_ENFORCE=block"
