from app.feeds.adsb import build_url


def test_primary_template_is_point_shape():
    url = build_url("https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}",
                     30.6944, -88.0399, 250)
    assert url == "https://api.airplanes.live/v2/point/30.6944/-88.0399/250"


def test_fallback_template_is_lat_lon_dist_shape():
    url = build_url("https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius}",
                     30.6944, -88.0399, 250)
    assert url == "https://api.adsb.lol/v2/lat/30.6944/lon/-88.0399/dist/250"
