#!/usr/bin/env bash
# Download one pinned OurAirports navaids snapshot and convert it into the bundled Gulf Coast
# VOR-family label index (frontend/src/data/navaids-vor.json). Public domain source.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAVAIDS_URL="${OURAIRPORTS_NAVAIDS_URL:-https://davidmegginson.github.io/ourairports-data/navaids.csv}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$NAVAIDS_URL" -o "$TMP_DIR/navaids.csv"

node "$REPO_ROOT/scripts/generate-ournavaids.mjs" \
  --input "$TMP_DIR/navaids.csv" \
  --output "$REPO_ROOT/frontend/src/data/navaids-vor.json"
