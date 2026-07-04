#!/usr/bin/env bash
#
# D10: placeholder / unfinished-copy gate.
#
# Fails the build if shipped page or component source contains developer TODO
# markers or user-facing filler copy. This is the static half of the D12/D10
# guarantee: a placeholder string in source is a placeholder rendered on screen.
#
# Scope: src/pages + src/components (the surfaces a user actually sees).
# Not flagged: input `placeholder=` attributes, CSS `placeholder:` selectors,
# the RouteMapCard <Placeholder> map component, and data fallbacks like
# "commodity TBD" (a graceful empty-value label, not unfinished work).
#
# Usage:  bash scripts/check-placeholders.sh
# Exit:   0 = clean, 1 = offenders found (printed with file:line).

set -euo pipefail

cd "$(dirname "$0")/.."

# Uppercase developer markers (word-boundaried so "hack" inside a word or a
# lowercase token in a URL example does not trip it), plus strong filler
# phrases that should never render in production.
MARKERS='\b(TODO|FIXME|HACK)\b'
FILLER='lorem ipsum|coming soon|under construction|not implemented yet|placeholder text|to be implemented'

status=0

markers_hits=$(grep -rnE "$MARKERS" src/pages src/components 2>/dev/null || true)
filler_hits=$(grep -rniE "$FILLER" src/pages src/components 2>/dev/null | grep -viE 'placeholder=' || true)

if [ -n "$markers_hits" ]; then
  echo "Placeholder gate: developer markers found in shipped UI source:"
  echo "$markers_hits"
  status=1
fi

if [ -n "$filler_hits" ]; then
  echo "Placeholder gate: filler copy found in shipped UI source:"
  echo "$filler_hits"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "Placeholder gate: clean (no TODO/FIXME/HACK markers or filler copy in src/pages + src/components)."
fi

exit "$status"
