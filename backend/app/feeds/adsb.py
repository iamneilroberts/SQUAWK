"""
ADS-B feed client: one normalizer, three interchangeable readsb/tar1090 sources.

All three configured feeds (airplanes.live, adsb.lol, adsb.fi) serve the same schema; the
only differences are the envelope key ("ac" vs "aircraft") and which enrichment fields are
present. Units are feet and knots throughout - do not mix with metric sources.

Adapted from LORAN's backend/app/feeds/adsb.py, trimmed to this project's smaller contact
shape and its single failover fetch function (no persistent client, no tracks, no viewport
math - those are out of scope here).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any
from urllib.parse import urlparse

import httpx


class FeedUnavailable(Exception):
    """Raised when primary, fallback, and reserve all failed."""


def build_url(template: str, lat: float, lon: float, radius_nm: int) -> str:
    """
    Feed env vars are full URL templates, not bases (G-005): upstream path shapes differ per
    feed - airplanes.live takes /point/{lat}/{lon}/{radius}, adsb.lol and adsb.fi take
    /lat/{lat}/lon/{lon}/dist/{radius}. A single base+path convention can't express that, so
    each configured template carries its own {lat}/{lon}/{radius} placeholders.
    """
    return template.format(lat=lat, lon=lon, radius=int(radius_nm))


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _str(v: Any) -> str | None:
    if isinstance(v, str):
        return v.strip() or None
    return None


def normalize(payload: dict) -> list[dict]:
    """
    Readsb envelope -> list of contacts. Accepts {"ac": [...]} (airplanes.live, adsb.lol)
    or {"aircraft": [...]} (adsb.fi). Records without both lat and lon are dropped.
    """
    rows = payload.get("ac")
    if rows is None:
        rows = payload.get("aircraft")
    if not isinstance(rows, list):
        return []

    contacts = []
    for raw in rows:
        lat, lon = _num(raw.get("lat")), _num(raw.get("lon"))
        if lat is None or lon is None:
            continue

        alt_baro_raw = raw.get("alt_baro")
        alt_baro = alt_baro_raw if alt_baro_raw == "ground" else _num(alt_baro_raw)

        try:
            db_flags = int(raw.get("dbFlags") or 0)
        except (TypeError, ValueError):
            db_flags = 0

        contacts.append({
            "hex": _str(raw.get("hex")),
            "flight": _str(raw.get("flight")),
            "t": _str(raw.get("t")),
            "lat": lat,
            "lon": lon,
            "alt_geom": int(g) if (g := _num(raw.get("alt_geom"))) is not None else None,
            "alt_baro": int(alt_baro) if isinstance(alt_baro, float) else alt_baro,
            "gs": _num(raw.get("gs")),
            "track": _num(raw.get("track")),
            "baro_rate": int(r) if (r := _num(raw.get("baro_rate"))) is not None else None,
            "military": bool(db_flags & 1),
            "seen_pos": _num(raw.get("seen_pos")),
        })
    return contacts


_last_upstream = 0.0
_upstream_lock = asyncio.Lock()
_cache: dict[tuple[float, float, int], tuple[float, dict]] = {}
_CACHE_TTL_S = 2.0


async def fetch_adsb(settings, lat: float, lon: float, radius_nm: int) -> dict:
    """
    Try primary -> fallback -> reserve, honouring settings.feed_min_interval_s between
    upstream calls and caching the last good result for a couple of seconds so bursts of
    browser polls don't multiply upstream load.
    """
    global _last_upstream

    key = (round(lat, 2), round(lon, 2), radius_nm)
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < _CACHE_TTL_S:
        return cached[1]

    templates = (settings.feed_primary, settings.feed_fallback, settings.feed_reserve)
    errors = []
    async with httpx.AsyncClient(timeout=12.0) as client:
        for template in templates:
            url = build_url(template, lat, lon, radius_nm)
            try:
                async with _upstream_lock:
                    wait = settings.feed_min_interval_s - (time.monotonic() - _last_upstream)
                    if wait > 0:
                        await asyncio.sleep(wait)
                    resp = await client.get(url)
                    resp.raise_for_status()
                    payload = resp.json()
                    _last_upstream = time.monotonic()

                result = {
                    "contacts": normalize(payload),
                    "source": urlparse(url).netloc,
                    "fetched_at": int(time.time()),
                }
                _cache[key] = (time.monotonic(), result)
                return result
            except Exception as e:  # noqa: BLE001 - report, then fail over to next source
                errors.append(f"{url}: {type(e).__name__}: {e}")

    raise FeedUnavailable("; ".join(errors))
