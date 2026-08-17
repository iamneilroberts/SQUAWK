import dataclasses
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.feeds import ais

FIX = Path(__file__).parent / "fixtures" / "ais"
def _load(n): return json.loads((FIX / n).read_text())

def test_subscribe_message_shape():
    from app.config import load_settings
    s = load_settings()
    s = dataclasses.replace(s, ais_api_key="KEY123")  # Settings is a frozen dataclass
    msg = ais.subscribe_message(s, lat=30.7, lon=-88.0, radius_nm=80)
    assert msg["APIKey"] == "KEY123"
    assert "BoundingBoxes" in msg and len(msg["BoundingBoxes"]) == 1
    assert "PositionReport" in msg["FilterMessageTypes"]

def test_endpoint_offline_when_no_messages():
    app = create_app()
    client = TestClient(app)
    r = client.get("/api/ais", params={"lat": 30.7, "lon": -88.0, "radius_nm": 80})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "offline"
    assert body["contacts"] == []          # never fabricates ships
    assert body["source"] == "aisstream.io"

def test_endpoint_returns_ships_after_store_filled():
    app = create_app()
    feed = app.state.ais_feed
    feed.connected = True
    feed.store.apply(_load("position_report.json"))
    feed.store.apply(_load("ship_static_data.json"))
    client = TestClient(app)
    r = client.get("/api/ais", params={"lat": 30.7, "lon": -88.0, "radius_nm": 80})
    body = r.json()
    assert body["status"] == "live"
    assert len(body["contacts"]) == 1 and body["contacts"][0]["name"] == "EVER GIVEN"

@pytest.mark.asyncio
async def test_run_ws_client_feeds_store_from_fake_socket():
    from app.config import load_settings
    import asyncio
    s = load_settings()
    s = dataclasses.replace(s, ais_api_key="KEY")  # Settings is a frozen dataclass
    feed = ais.AisFeed(ais.AisStore(s.ais_ttl_s, s.ais_offline_after_s))
    msgs = [json.dumps(_load("position_report.json")),
            json.dumps(_load("ship_static_data.json"))]

    class FakeWS:
        def __init__(self): self.sent = []
        async def send(self, data): self.sent.append(data)
        def __aiter__(self):
            async def gen():
                for m in msgs: yield m
            return gen()

    async def fake_connect(url): return FakeWS()
    stop = asyncio.Event()
    await ais.run_ws_client(s, feed, connect=fake_connect, stop_event=stop, once=True)
    assert feed.store.count() == 1
    assert feed.connected is True

@pytest.mark.asyncio
async def test_run_ws_client_sets_connected_false_when_socket_closes():
    # Real disconnect path (not the `once` test shortcut): the fake socket
    # yields one message, then its async-iteration ends on its own (as a real
    # closed socket / keepalive-killed connection would). The non-`once` loop
    # must observe that as feed.connected = False before it would reconnect.
    from app.config import load_settings
    import asyncio
    s = load_settings()
    s = dataclasses.replace(s, ais_api_key="KEY")
    feed = ais.AisFeed(ais.AisStore(s.ais_ttl_s, s.ais_offline_after_s))
    msg = json.dumps(_load("position_report.json"))
    stop = asyncio.Event()
    connect_calls = 0

    class FakeWS:
        def __init__(self): self.sent = []
        async def send(self, data): self.sent.append(data)
        def __aiter__(self):
            async def gen():
                yield msg
                # Socket closes here: the async-for ends on its own, the way
                # a real dropped connection (or the websockets keepalive
                # killing a dead one) would. We set stop_event now — after
                # the drain — so the test observes exactly one disconnect
                # cycle instead of an unbounded reconnect loop.
                stop.set()
            return gen()

    async def fake_connect(url):
        nonlocal connect_calls
        connect_calls += 1
        return FakeWS()

    await ais.run_ws_client(s, feed, connect=fake_connect, stop_event=stop, once=False)

    assert feed.store.count() == 1          # the one message was still applied
    assert feed.connected is False           # disconnect path flips connected
    assert connect_calls == 1                # loop exited on stop_event, no reconnect attempted
