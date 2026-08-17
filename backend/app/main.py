import asyncio
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from .config import load_settings
from .feeds import adsb, adsbdb, metar
from .feeds import ais as ais_feed

def create_app() -> FastAPI:
    settings = load_settings()
    feed = ais_feed.AisFeed(
        ais_feed.AisStore(settings.ais_ttl_s, settings.ais_offline_after_s, settings.ais_no_data_after_s)
    )
    stop = asyncio.Event()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(ais_feed.run_ws_client(settings, feed, stop_event=stop))
        try:
            yield
        finally:
            stop.set()
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    app = FastAPI(title="adsb-game", lifespan=lifespan)
    app.state.settings = settings
    app.state.ais_feed = feed

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/api/config")
    def config():
        return {"home": {"lat": settings.home_lat, "lon": settings.home_lon}}

    @app.get("/api/adsb")
    async def get_adsb(lat: float, lon: float, radius_nm: int = Query(ge=10, le=250)):
        try:
            return await adsb.fetch_adsb(settings, lat, lon, radius_nm)
        except adsb.FeedUnavailable:
            raise HTTPException(status_code=502, detail="all feeds unavailable")

    @app.get("/api/type/{hex}")
    async def get_type(hex: str):
        data = await adsbdb.lookup(settings, hex)
        return {
            "type": data["type"],
            "manufacturer": data["manufacturer"],
            "registration": data["registration"],
            "available": data["available"],
        }

    @app.get("/api/metar/{icao}")
    async def get_metar(icao: str):
        return await metar.lookup(settings, icao)

    @app.get("/api/ais")
    async def get_ais(lat: float, lon: float, radius_nm: int = Query(ge=10, le=250)):
        return {
            "contacts": feed.store.snapshot(lat, lon, radius_nm),
            "source": "aisstream.io",
            "fetched_at": int(time.time()),
            "status": feed.store.status(connected=feed.connected),
        }

    return app

app = create_app()
