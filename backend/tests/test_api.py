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
        return None
    monkeypatch.setattr(adsbdb, "lookup", miss)
    client = TestClient(create_app())
    r = client.get("/api/type/000000")
    assert r.status_code == 200
    assert r.json() == {"type": None, "manufacturer": None, "registration": None}
