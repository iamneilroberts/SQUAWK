"""
adsbdb enrichment client: aircraft type/manufacturer/registration by ICAO hex.

Trimmed to this project's single lookup - no route/callsign enrichment, no photo handling
(out of scope here). A miss is a miss: adsbdb answers 404 for an unknown hex, and this comes
back as all-null fields rather than an invented registration.

Cache is a plain in-process dict keyed by hex, 24h TTL, no persistence - fine for a
single-process homelab service that restarts rarely.
"""
from __future__ import annotations

import re
import time
from typing import Any

import httpx

_CACHE_TTL_S = 24 * 60 * 60
# Cache stores the raw `response.aircraft` dict (or None for a real miss) - never an outage;
# `available` is derived fresh on every call, not stored, since it is never the cached thing.
_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}

# Whitelist the hex before interpolating it into the outbound URL (hygiene, mirrors LORAN):
# rejects anything but hex digits, so path junk never reaches adsbdb and garbage lookups
# don't waste an upstream call. ICAO addresses are 6 nibbles; allow 1-8 for tolerance.
_HEX_RE = re.compile(r"^[0-9A-F]{1,8}$")


def _shape(aircraft: dict[str, Any] | None, *, available: bool) -> dict[str, Any]:
    return {
        "type": aircraft.get("type") if aircraft else None,
        "manufacturer": aircraft.get("manufacturer") if aircraft else None,
        "registration": aircraft.get("registration") if aircraft else None,
        # True: adsbdb answered (a real 404 or a real 200 both count as an answer) - the
        # fields above, if null, are a genuine "adsbdb has never heard of this hex".
        # False: the lookup itself failed (network error, timeout, non-404 HTTP error) - we
        # do NOT know whether adsbdb has a record; the caller must not report "no record".
        "available": available,
    }


async def lookup(settings, hexcode: str) -> dict[str, Any]:
    """
    Cached GET {adsbdb_base}/aircraft/{hex}. Always returns a dict with `type`,
    `manufacturer`, `registration` and `available` - never a bare None - so a genuine
    "adsbdb has no record for this hex" (available=True, all three fields null) is never
    confused with "adsbdb did not answer" (available=False, all three fields null too, since
    there is nothing else honest to put there). Misses are cached (available is always True
    for a cache hit, since only real answers are cached); a malformed hex is rejected before
    any upstream call and is treated the same as a real miss, since it is a definite local
    answer, not an outage.

    A genuine outage (network error, timeout, non-404 HTTP error, unparsable body) is
    deliberately NOT cached - an unreachable adsbdb must not pin "unknown" into the cache for
    24h. Only an answer adsbdb actually gave us (a real 200 body or a real 404) is
    cache-worthy.
    """
    key = hexcode.strip().upper()
    if not _HEX_RE.match(key):
        return _shape(None, available=True)
    cached = _cache.get(key)
    if cached and time.monotonic() < cached[0]:
        return _shape(cached[1], available=True)

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(f"{settings.adsbdb_base}/aircraft/{key}")
        if resp.status_code != 404:
            resp.raise_for_status()
        body = None if resp.status_code == 404 else resp.json()
    except Exception:  # noqa: BLE001 - outage, not a miss: report unavailable, don't cache it
        return _shape(None, available=False)

    response = body.get("response") if isinstance(body, dict) else None
    aircraft = response.get("aircraft") if isinstance(response, dict) else None
    value = aircraft if isinstance(aircraft, dict) else None

    _cache[key] = (time.monotonic() + _CACHE_TTL_S, value)
    return _shape(value, available=True)
