#!/usr/bin/env bash
# Bare-metal dev: runs the backend (uvicorn, from backend/.venv) and the frontend
# (vite dev server) together. Ctrl-C stops both. Run from anywhere: `bash scripts/dev.sh`.
#
# Bootstraps what a fresh clone is missing (backend/.venv, frontend/node_modules) before
# starting either server. Both are gitignored, so a first run always creates them; a
# second run finds them already there and skips straight to starting the servers.
set -e
cd "$(dirname "$0")/.."

# config.py reads os.environ directly (no dotenv dependency in this phase), so export
# .env's vars into this shell if the file exists; falls back to code defaults otherwise.
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

if [ ! -x backend/.venv/bin/uvicorn ]; then
  echo "dev.sh: backend/.venv missing or incomplete -- creating it and installing requirements..."
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --quiet --upgrade pip
  backend/.venv/bin/pip install --quiet -r backend/requirements.txt
fi

# `npm ls` exits non-zero if node_modules is missing, or present but incomplete/mismatched
# against package-lock.json (e.g. an interrupted `npm ci` left a partial install) --
# unlike a directory-existence check, this self-heals from a half-finished first run.
if ! (cd frontend && npm ls --silent >/dev/null 2>&1); then
  echo "dev.sh: frontend/node_modules missing or incomplete -- running npm ci..."
  (cd frontend && npm ci)
fi

backend/.venv/bin/uvicorn app.main:app --reload --app-dir backend --host 127.0.0.1 --port "${ADSB_GAME_PORT:-8020}" &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null' EXIT

(cd frontend && npm run dev)
