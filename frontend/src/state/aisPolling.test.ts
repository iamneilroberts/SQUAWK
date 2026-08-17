import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useStore, startAisPolling, startTrafficPolling } from "./store";
import { fetchAis, fetchConfig, fetchTraffic } from "../data/api";
import type { ShipContact } from "../data/types";

// Partial mock: keep FeedDownError (the aircraft poller's catch does `instanceof FeedDownError`)
// and the other real exports; override only the network calls the tests drive.
vi.mock("../data/api", async () => {
  const actual = await vi.importActual<typeof import("../data/api")>("../data/api");
  return {
    ...actual,
    fetchConfig: vi.fn(),
    fetchAis: vi.fn(),
    fetchTraffic: vi.fn(),
  };
});

const mockedFetchConfig = vi.mocked(fetchConfig);
const mockedFetchAis = vi.mocked(fetchAis);
const mockedFetchTraffic = vi.mocked(fetchTraffic);

const ship = (mmsi: string): ShipContact => ({
  mmsi,
  name: "X",
  ship_type: null,
  lat: 30.7,
  lon: -88,
  cog: null,
  sog: null,
  heading: null,
  nav_status: null,
  length_m: null,
  beam_m: null,
  draught_m: null,
  destination: null,
  callsign: null,
  seen: 0,
});

beforeEach(() => {
  vi.useFakeTimers();
  mockedFetchConfig.mockReset();
  mockedFetchAis.mockReset();
  mockedFetchTraffic.mockReset();
  useStore.setState({
    home: null,
    ships: new Map(),
    shipFeedStatus: "offline",
    shipSource: null,
    selectedMmsi: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startAisPolling", () => {
  it("fills ships and goes live on success", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 30.7, lon: -88 } });
    mockedFetchAis.mockResolvedValue({
      contacts: [ship("111")],
      source: "aisstream.io",
      fetched_at: 1,
      status: "live",
    });

    const stop = startAisPolling(1000);
    await vi.advanceTimersByTimeAsync(0); // config resolves
    await vi.advanceTimersByTimeAsync(1000); // ais fetch resolves

    expect(useStore.getState().ships.get("111")?.name).toBe("X");
    expect(useStore.getState().shipFeedStatus).toBe("live");
    expect(useStore.getState().shipSource).toBe("aisstream.io");

    stop();
  });

  it("drives shipFeedStatus stale then offline after 3 consecutive failures", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 30.7, lon: -88 } });
    mockedFetchAis.mockRejectedValue(new Error("down"));

    const stop = startAisPolling(1000);
    await vi.advanceTimersByTimeAsync(0); // config resolves
    await vi.advanceTimersByTimeAsync(1000); // ais attempt 1 fails
    expect(useStore.getState().shipFeedStatus).toBe("stale");

    await vi.advanceTimersByTimeAsync(1000); // attempt 2 fails
    expect(useStore.getState().shipFeedStatus).toBe("stale");

    await vi.advanceTimersByTimeAsync(1000); // attempt 3 fails -> threshold
    expect(useStore.getState().shipFeedStatus).toBe("offline");

    stop();
  });

  it("recovers to live after failures once a fetch succeeds again", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 30.7, lon: -88 } });
    mockedFetchAis
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue({
        contacts: [ship("222")],
        source: "recovered-src",
        fetched_at: 2,
        status: "live",
      });

    const stop = startAisPolling(1000);
    await vi.advanceTimersByTimeAsync(0); // config resolves
    await vi.advanceTimersByTimeAsync(1000); // attempt 1 fails
    await vi.advanceTimersByTimeAsync(1000); // attempt 2 fails
    await vi.advanceTimersByTimeAsync(1000); // attempt 3 fails -> offline
    expect(useStore.getState().shipFeedStatus).toBe("offline");

    await vi.advanceTimersByTimeAsync(1000); // attempt 4 succeeds -> live

    const s = useStore.getState();
    expect(s.shipFeedStatus).toBe("live");
    expect(s.shipSource).toBe("recovered-src");
    expect(s.ships.has("222")).toBe(true);

    stop();
  });

  it("retries config fetch instead of dying when it first rejects (broken-arm)", async () => {
    mockedFetchConfig
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue({ home: { lat: 30.7, lon: -88 } });
    mockedFetchAis.mockResolvedValue({
      contacts: [ship("111")],
      source: "aisstream.io",
      fetched_at: 1,
      status: "live",
    });

    const stop = startAisPolling(1000);
    await vi.advanceTimersByTimeAsync(0); // config rejects immediately -> no crash, no interval starved
    await vi.advanceTimersByTimeAsync(1000); // config retried and resolves
    await vi.advanceTimersByTimeAsync(1000); // ais fetch fires and resolves

    expect(useStore.getState().ships.size).toBe(1);
    expect(useStore.getState().shipFeedStatus).toBe("live");

    stop();
  });
});

// Camera re-fire watch item (task 6): the browse camera fly-to effect is keyed on [home].
// The aircraft tick (startTrafficPolling) and startAisPolling now run concurrently from the
// same mount effect. Each fetchConfig() call parses a *new* response object (see api.ts
// fetchConfig using res.json()), so if both pollers wrote the shared `home`, `home` would
// change identity twice at startup — firing the camera effect twice. startAisPolling must
// NOT write the shared `home`; only startTrafficPolling (the aircraft tick) may.
describe("camera re-fire guard: shared `home` has exactly one writer", () => {
  const trafficResult = {
    contacts: [],
    source: "t",
    sourceTime: 0,
    fetchedAt: 0,
    cacheAgeSeconds: 0,
    freshness: "FRESH" as const,
    providerAvailable: true,
    regionKey: "r",
    nextRefreshSeconds: 30,
    cacheStatus: "MISS" as const,
    radiusNm: 80,
    mode: "NORMAL" as const,
  };

  it("startAisPolling never calls the store's setHome, even though it reads /api/config", async () => {
    const setHomeSpy = vi.spyOn(useStore.getState(), "setHome");
    mockedFetchConfig.mockResolvedValue({ home: { lat: 30.7, lon: -88 } });
    mockedFetchAis.mockResolvedValue({
      contacts: [ship("111")],
      source: "aisstream.io",
      fetched_at: 1,
      status: "live",
    });

    const stop = startAisPolling(1000);
    await vi.advanceTimersByTimeAsync(0); // config resolves
    await vi.advanceTimersByTimeAsync(1000); // ais fetch resolves

    expect(setHomeSpy).not.toHaveBeenCalled();
    stop();
  });

  it("home changes identity only once when both pollers start together (aircraft tick is the sole writer)", async () => {
    // Two independent fetchConfig() calls (one per poller) each resolve to their own
    // freshly-parsed object — same lat/lon values, different references — exactly what
    // res.json() would produce for two separate /api/config requests.
    mockedFetchConfig.mockImplementation(() =>
      Promise.resolve({ home: { lat: 30.7, lon: -88 } }),
    );
    mockedFetchTraffic.mockResolvedValue(trafficResult);
    mockedFetchAis.mockResolvedValue({
      contacts: [],
      source: "aisstream.io",
      fetched_at: 0,
      status: "live",
    });

    const seenHomes: unknown[] = [];
    const unsubscribe = useStore.subscribe((s) => {
      seenHomes.push(s.home);
    });

    const stopA = startTrafficPolling({ intervalMs: 1000 });
    const stopB = startAisPolling(1000);
    await vi.advanceTimersByTimeAsync(0); // both configs resolve

    // Dedupe by reference — count how many distinct `home` object identities were
    // actually stored (this is what the browse `useEffect(..., [home])` keys on).
    const distinctHomeIdentities = new Set(seenHomes.filter((h) => h !== null));
    expect(distinctHomeIdentities.size).toBe(1);

    unsubscribe();
    stopA();
    stopB();
  });
});
