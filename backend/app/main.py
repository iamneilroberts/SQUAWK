from fastapi import FastAPI, HTTPException
from .config import load_settings
from .feeds import adsb, adsbdb

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

    @app.get("/api/adsb")
    async def get_adsb(lat: float, lon: float, radius_nm: int):
        try:
            return await adsb.fetch_adsb(settings, lat, lon, radius_nm)
        except adsb.FeedUnavailable:
            raise HTTPException(status_code=502, detail="all feeds unavailable")

    @app.get("/api/type/{hex}")
    async def get_type(hex: str):
        data = await adsbdb.lookup(settings, hex)
        return {
            "type": data.get("type") if data else None,
            "manufacturer": data.get("manufacturer") if data else None,
            "registration": data.get("registration") if data else None,
        }

    return app

app = create_app()
