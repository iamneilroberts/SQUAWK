import os
from dataclasses import dataclass

@dataclass(frozen=True)
class Settings:
    home_lat: float
    home_lon: float
    feed_primary: str
    feed_fallback: str
    feed_reserve: str
    adsbdb_base: str
    metar_base: str
    feed_min_interval_s: float
    host: str
    port: int
    ais_enabled: bool = True
    ais_api_key: str = ""
    ais_ws_url: str = "wss://stream.aisstream.io/v0/stream"
    ais_ttl_s: int = 600
    ais_offline_after_s: int = 30
    ais_no_data_after_s: int = 180

def load_settings() -> Settings:
    e = os.environ.get
    return Settings(
        home_lat=float(e("HOME_LAT", "30.6944")),
        home_lon=float(e("HOME_LON", "-88.0399")),
        feed_primary=e("FEED_PRIMARY", "https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}"),
        feed_fallback=e("FEED_FALLBACK", "https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius}"),
        feed_reserve=e("FEED_RESERVE", "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{radius}"),
        adsbdb_base=e("ADSBDB_BASE", "https://api.adsbdb.com/v0"),
        metar_base=e("METAR_BASE", "https://aviationweather.gov/api/data/metar"),
        feed_min_interval_s=float(e("FEED_MIN_INTERVAL_S", "1.0")),
        host=e("ADSB_GAME_HOST", "127.0.0.1"),
        port=int(e("ADSB_GAME_PORT", "8020")),
        ais_enabled=e("AIS_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on"),
        ais_api_key=e("AIS_API_KEY", ""),
        ais_ws_url=e("AIS_WS_URL", "wss://stream.aisstream.io/v0/stream"),
        ais_ttl_s=int(e("AIS_TTL_S", "600")),
        ais_offline_after_s=int(e("AIS_OFFLINE_AFTER_S", "30")),
        ais_no_data_after_s=int(e("AIS_NO_DATA_AFTER_S", "180")),
    )
