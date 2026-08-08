"""
Tests for the METAR proxy (issue #10). Mirrors the adsbdb proxy tests: the upstream is always
stubbed with an httpx.MockTransport - no test ever touches the live aviationweather.gov API.

Two layers:
  * shape_metar()  - the pure JSON->flat-shape parser. Broken-arm cases: unit conversion,
                     ceiling selection, missing fields -> null, variable wind.
  * lookup()       - exercised through the /api/metar/{icao} endpoint (as adsbdb's are through
                     /api/type): success, no-report, outage-is-honest-and-not-cached, caching,
                     non-ICAO rejected without an upstream call.
"""
import httpx
from fastapi.testclient import TestClient

from app.feeds import metar
from app.main import create_app

# A full record, shaped like a real aviationweather.gov row (see the one confirmed live call in
# the PR notes). Broken/overcast layers plus a low scattered layer, so ceiling selection has to
# actually pick the lowest broken-or-worse and ignore the SCT.
FULL_RECORD = {
    "icaoId": "KMOB",
    "obsTime": 1786154160,
    "temp": 25.6,
    "dewp": 22.8,
    "wdir": 180,
    "wspd": 12,
    "wgst": 21,
    "visib": "10+",
    "altim": 1020.1,
    "clouds": [
        {"cover": "SCT", "base": 1800},
        {"cover": "BKN", "base": 2500},
        {"cover": "OVC", "base": 8000},
    ],
    "fltCat": "VFR",
    "name": "Mobile Rgnl, AL, US",
    "rawOb": "METAR KMOB 080156Z 18012G21KT 10SM SCT018 BKN025 OVC080 26/23 A3012",
}


# Captured once, before any test monkeypatches metar.httpx.AsyncClient - a test that stubs the
# upstream twice (outage, then recovery) must wrap the GENUINE client the second time, not the
# first stub (metar.httpx is the httpx module itself, so patching it patches this name too).
_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _mock_client(monkeypatch, handler):
    monkeypatch.setattr(
        metar.httpx, "AsyncClient",
        lambda *a, **kw: _REAL_ASYNC_CLIENT(*a, transport=httpx.MockTransport(handler), **kw),
    )


# ----- shape_metar: the pure parser -----------------------------------------------------------

def test_shape_extracts_the_reported_fields():
    m = metar.shape_metar(FULL_RECORD)
    assert m["obsTime"] == 1786154160
    assert m["windDirDeg"] == 180
    assert m["windVariable"] is False
    assert m["windSpeedKt"] == 12
    assert m["windGustKt"] == 21
    assert m["visibility"] == "10+"
    assert m["tempC"] == 25.6
    assert m["dewpointC"] == 22.8
    assert m["flightCategory"] == "VFR"
    assert m["stationName"] == "Mobile Rgnl, AL, US"
    assert m["raw"].startswith("METAR KMOB")


def test_shape_converts_altimeter_hpa_to_inhg():
    """The API reports hPa (1020.1); the raw METAR's altimeter group is A3012 = 30.12 inHg. A
    naive pass-through of the hPa number would put "1020.1 IN" on a US altimeter."""
    assert metar.shape_metar(FULL_RECORD)["altimInHg"] == 30.12


def test_shape_ceiling_is_lowest_broken_or_worse_not_the_scattered_layer():
    """Ceiling is the lowest BKN/OVC base (2500), never the lower SCT018 (1800) - scattered is
    not a ceiling."""
    assert metar.shape_metar(FULL_RECORD)["ceilingFt"] == 2500


def test_shape_no_ceiling_when_only_few_or_scattered():
    m = metar.shape_metar({"clouds": [{"cover": "FEW", "base": 3000}, {"cover": "SCT", "base": 12000}]})
    assert m["ceilingFt"] is None
    assert [c["cover"] for c in m["clouds"]] == ["FEW", "SCT"]


def test_shape_missing_fields_become_null_never_zero():
    """An empty record must yield all-null fields (the panel's em-dash), never fabricated zeros -
    the whole point of the honest-data rule. A gust of 0 KT is a fake reading, not "no gust"."""
    m = metar.shape_metar({})
    for field in (
        "obsTime", "windDirDeg", "windSpeedKt", "windGustKt", "visibility",
        "tempC", "dewpointC", "altimInHg", "ceilingFt", "flightCategory", "stationName", "raw",
    ):
        assert m[field] is None, f"{field} should be None on an empty record, got {m[field]!r}"
    assert m["clouds"] == []


def test_shape_variable_wind_is_a_flag_not_a_fake_heading():
    m = metar.shape_metar({"wdir": "VRB", "wspd": 4})
    assert m["windVariable"] is True
    assert m["windDirDeg"] is None
    assert m["windSpeedKt"] == 4


# ----- lookup(), through the endpoint --------------------------------------------------------

def test_metar_success_returns_shaped_report_and_attribution(monkeypatch):
    metar._cache.clear()
    _mock_client(monkeypatch, lambda request: httpx.Response(200, json=[FULL_RECORD]))
    client = TestClient(create_app())
    r = client.get("/api/metar/KMOB")
    assert r.status_code == 200
    body = r.json()
    assert body["icao"] == "KMOB"
    assert body["available"] is True
    assert body["metar"]["windSpeedKt"] == 12
    assert body["metar"]["altimInHg"] == 30.12
    assert "aviationweather.gov" in body["attribution"]


def test_metar_empty_array_is_honest_no_report_not_outage(monkeypatch):
    """A station with no current report: the API answers with an empty list. That is available=True
    with metar=None (an honest "no METAR"), NOT available=False and NOT a synthesized reading."""
    metar._cache.clear()
    _mock_client(monkeypatch, lambda request: httpx.Response(200, json=[]))
    client = TestClient(create_app())
    r = client.get("/api/metar/KXYZ")
    assert r.status_code == 200
    assert r.json() == {
        "icao": "KXYZ", "available": True, "metar": None, "attribution": metar.ATTRIBUTION,
    }


def test_metar_outage_is_honest_and_not_cached(monkeypatch):
    """A genuine upstream outage degrades to available=False, metar=None (NO FEED, distinct from
    "no report") and must NOT be cached, so a later good lookup for the same station isn't blocked
    for 10 min by a transient failure."""
    metar._cache.clear()

    def dead(request):
        raise httpx.ConnectError("boom", request=request)
    _mock_client(monkeypatch, dead)
    client = TestClient(create_app())
    r = client.get("/api/metar/KMOB")
    assert r.status_code == 200
    assert r.json()["available"] is False
    assert r.json()["metar"] is None
    assert "KMOB" not in metar._cache

    _mock_client(monkeypatch, lambda request: httpx.Response(200, json=[FULL_RECORD]))
    r2 = client.get("/api/metar/KMOB")
    assert r2.json()["available"] is True
    assert r2.json()["metar"]["windSpeedKt"] == 12


def test_metar_second_call_is_served_from_cache_without_an_upstream_hit(monkeypatch):
    metar._cache.clear()
    calls = {"n": 0}

    def counting(request):
        calls["n"] += 1
        return httpx.Response(200, json=[FULL_RECORD])
    _mock_client(monkeypatch, counting)
    client = TestClient(create_app())
    client.get("/api/metar/KMOB")
    client.get("/api/metar/KMOB")
    assert calls["n"] == 1, "second identical lookup must hit the cache, not the upstream"


def test_metar_non_icao_id_rejected_without_upstream(monkeypatch):
    """A local (non-ICAO) ident is not a station we can query; it must degrade to an honest
    no-METAR without any upstream call (URL hygiene, mirrors the adsbdb malformed-hex path)."""
    metar._cache.clear()

    def explode(*a, **kw):
        raise AssertionError("no upstream call should be made for a non-ICAO id")
    monkeypatch.setattr(metar.httpx, "AsyncClient", explode)
    client = TestClient(create_app())
    r = client.get("/api/metar/5A8")  # a real OurAirports local ident, not an ICAO code
    assert r.status_code == 200
    assert r.json() == {
        "icao": "5A8", "available": True, "metar": None, "attribution": metar.ATTRIBUTION,
    }
