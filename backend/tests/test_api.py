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
