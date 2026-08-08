import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchMetar, FeedDownError } from "./api";

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

const METAR = {
  icao: "KMOB",
  available: true,
  metar: { windSpeedKt: 12, altimInHg: 30.12 },
  attribution: "NOAA Aviation Weather Center · aviationweather.gov",
};

describe("fetchMetar", () => {
  it("asks the backend proxy for the ICAO, never aviationweather.gov directly", async () => {
    const fetchMock = okJson(METAR);
    vi.stubGlobal("fetch", fetchMock);
    await fetchMetar("KMOB");
    expect(fetchMock).toHaveBeenCalledWith("/api/metar/KMOB");
  });

  it("returns the proxy's shape unchanged", async () => {
    vi.stubGlobal("fetch", okJson(METAR));
    expect(await fetchMetar("KMOB")).toEqual(METAR);
  });

  it("passes an available:false answer through rather than treating it as an error", async () => {
    // Upstream outage reported honestly by our up proxy — distinct from our proxy being down.
    // The client must not flatten it into a throw, or the panel can't tell NO FEED from no report.
    const down = { icao: "KMOB", available: false, metar: null, attribution: "NOAA" };
    vi.stubGlobal("fetch", okJson(down));
    expect(await fetchMetar("KMOB")).toEqual(down);
  });

  it("throws FeedDownError when our proxy itself answers badly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    await expect(fetchMetar("KMOB")).rejects.toBeInstanceOf(FeedDownError);
  });
});
