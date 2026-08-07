from fastapi.testclient import TestClient
from app.main import create_app

def test_healthz():
    client = TestClient(create_app())
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True}

def test_config_serves_home(monkeypatch):
    monkeypatch.setenv("HOME_LAT", "10.5")
    monkeypatch.setenv("HOME_LON", "-20.25")
    client = TestClient(create_app())
    home = client.get("/api/config").json()["home"]
    assert home == {"lat": 10.5, "lon": -20.25}

def test_adsb_endpoint_proxies(monkeypatch):
    from app.feeds import adsb as feeds
    async def fake_fetch(settings, lat, lon, radius_nm):
        return {"contacts": [], "source": "test", "fetched_at": 0}
    monkeypatch.setattr(feeds, "fetch_adsb", fake_fetch)
    client = TestClient(create_app())
    r = client.get("/api/adsb?lat=30.69&lon=-88.04&radius_nm=80")
    assert r.status_code == 200 and r.json()["source"] == "test"

def test_adsb_endpoint_rejects_radius_below_minimum(monkeypatch):
    from app.feeds import adsb as feeds
    async def fake_fetch(settings, lat, lon, radius_nm):
        return {"contacts": [], "source": "test", "fetched_at": 0}
    monkeypatch.setattr(feeds, "fetch_adsb", fake_fetch)
    client = TestClient(create_app())
    r = client.get("/api/adsb?lat=30.69&lon=-88.04&radius_nm=9")
    assert r.status_code == 422

def test_adsb_endpoint_rejects_radius_above_maximum(monkeypatch):
    from app.feeds import adsb as feeds
    async def fake_fetch(settings, lat, lon, radius_nm):
        return {"contacts": [], "source": "test", "fetched_at": 0}
    monkeypatch.setattr(feeds, "fetch_adsb", fake_fetch)
    client = TestClient(create_app())
    r = client.get("/api/adsb?lat=30.69&lon=-88.04&radius_nm=251")
    assert r.status_code == 422

def test_adsb_endpoint_accepts_radius_at_maximum(monkeypatch):
    from app.feeds import adsb as feeds
    async def fake_fetch(settings, lat, lon, radius_nm):
        return {"contacts": [], "source": "test", "fetched_at": 0}
    monkeypatch.setattr(feeds, "fetch_adsb", fake_fetch)
    client = TestClient(create_app())
    r = client.get("/api/adsb?lat=30.69&lon=-88.04&radius_nm=250")
    assert r.status_code == 200

def test_adsb_endpoint_feeds_down(monkeypatch):
    from app.feeds import adsb as feeds
    async def dead(settings, lat, lon, radius_nm):
        raise feeds.FeedUnavailable()
    monkeypatch.setattr(feeds, "fetch_adsb", dead)
    client = TestClient(create_app())
    assert client.get("/api/adsb?lat=1&lon=2&radius_nm=10").status_code == 502

def test_type_unknown_is_honest_nones(monkeypatch):
    from app.feeds import adsbdb
    async def miss(settings, hexcode):
        return {"type": None, "manufacturer": None, "registration": None, "available": True}
    monkeypatch.setattr(adsbdb, "lookup", miss)
    client = TestClient(create_app())
    r = client.get("/api/type/000000")
    assert r.status_code == 200
    assert r.json() == {
        "type": None, "manufacturer": None, "registration": None, "available": True,
    }

def test_type_malformed_body_collapses_to_none(monkeypatch):
    """A 200 with {"response": null} must not crash lookup() with an AttributeError. adsbdb DID
    answer here (a 200), so this is a genuine no-record, not an outage: available stays True."""
    import httpx
    from app.feeds import adsbdb
    adsbdb._cache.clear()

    def handler(request):
        return httpx.Response(200, json={"response": None})
    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        adsbdb.httpx, "AsyncClient",
        lambda *a, **kw: real_async_client(*a, transport=httpx.MockTransport(handler), **kw),
    )
    client = TestClient(create_app())
    r = client.get("/api/type/000000")
    assert r.status_code == 200
    assert r.json() == {
        "type": None, "manufacturer": None, "registration": None, "available": True,
    }

def test_type_real_404_is_no_record_not_outage(monkeypatch):
    """The primary no-record path: adsbdb genuinely answers 404 for an unknown hex. This is
    an answer, not an outage - available=True, and (unlike an outage) it is cache-worthy."""
    import httpx
    from app.feeds import adsbdb
    adsbdb._cache.clear()

    def handler(request):
        return httpx.Response(404)
    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        adsbdb.httpx, "AsyncClient",
        lambda *a, **kw: real_async_client(*a, transport=httpx.MockTransport(handler), **kw),
    )
    client = TestClient(create_app())
    r = client.get("/api/type/DEADBE")
    assert r.status_code == 200
    assert r.json() == {
        "type": None, "manufacturer": None, "registration": None, "available": True,
    }
    assert "DEADBE" in adsbdb._cache

def test_type_malformed_hex_rejected_without_upstream(monkeypatch):
    """A non-hex code must be rejected before any upstream call (URL hygiene), degrading to
    an honest all-None rather than interpolating junk into the adsbdb path. This is a local
    decision, not adsbdb answering or failing, but it IS a definite answer - available=True."""
    from app.feeds import adsbdb
    adsbdb._cache.clear()

    def explode(*a, **kw):
        raise AssertionError("no upstream call should be made for a malformed hex")
    monkeypatch.setattr(adsbdb.httpx, "AsyncClient", explode)

    client = TestClient(create_app())
    r = client.get("/api/type/GHIJKL")  # G/H/I/J are not hex digits
    assert r.status_code == 200
    assert r.json() == {
        "type": None, "manufacturer": None, "registration": None, "available": True,
    }


def test_type_outage_is_honest_and_not_cached(monkeypatch):
    """
    A genuine adsbdb outage must degrade to an honest unknown (200, available=False), not a
    500 and not the same shape as a real no-record - and must not be cached, so a later
    successful lookup for the same hex isn't blocked by a transient failure pinned into the
    cache for 24h.
    """
    import httpx
    from app.feeds import adsbdb
    adsbdb._cache.clear()
    real_async_client = httpx.AsyncClient

    def dead_handler(request):
        raise httpx.ConnectError("boom", request=request)
    monkeypatch.setattr(
        adsbdb.httpx, "AsyncClient",
        lambda *a, **kw: real_async_client(*a, transport=httpx.MockTransport(dead_handler), **kw),
    )
    client = TestClient(create_app())
    r = client.get("/api/type/ABCDEF")
    assert r.status_code == 200
    assert r.json() == {
        "type": None, "manufacturer": None, "registration": None, "available": False,
    }
    assert "ABCDEF" not in adsbdb._cache

    def ok_handler(request):
        return httpx.Response(200, json={"response": {"aircraft": {
            "type": "E55P", "manufacturer": "Embraer", "registration": "N435N",
        }}})
    monkeypatch.setattr(
        adsbdb.httpx, "AsyncClient",
        lambda *a, **kw: real_async_client(*a, transport=httpx.MockTransport(ok_handler), **kw),
    )
    r2 = client.get("/api/type/ABCDEF")
    assert r2.status_code == 200
    assert r2.json() == {
        "type": "E55P", "manufacturer": "Embraer", "registration": "N435N", "available": True,
    }
