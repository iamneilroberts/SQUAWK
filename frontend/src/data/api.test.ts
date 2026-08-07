import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchTypeInfo, FeedDownError } from "./api";

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
