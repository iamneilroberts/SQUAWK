import json
import pathlib

from app.feeds.adsb import normalize

FIX = pathlib.Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIX / name).read_text())


def test_ac_envelope_and_fields():
    out = normalize(load("raw-airplanes-live.json"))  # {"ac": [...]}
    assert out, "fixture should yield contacts"
    c = out[0]
    for key in (
        "hex", "flight", "t", "lat", "lon", "alt_geom",
        "alt_baro", "gs", "track", "baro_rate", "military", "seen_pos",
    ):
        assert key in c


def test_aircraft_envelope():
    assert normalize(load("raw-adsb-fi.json"))  # {"aircraft": [...]}


def test_ground_string_preserved():
    out = normalize({"ac": [{"hex": "a1b2c3", "lat": 30.0, "lon": -88.0,
                             "alt_baro": "ground"}]})
    assert out[0]["alt_baro"] == "ground"


def test_military_flag():
    out = normalize({"ac": [{"hex": "ae1234", "lat": 30.0, "lon": -88.0,
                             "dbFlags": 9}]})
    assert out[0]["military"] is True


def test_positionless_dropped():
    assert normalize({"ac": [{"hex": "a1b2c3"}]}) == []


def test_non_dict_rows_skipped():
    # A junk non-dict element must not abort the whole batch (which would fail the feed over
    # and discard its real contacts); it is skipped and the real row survives.
    out = normalize({"ac": ["garbage", 42, {"hex": "a1b2c3", "lat": 30.0, "lon": -88.0}]})
    assert len(out) == 1 and out[0]["hex"] == "a1b2c3"
