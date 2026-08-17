#!/usr/bin/env bash
# Deploy the Worker using your private, gitignored wrangler.prod.jsonc.
#
# The committed wrangler.jsonc is a neutral public template (placeholders, no real
# account/domain values). The @cloudflare/vite-plugin build and `wrangler deploy` are
# both driven by wrangler.jsonc, so we transiently swap your real overlay into place,
# build + deploy exactly as before, then always restore the neutral template — even on
# failure or Ctrl-C. Nothing real is ever left in the tracked wrangler.jsonc.
#
# Usage: bash scripts/deploy-with-overlay.sh <staging|production>
set -euo pipefail

ENV="${1:-}"
if [ "$ENV" != "staging" ] && [ "$ENV" != "production" ]; then
  echo "usage: bash scripts/deploy-with-overlay.sh <staging|production>" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

if [ ! -f wrangler.prod.jsonc ]; then
  echo "wrangler.prod.jsonc not found." >&2
  echo "Copy the template and fill in your real values:" >&2
  echo "  cp wrangler.prod.example.jsonc wrangler.prod.jsonc" >&2
  exit 1
fi

BACKUP=".wrangler.neutral.$$"
cp wrangler.jsonc "$BACKUP"
restore() { mv -f "$BACKUP" wrangler.jsonc 2>/dev/null || true; }
trap restore EXIT INT TERM

# Swap the real overlay into the config the plugin + wrangler read.
cp wrangler.prod.jsonc wrangler.jsonc

# production gates on the required-secrets check; staging does not have one.
if [ "$ENV" = "production" ]; then
  npm run check:secrets:production
  CLOUDFLARE_ENV=production npm run build
  wrangler deploy --env production
else
  CLOUDFLARE_ENV=staging npm run build
  wrangler deploy
fi
