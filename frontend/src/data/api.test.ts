import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchActiveMissionTraffic,
  fetchTraffic,
  fetchTypeInfo,
  FeedDownError,
} from "./api";

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchTypeInfo", () => {
  it("asks the backend proxy for the hex, never adsbdb directly", async () => {
    const fetchMock = okJson({
      type: "172", manufacturer: "Cessna", registration: "N12345", available: true,
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchTypeInfo("a1b2c3");
    expect(fetchMock).toHaveBeenCalledWith("/api/type/a1b2c3");
  });

  it("returns the four enrichment fields", async () => {
    vi.stubGlobal("fetch", okJson({
      type: "172", manufacturer: "Cessna", registration: "N12345", available: true,
    }));
    expect(await fetchTypeInfo("a1b2c3")).toEqual({
      type: "172", manufacturer: "Cessna", registration: "N12345", available: true,
    });
  });

  it("passes an all-null, available:true answer through rather than treating it as an error", async () => {
    // adsbdb genuinely not knowing this hex is a different state from adsbdb being down, and
    // the card renders them differently. The client must not flatten them together.
    vi.stubGlobal("fetch", okJson({
      type: null, manufacturer: null, registration: null, available: true,
    }));
    expect(await fetchTypeInfo("000000")).toEqual({
      type: null, manufacturer: null, registration: null, available: true,
    });
  });

  it("passes available:false through when the backend reached us but adsbdb itself did not answer", async () => {
    // This is the outage case: our proxy is up (200) but says explicitly that adsbdb wasn't.
    // Must not be conflated with the all-null/available:true "no record" case above.
    vi.stubGlobal("fetch", okJson({
      type: null, manufacturer: null, registration: null, available: false,
    }));
    expect(await fetchTypeInfo("a1b2c3")).toEqual({
      type: null, manufacturer: null, registration: null, available: false,
    });
  });

  it("throws FeedDownError when the proxy answers badly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    await expect(fetchTypeInfo("a1b2c3")).rejects.toBeInstanceOf(FeedDownError);
  });
});

describe("fetchTraffic", () => {
  it("uses only the Worker traffic route and unwraps its typed envelope", async () => {
    const fetchMock = okJson({
      ok: true,
      code: "OK",
      requestId: "00000000-0000-4000-8000-000000000001",
      serverTime: "2026-08-10T12:00:00.000Z",
      mode: "READ_ONLY",
      data: {
        contacts: [],
        source: "fixture.test",
        sourceTime: 1,
        fetchedAt: 2,
        cacheAgeSeconds: 3,
        freshness: "STALE",
        providerAvailable: false,
        regionKey: "r1:30:-88:100",
        nextRefreshSeconds: 30,
        cacheStatus: "STALE",
        radiusNm: 80,
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTraffic(30, -88, 80)).resolves.toMatchObject({
      mode: "READ_ONLY",
      freshness: "STALE",
      nextRefreshSeconds: 30,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/traffic?lat=30&lon=-88&radius_nm=80");
  });

  it("preserves stable error code and retry guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            code: "RATE_LIMITED",
            error: { message: "retry later", retryAfterSeconds: 30 },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const error = await fetchTraffic(30, -88, 80).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "FeedDownError",
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 30,
    });
  });

  it("preserves kill-switch mode on a failed dynamic response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      code: "KILL_SWITCH_ACTIVE",
      mode: "KILL_SWITCH",
      error: { message: "maintenance" },
    }), { status: 503, headers: { "content-type": "application/json" } })));
    const error = await fetchTraffic(30, -88, 80).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 503, code: "KILL_SWITCH_ACTIVE", mode: "KILL_SWITCH" });
  });
});

describe("fetchActiveMissionTraffic", () => {
  it("uses the lease-renewing authenticated mission route", async () => {
    const fetchMock = okJson({
      ok: true,
      code: "MISSION_TRAFFIC_UPDATED",
      mode: "NORMAL",
      data: {
        contacts: [],
        source: "fixture.test",
        sourceTime: 1,
        fetchedAt: 2,
        cacheAgeSeconds: 0,
        freshness: "FRESH",
        providerAvailable: true,
        regionKey: "r1:31:-87:100",
        nextRefreshSeconds: 12,
        cacheStatus: "HIT",
        radiusNm: 80,
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchActiveMissionTraffic(
      "00000000-0000-4000-8000-000000000001",
      31,
      -87,
      80,
    )).resolves.toMatchObject({ mode: "NORMAL", nextRefreshSeconds: 12 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/missions/00000000-0000-4000-8000-000000000001/traffic?lat=31&lon=-87&radius_nm=80",
      { credentials: "same-origin" },
    );
  });
});
