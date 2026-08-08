"""
METAR client: current surface weather for one station, by ICAO id.

Source is NOAA's Aviation Weather Center JSON API (aviationweather.gov, keyless) - the same
honest-data discipline as the adsbdb client this is modelled on: a station with no current
report is a real "no METAR", NOT an invented reading, and an upstream outage is reported as
unavailable rather than faked or cached. The frontend picks the nearest ICAO station; this
module only ever looks up the one it is asked for.

We parse aviationweather.gov's structured `format=json` fields ourselves (no METAR-parsing
library, per the dependency rule) into a flat, all-nullable shape: every field the report
omits is null, which the panel renders as an em-dash. The only transform applied is the
altimeter, which the API gives in hectopascals and pilots read in inches of mercury.

Cache is a plain in-process dict keyed by ICAO, 10 min TTL, no persistence - fine for a
single-process homelab service, and METARs only refresh about hourly anyway.
"""
from __future__ import annotations

import re
import time
from typing import Any

import httpx

# METARs refresh roughly hourly; a 10 min cache spares aviationweather.gov a poll per browser
# tick without ever showing a report older than its real age (the panel shows observation age
# from obsTime, not from when we fetched it).
_CACHE_TTL_S = 10 * 60
# Cache stores the shaped METAR dict (or None for a real "station has no current report") -
# never an outage; `available` is derived fresh per call, since it is never the cached thing.
_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}

# Whitelist the id before interpolating it into the outbound query (hygiene, mirrors adsbdb):
# an ICAO station id is exactly four letters, so anything else is not a station we can query
# and is treated as a definite local "no METAR" rather than a wasted upstream call.
_ICAO_RE = re.compile(r"^[A-Z]{4}$")

ATTRIBUTION = "NOAA Aviation Weather Center · aviationweather.gov"

# 1 hPa = 0.0295299830714 inHg. The API reports altimeter in hectopascals; US altimeters read
# inches of mercury (the "A3012" group in the raw METAR), so we convert at the display edge.
_HPA_TO_INHG = 0.0295299830714

# Cloud covers that constitute a ceiling (a broken or worse layer). SCT/FEW do not.
_CEILING_COVERS = {"BKN", "OVC", "OVX"}


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _int(v: Any) -> int | None:
    n = _num(v)
    return int(n) if n is not None else None


def _str(v: Any) -> str | None:
    if isinstance(v, str):
        return v.strip() or None
    return None


def _visibility(v: Any) -> str | None:
    """
    Visibility comes through as a number (statute miles) or a string like "10+" (the API's own
    "10 or more" marker). Keep the string as-is - dropping the "+" would assert a precise value
    the report deliberately didn't give - and render a bare number without a trailing ".0".
    """
    if isinstance(v, str):
        return v.strip() or None
    n = _num(v)
    if n is None:
        return None
    return str(int(n)) if n == int(n) else str(n)


def _clouds(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    for layer in raw:
        if isinstance(layer, dict):
            out.append({"cover": _str(layer.get("cover")), "baseFt": _int(layer.get("base"))})
    return out


def _ceiling_ft(clouds: list[dict[str, Any]]) -> int | None:
    """Lowest broken-or-worse layer base, in feet - the aviation definition of a ceiling. A sky
    of only FEW/SCT layers (or a clear sky) has no ceiling, which is a real None, not a zero."""
    bases = [
        c["baseFt"]
        for c in clouds
        if c.get("cover") in _CEILING_COVERS and c.get("baseFt") is not None
    ]
    return min(bases) if bases else None


def shape_metar(rec: dict[str, Any]) -> dict[str, Any]:
    """
    One aviationweather.gov JSON record -> the flat shape the panel renders. Pure and total:
    every field is nullable and a missing/blank input becomes null (the panel's em-dash), never
    a substituted or zeroed value. Wind "VRB" (variable direction) is carried as a flag rather
    than a fake heading.
    """
    wdir_raw = rec.get("wdir")
    wind_variable = isinstance(wdir_raw, str) and wdir_raw.strip().upper() == "VRB"
    altim_hpa = _num(rec.get("altim"))
    clouds = _clouds(rec.get("clouds"))
    return {
        "obsTime": _int(rec.get("obsTime")),
        "windDirDeg": None if wind_variable else _int(wdir_raw),
        "windVariable": wind_variable,
        "windSpeedKt": _int(rec.get("wspd")),
        "windGustKt": _int(rec.get("wgst")),
        "visibility": _visibility(rec.get("visib")),
        "tempC": _num(rec.get("temp")),
        "dewpointC": _num(rec.get("dewp")),
        "altimInHg": round(altim_hpa * _HPA_TO_INHG, 2) if altim_hpa is not None else None,
        "clouds": clouds,
        "ceilingFt": _ceiling_ft(clouds),
        "flightCategory": _str(rec.get("fltCat")),
        "stationName": _str(rec.get("name")),
        "raw": _str(rec.get("rawOb")),
    }


def _shape(icao: str, metar: dict[str, Any] | None, *, available: bool) -> dict[str, Any]:
    return {
        "icao": icao,
        # True: aviationweather.gov answered. metar is either the report or None, and None then
        #   means a genuine "this station has no current METAR" (out of coverage, or just no
        #   report right now) - an honest empty state, not a fake one.
        # False: the lookup itself failed (network error, timeout, HTTP error). We do NOT know
        #   whether a report exists; the panel must show NO FEED, not "no METAR".
        "available": available,
        "metar": metar,
        "attribution": ATTRIBUTION,
    }


async def lookup(settings, icao: str) -> dict[str, Any]:
    """
    Cached GET {metar_base}?ids={ICAO}&format=json. Always returns the same dict shape - never a
    bare None - so a genuine "no current METAR for this station" (available=True, metar=None) is
    never confused with "aviationweather.gov did not answer" (available=False, metar=None). A
    non-ICAO id is rejected before any upstream call and treated as a definite local no-METAR.

    A genuine outage (network error, timeout, HTTP error, unparsable body) is deliberately NOT
    cached - an unreachable upstream must not pin "no METAR" into the cache for 10 min. Only an
    answer the API actually gave (a real report or a real empty list) is cache-worthy.
    """
    key = icao.strip().upper()
    if not _ICAO_RE.match(key):
        return _shape(key, None, available=True)
    cached = _cache.get(key)
    if cached and time.monotonic() < cached[0]:
        return _shape(key, cached[1], available=True)

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                settings.metar_base, params={"ids": key, "format": "json"}
            )
        resp.raise_for_status()
        body = resp.json()
    except Exception:  # noqa: BLE001 - outage, not a miss: report unavailable, don't cache it
        return _shape(key, None, available=False)

    # The API returns a JSON array; an empty array is a real "no current report for this station".
    record = body[0] if isinstance(body, list) and body and isinstance(body[0], dict) else None
    metar = shape_metar(record) if record is not None else None

    _cache[key] = (time.monotonic() + _CACHE_TTL_S, metar)
    return _shape(key, metar, available=True)
