#!/usr/bin/env bash
# Download one pinned OurAirports snapshot and convert it into immutable regional shards.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AIRPORTS_URL="${OURAIRPORTS_AIRPORTS_URL:-https://davidmegginson.github.io/ourairports-data/airports.csv}"
RUNWAYS_URL="${OURAIRPORTS_RUNWAYS_URL:-https://davidmegginson.github.io/ourairports-data/runways.csv}"
SOURCE_DATE="${OURAIRPORTS_SOURCE_DATE:-$(date -u +%F)}"
DATASET_VERSION="${OURAIRPORTS_DATASET_VERSION:-oa-${SOURCE_DATE}-v1}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$AIRPORTS_URL" -o "$TMP_DIR/airports.csv"
curl -fsSL "$RUNWAYS_URL" -o "$TMP_DIR/runways.csv"

node "$REPO_ROOT/scripts/generate-ourairports.mjs" \
  --airports "$TMP_DIR/airports.csv" \
  --runways "$TMP_DIR/runways.csv" \
  --output "$REPO_ROOT/frontend/public/data/airports" \
  --version "$DATASET_VERSION" \
  --source-date "$SOURCE_DATE" \
  --airports-url "$AIRPORTS_URL" \
  --runways-url "$RUNWAYS_URL"

node "$REPO_ROOT/scripts/generate-ourairports.mjs" \
  --validate "$REPO_ROOT/frontend/public/data/airports/$DATASET_VERSION/manifest.json"
