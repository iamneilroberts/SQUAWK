from fastapi.testclient import TestClient
from app.main import create_app

def test_healthz():
    client = TestClient(create_app())
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True}

def test_config_serves_home(monkeypatch):
    monkeypatch.setenv("HOME_LAT", "30.6944")
    monkeypatch.setenv("HOME_LON", "-88.0399")
    client = TestClient(create_app())
    home = client.get("/api/config").json()["home"]
    assert home == {"lat": 30.6944, "lon": -88.0399}
