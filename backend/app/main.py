from fastapi import FastAPI
from .config import load_settings

def create_app() -> FastAPI:
    app = FastAPI(title="adsb-game")
    settings = load_settings()
    app.state.settings = settings

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/api/config")
    def config():
        return {"home": {"lat": settings.home_lat, "lon": settings.home_lon}}

    return app

app = create_app()
