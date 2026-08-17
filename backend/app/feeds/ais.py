"""AIS ship feed — aisstream.io. Parallel to feeds/adsb.py; shares no code."""
from __future__ import annotations
import asyncio
import json as _json
import math
import time
from dataclasses import dataclass, field

# ITU ship-type bands (first digit ranges). Coarse but honest categories.
def decode_ship_type(code: int | None) -> str | None:
    if code is None:
        return None
    if code == 30:
        return "Fishing"
    if code in (31, 32, 52):
        return "Tug"
    if 60 <= code <= 69:
        return "Passenger"
    if 70 <= code <= 79:
        return "Cargo"
    if 80 <= code <= 89:
        return "Tanker"
    if 40 <= code <= 49:
        return "High-speed craft"
    if 50 <= code <= 59:
        return "Special craft"
    return "Other"

_NAV = {
    0: "Under way using engine", 1: "At anchor", 2: "Not under command",
    3: "Restricted manoeuvrability", 4: "Constrained by draught", 5: "Moored",
    6: "Aground", 7: "Engaged in fishing", 8: "Under way sailing",
}
def decode_nav_status(code: int | None) -> str | None:
    if code is None:
        return None
    return _NAV.get(code)  # 15/undefined → None (renders as em-dash)


@dataclass
class ShipReport:
    mmsi: str
    lat: float | None = None
    lon: float | None = None
    cog: float | None = None
    sog: float | None = None
    heading: float | None = None
    nav_status_code: int | None = None
    pos_time: float | None = None
    name: str | None = None
    type_code: int | None = None
    dim_a: int | None = None
    dim_b: int | None = None
    dim_c: int | None = None
    dim_d: int | None = None
    destination: str | None = None
    draught: float | None = None
    callsign: str | None = None
    static_time: float | None = None
    last_seen: float = field(default_factory=time.time)

    def apply_message(self, msg: dict, now: float | None = None) -> None:
        now = time.time() if now is None else now
        self.last_seen = now
        mtype = msg.get("MessageType")
        body = (msg.get("Message") or {}).get(mtype) or {}
        if mtype == "PositionReport":
            self.lat = body.get("Latitude", self.lat)
            self.lon = body.get("Longitude", self.lon)
            self.cog = body.get("Cog", self.cog)
            self.sog = body.get("Sog", self.sog)
            th = body.get("TrueHeading")
            # 511 = "not available" per spec
            self.heading = None if th in (None, 511) else th
            self.nav_status_code = body.get("NavigationalStatus", self.nav_status_code)
            self.pos_time = now
        elif mtype == "ShipStaticData":
            self.name = (body.get("Name") or "").strip() or self.name
            self.type_code = body.get("Type", self.type_code)
            dim = body.get("Dimension") or {}
            self.dim_a = dim.get("A", self.dim_a)
            self.dim_b = dim.get("B", self.dim_b)
            self.dim_c = dim.get("C", self.dim_c)
            self.dim_d = dim.get("D", self.dim_d)
            self.destination = (body.get("Destination") or "").strip() or self.destination
            self.draught = body.get("MaximumStaticDraught", self.draught)
            self.callsign = (body.get("CallSign") or "").strip() or self.callsign
            self.static_time = now


def _sum_dims(a, b):
    return (a + b) if (a is not None and b is not None) else None

def normalize(r: ShipReport, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    return {
        "mmsi": r.mmsi,
        "name": r.name,
        "ship_type": decode_ship_type(r.type_code),
        "lat": r.lat,
        "lon": r.lon,
        "cog": r.cog,
        "sog": r.sog,
        "heading": r.heading,
        "nav_status": decode_nav_status(r.nav_status_code),
        "length_m": _sum_dims(r.dim_a, r.dim_b),
        "beam_m": _sum_dims(r.dim_c, r.dim_d),
        "draught_m": r.draught,
        "destination": r.destination,
        "callsign": r.callsign,
        "seen": None if r.last_seen is None else round(now - r.last_seen, 1),
    }


def _nm_between(lat1, lon1, lat2, lon2):
    # equirectangular approximation, adequate for an 80nm browse radius
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    return math.degrees(math.hypot(dlat, dlon)) * 60.0  # 1 deg ≈ 60 nm

class AisStore:
    def __init__(self, ttl_s: int, offline_after_s: int, no_data_after_s: int = 180):
        self.ttl_s = ttl_s
        self.offline_after_s = offline_after_s
        self.no_data_after_s = no_data_after_s
        self._ships: dict[str, ShipReport] = {}
        self._last_message: float | None = None

    def apply(self, msg: dict, now: float | None = None) -> None:
        now = time.time() if now is None else now
        mmsi = str((msg.get("MetaData") or {}).get("MMSI") or "")
        if not mmsi:
            return
        r = self._ships.get(mmsi)
        if r is None:
            r = ShipReport(mmsi=mmsi)
            self._ships[mmsi] = r
        r.apply_message(msg, now=now)
        self._last_message = now

    def mark_message(self, now: float | None = None) -> None:
        self._last_message = time.time() if now is None else now

    def _prune(self, now: float) -> None:
        dead = [m for m, r in self._ships.items() if now - r.last_seen > self.ttl_s]
        for m in dead:
            del self._ships[m]

    def snapshot(self, lat: float, lon: float, radius_nm: float, now: float | None = None) -> list[dict]:
        now = time.time() if now is None else now
        self._prune(now)
        out = []
        for r in self._ships.values():
            if r.lat is None or r.lon is None:
                continue
            if _nm_between(lat, lon, r.lat, r.lon) <= radius_nm:
                out.append(normalize(r, now=now))
        return out

    def count(self, now: float | None = None) -> int:
        now = time.time() if now is None else now
        self._prune(now)
        return len(self._ships)

    def status(self, now: float | None = None, connected: bool = False) -> str:
        now = time.time() if now is None else now
        # Never connected and nothing ever received: genuinely offline.
        if self._last_message is None:
            return "nodata" if connected else "offline"
        if connected:
            # Socket is up (the websockets library's ping keepalive would have
            # closed a genuinely dead connection) — but that keepalive also
            # masks an upstream data outage, so don't report "live" on socket
            # health alone. Past no_data_after_s of silence, degrade to
            # "nodata": honest for an outage and for a genuinely quiet bbox.
            silence = now - self._last_message
            return "live" if silence <= self.no_data_after_s else "nodata"
        # Was connected, now disconnected: recently lost vs. truly offline.
        silence = now - self._last_message
        if silence <= self.offline_after_s:
            return "stale"
        return "offline"


@dataclass
class AisFeed:
    store: "AisStore"
    connected: bool = False


def subscribe_message(settings, lat: float, lon: float, radius_nm: float) -> dict:
    # bbox from center + radius (1 deg lat ≈ 60 nm; widen lon by latitude)
    dlat = radius_nm / 60.0
    dlon = radius_nm / (60.0 * max(0.1, math.cos(math.radians(lat))))
    return {
        "APIKey": settings.ais_api_key,
        "BoundingBoxes": [[[lat - dlat, lon - dlon], [lat + dlat, lon + dlon]]],
        "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
    }


async def run_ws_client(settings, feed: "AisFeed", *, connect=None, stop_event=None,
                        lat=None, lon=None, radius_nm=80, once=False):
    """Maintain the aisstream WS, feeding feed.store. `connect` is injectable for tests."""
    if not settings.ais_enabled or not settings.ais_api_key:
        feed.connected = False
        return
    if connect is None:
        import websockets
        connect = websockets.connect
    lat = settings.home_lat if lat is None else lat
    lon = settings.home_lon if lon is None else lon
    backoff = 1.0
    while stop_event is None or not stop_event.is_set():
        try:
            ws = await connect(settings.ais_ws_url)
            await ws.send(_json.dumps(subscribe_message(settings, lat, lon, radius_nm)))
            feed.connected = True
            backoff = 1.0
            async for raw in ws:
                try:
                    feed.store.apply(_json.loads(raw))
                except (ValueError, TypeError):
                    continue  # skip malformed frame, never fabricate
            # the async-for ended: socket drained (test `once` path) or the
            # connection actually closed. Only the latter is a real disconnect.
            if once:
                return
            feed.connected = False
        except Exception:
            feed.connected = False
            if once:
                return
        if stop_event is not None:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=backoff)
            except asyncio.TimeoutError:
                pass
        backoff = min(backoff * 2, 30.0)
