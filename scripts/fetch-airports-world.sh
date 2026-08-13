#!/usr/bin/env bash
# Rebuild the bundled airport LABEL index (frontend/src/data/airports-world.json) from a pinned
# OurAirports snapshot — large + medium airports with names. Public domain source.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AIRPORTS_URL="${OURAIRPORTS_AIRPORTS_URL:-https://davidmegginson.github.io/ourairports-data/airports.csv}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$AIRPORTS_URL" -o "$TMP_DIR/airports.csv"

node "$REPO_ROOT/scripts/generate-airports-world.mjs" \
  --input "$TMP_DIR/airports.csv" \
  --output "$REPO_ROOT/frontend/src/data/airports-world.json"
