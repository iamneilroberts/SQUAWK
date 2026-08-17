import json
from pathlib import Path
from app.feeds import ais

FIX = Path(__file__).parent / "fixtures" / "ais"
def _load(n): return json.loads((FIX / n).read_text())

def test_apply_merges_by_mmsi_and_snapshot_returns_area():
    s = ais.AisStore(ttl_s=600, offline_after_s=30)
    s.apply(_load("position_report.json"), now=1000)
    s.apply(_load("ship_static_data.json"), now=1001)
    ships = s.snapshot(lat=30.7, lon=-88.0, radius_nm=80, now=1002)
    assert len(ships) == 1
    assert ships[0]["mmsi"] == "366999999" and ships[0]["name"] == "EVER GIVEN"

def test_ttl_expiry_excludes_old_reports():
    s = ais.AisStore(ttl_s=600, offline_after_s=30)
    s.apply(_load("position_report.json"), now=1000)
    assert len(s.snapshot(30.7, -88.0, 80, now=1500)) == 1   # within TTL
    assert s.snapshot(30.7, -88.0, 80, now=1700) == []        # 700s > 600 TTL

def test_area_filter_excludes_far_ships():
    s = ais.AisStore(ttl_s=600, offline_after_s=30)
    s.apply(_load("position_report.json"), now=1000)          # off Mobile
    assert s.snapshot(lat=0.0, lon=0.0, radius_nm=80, now=1001) == []

def test_status_offline_when_never_connected():
    s = ais.AisStore(ttl_s=600, offline_after_s=30)
    assert s.status(now=1000, connected=False) == "offline"

def test_status_live_when_connected_and_recent_message():
    s = ais.AisStore(ttl_s=600, offline_after_s=30)
    s.mark_message(now=1000)
    assert s.status(now=1005, connected=True) == "live"

def test_status_stale_then_offline_as_silence_grows():
    s = ais.AisStore(ttl_s=600, offline_after_s=30)
    s.mark_message(now=1000)
    assert s.status(now=1010, connected=False) == "stale"     # <30s silence, reconnecting
    assert s.status(now=1040, connected=False) == "offline"   # >30s → offline

def test_status_live_when_connected_even_if_vessels_quiet():
    # Socket is up but no vessels have transmitted in the bbox for longer than
    # offline_after_s. connected=True means the feed itself is healthy — the
    # websockets ping keepalive would have already killed a dead socket — so
    # this must read "live", not "offline". Zero ships is honestly reported by
    # snapshot(), not by status().
    s = ais.AisStore(ttl_s=600, offline_after_s=30)
    s.mark_message(now=1000)
    assert s.status(now=1100, connected=True) == "live"

def test_status_nodata_when_connected_but_silence_exceeds_no_data_after_s():
    # aisstream's WS keepalive holds the socket open through an upstream data
    # outage — connected stays True with zero messages flowing. Past the
    # no_data_after_s threshold (180s default) this must read "nodata", not
    # confidently "live": honest degraded state, distinct from live and offline.
    s = ais.AisStore(ttl_s=600, offline_after_s=30)
    s.mark_message(now=1000)
    assert s.status(now=1200, connected=True) == "nodata"  # 200s silence > 180s default

def test_status_nodata_when_connected_and_never_received_a_message():
    # Socket up and subscribed, but not a single message has ever arrived —
    # also honest for a genuinely quiet bounding box, not just an outage.
    s = ais.AisStore(ttl_s=600, offline_after_s=30)
    assert s.status(now=1000, connected=True) == "nodata"
