import pytest
import httpx

from app.config import Settings
from app.feeds import adsb


def _settings(interval: float) -> Settings:
    return Settings(
        home_lat=30.6944, home_lon=-88.0399,
        feed_primary="https://primary.example/v2/point/{lat}/{lon}/{radius}",
        feed_fallback="https://fallback.example/v2/lat/{lat}/lon/{lon}/dist/{radius}",
        feed_reserve="https://reserve.example/api/v2/lat/{lat}/lon/{lon}/dist/{radius}",
        adsbdb_base="https://adsbdb.example/v0",
        feed_min_interval_s=interval,
        host="127.0.0.1", port=8010,
    )


@pytest.fixture(autouse=True)
def reset_module_state(monkeypatch):
    """Module-level rate-gate/cache state must not leak between tests."""
    monkeypatch.setattr(adsb, "_last_upstream", 0.0)
    monkeypatch.setattr(adsb, "_cache", {})


@pytest.mark.asyncio
async def test_failed_upstream_calls_still_advance_the_gate(monkeypatch):
    """
    A failing feed must still count against feed_min_interval_s. Before the fix,
    _last_upstream was only set after a successful raise_for_status()/json(), so an all-feeds-
    down outage never advanced the timestamp and every subsequent poll fired three
    unthrottled requests at the exact moment upstreams were struggling.
    """
    def handler(request):
        return httpx.Response(500)

    real_async_client = httpx.AsyncClient  # capture before patching to avoid self-reference
    monkeypatch.setattr(
        adsb.httpx, "AsyncClient",
        lambda *a, **kw: real_async_client(*a, transport=httpx.MockTransport(handler), **kw),
    )

    assert adsb._last_upstream == 0.0
    with pytest.raises(adsb.FeedUnavailable):
        await adsb.fetch_adsb(_settings(interval=0.05), 30.0, -88.0, 100)

    # All three attempts failed, but each one must have advanced the gate.
    assert adsb._last_upstream > 0.0
