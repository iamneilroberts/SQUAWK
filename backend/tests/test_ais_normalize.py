import json
from pathlib import Path
from app.feeds import ais

FIX = Path(__file__).parent / "fixtures" / "ais"

def _load(name):
    return json.loads((FIX / name).read_text())

def test_position_report_updates_dynamic_fields():
    r = ais.ShipReport(mmsi="366999999")
    r.apply_message(_load("position_report.json"))
    assert r.lat == 30.71 and r.lon == -88.04
    assert r.cog == 271.4 and r.sog == 12.3 and r.heading == 270
    assert r.nav_status_code == 0

def test_static_data_updates_static_fields():
    r = ais.ShipReport(mmsi="366999999")
    r.apply_message(_load("ship_static_data.json"))
    assert r.name == "EVER GIVEN" and r.type_code == 70
    assert (r.dim_a, r.dim_b, r.dim_c, r.dim_d) == (200, 200, 30, 29)
    assert r.destination == "MOBILE AL" and r.draught == 14.5 and r.callsign == "H3RC"

def test_normalize_merges_and_decodes():
    r = ais.ShipReport(mmsi="366999999")
    r.apply_message(_load("position_report.json"))
    r.apply_message(_load("ship_static_data.json"))
    c = ais.normalize(r)
    assert c["mmsi"] == "366999999"
    assert c["name"] == "EVER GIVEN"
    assert c["ship_type"] == "Cargo"          # code 70 → Cargo band
    assert c["nav_status"] == "Under way using engine"  # code 0
    assert c["length_m"] == 400 and c["beam_m"] == 59   # A+B, C+D
    assert c["cog"] == 271.4 and c["sog"] == 12.3 and c["heading"] == 270
    assert c["draught_m"] == 14.5 and c["destination"] == "MOBILE AL"

def test_normalize_unknown_fields_are_none():
    r = ais.ShipReport(mmsi="111")
    r.apply_message(_load("position_report.json"))   # no static yet
    c = ais.normalize(r)
    assert c["name"] is None and c["ship_type"] is None
    assert c["length_m"] is None and c["beam_m"] is None
    assert c["destination"] is None and c["draught_m"] is None
