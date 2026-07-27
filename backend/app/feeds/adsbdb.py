"""
adsbdb enrichment client: aircraft type/manufacturer/registration by ICAO hex.

Trimmed to this project's single lookup - no route/callsign enrichment, no photo handling
(out of scope here). A miss is a miss: adsbdb answers 404 for an unknown hex, and this comes
back as None rather than an invented registration.

Cache is a plain in-process dict keyed by hex, 24h TTL, no persistence - fine for a
single-process homelab service that restarts rarely.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

_CACHE_TTL_S = 24 * 60 * 60
_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}


async def lookup(settings, hexcode: str) -> dict[str, Any] | None:
    """
    Cached GET {adsbdb_base}/aircraft/{hex}. Returns the `response.aircraft` dict, or None
    when adsbdb has never heard of this hex (404, or a malformed body). Misses are cached
    too, so an unknown hex is not re-asked on every request.
    """
    key = hexcode.strip().upper()
    cached = _cache.get(key)
    if cached and time.monotonic() < cached[0]:
        return cached[1]

    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.get(f"{settings.adsbdb_base}/aircraft/{key}")

    if resp.status_code == 404:
        value = None
    else:
        resp.raise_for_status()
        body = resp.json()
        aircraft = body.get("response", {}).get("aircraft") if isinstance(body, dict) else None
        value = aircraft if isinstance(aircraft, dict) else None

    _cache[key] = (time.monotonic() + _CACHE_TTL_S, value)
    return value
