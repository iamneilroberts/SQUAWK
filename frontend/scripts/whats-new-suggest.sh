#!/usr/bin/env bash
# Suggest What's New entries: list feat(...) commit subjects since a date, so a human can curate
# them into frontend/src/data/whatsNew.ts (major features only — NOT minor fixes).
#
# Usage:
#   bash scripts/whats-new-suggest.sh [SINCE_DATE]
# SINCE_DATE defaults to the newest date already in whatsNew.ts (so you see only what's new since).
set -euo pipefail
cd "$(dirname "$0")/.."

SINCE="${1:-}"
if [ -z "$SINCE" ]; then
  # Newest date in the curated file: first "date: \"YYYY-MM-DD\"" line, top-of-list = newest.
  SINCE="$(grep -oE 'date: "[0-9]{4}-[0-9]{2}-[0-9]{2}"' src/data/whatsNew.ts | head -1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')"
fi

echo "feat commits since ${SINCE} (curate the MAJOR ones into src/data/whatsNew.ts):"
git log --no-merges --since="${SINCE}" --pretty="%ad  %s" --date=short | grep -E '  feat' || echo "  (none)"
