# adsb-game backend — FastAPI proxy for live ADS-B feeds.
# Slim base; only requirements.txt + app/ go in (no .venv, that's bare-metal-dev only).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Port/host are overridden by env at runtime (ADSB_GAME_HOST/ADSB_GAME_PORT via .env),
# but uvicorn needs literal values here since compose doesn't expand vars into CMD.
# Bind 0.0.0.0 so the frontend container can reach it; 8020 matches the backend's
# default (see docs/decisions.md G-006 — 8010 is a different app's prod port on this box).
EXPOSE 8020
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8020"]
