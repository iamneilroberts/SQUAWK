#!/usr/bin/env bash
# Bare-metal dev: runs the backend (uvicorn, from backend/.venv) and the frontend
# (vite dev server) together. Ctrl-C stops both. Run from anywhere: `bash scripts/dev.sh`.
set -e
cd "$(dirname "$0")/.."

# config.py reads os.environ directly (no dotenv dependency in this phase), so export
# .env's vars into this shell if the file exists; falls back to code defaults otherwise.
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

backend/.venv/bin/uvicorn app.main:app --reload --app-dir backend --host 127.0.0.1 --port "${ADSB_GAME_PORT:-8020}" &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null' EXIT

(cd frontend && npm run dev)
