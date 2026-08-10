import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store";
import type { TrafficFetchResult } from "../data/api";

const contact = (hex: string): any => ({
  hex, flight: null, t: null, lat: 30, lon: -88, alt_geom: 3500,
  alt_baro: 3400, gs: 120, track: 90, baro_rate: 0, military: false, seen_pos: 1,
});

const trafficResult = (
  contacts: any[] = [],
  source = "t",
  fetchedAt = 0,
  overrides: Partial<TrafficFetchResult> = {},
): TrafficFetchResult => ({
  contacts,
  source,
  sourceTime: fetchedAt,
  fetchedAt,
  cacheAgeSeconds: 0,
  freshness: "FRESH",
  providerAvailable: true,
  regionKey: "r1:30:-88:100",
  nextRefreshSeconds: 15,
  cacheStatus: "MISS",
  radiusNm: 80,
  mode: "NORMAL",
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-08-10T12:00:00.000Z"));
  useStore.getState().setSelectionLocked(false);
  useStore.getState().select(null);
  useStore.getState().applyFetch(trafficResult());
});

afterEach(() => vi.useRealTimers());

describe("store", () => {
  it("applyFetch replaces the contact set and goes live", () => {
    useStore.getState().applyFetch(trafficResult([contact("abc123")], "airplanes.live", 111));
    const s = useStore.getState();
    expect(s.contacts.get("abc123")).toBeTruthy();
    expect(s.feedStatus).toBe("live");
    expect(s.feedSource).toBe("airplanes.live");
  });
  it("selection survives a refresh while the contact exists, clears when it ages out", () => {
    useStore.getState().applyFetch(trafficResult([contact("abc123")], "t", 1));
    useStore.getState().select("abc123");
    useStore.getState().applyFetch(trafficResult([contact("abc123")], "t", 2));
    expect(useStore.getState().selectedHex).toBe("abc123");
    useStore.getState().applyFetch(trafficResult([], "t", 3));
    expect(useStore.getState().selectedHex).toBeNull();
  });
  it("three consecutive failures = offline, one success recovers", () => {
    const s = () => useStore.getState();
    s().markFetchFailed(); expect(s().feedStatus).toBe("stale");
    s().markFetchFailed(); s().markFetchFailed();
    expect(s().feedStatus).toBe("offline");
    s().applyFetch(trafficResult([], "t", 9));
    expect(s().feedStatus).toBe("live");
  });
  it("marks the provider unavailable and expires retained contacts after 120 seconds", () => {
    useStore.getState().applyFetch(
      trafficResult([contact("abc123")], "cache.test", 111, {
        freshness: "STALE",
        cacheAgeSeconds: 119,
      }),
    );
    useStore.getState().select("abc123");
    vi.advanceTimersByTime(2_000);
    useStore.getState().markFetchFailed();

    expect(useStore.getState()).toMatchObject({
      feedStatus: "offline",
      providerAvailable: false,
      selectedHex: null,
    });
    expect(useStore.getState().contacts.size).toBe(0);
    expect(useStore.getState().cacheAgeSeconds).toBe(121);
  });
  it("uses server freshness and cache metadata without relabeling stale data live", () => {
    useStore.getState().applyFetch(
      trafficResult([contact("abc123")], "cache.test", 111, {
        freshness: "STALE",
        providerAvailable: false,
        cacheAgeSeconds: 20,
        cacheStatus: "STALE",
        nextRefreshSeconds: 30,
      }),
    );
    expect(useStore.getState()).toMatchObject({
      feedStatus: "stale",
      feedSource: "cache.test",
      providerAvailable: false,
      cacheAgeSeconds: 20,
      nextRefreshSeconds: 30,
    });

    useStore.getState().applyFetch(
      trafficResult([], "t", 0, {
        source: null,
        sourceTime: null,
        fetchedAt: null,
        cacheAgeSeconds: null,
        freshness: "EXPIRED",
        providerAvailable: false,
        cacheStatus: "EXPIRED",
      }),
    );
    expect(useStore.getState().feedStatus).toBe("offline");
    expect(useStore.getState().contacts.size).toBe(0);
  });
});

describe("radiusNm", () => {
  it("defaults to 80", () => {
    expect(useStore.getState().radiusNm).toBe(80);
  });
  it("setRadiusNm updates it", () => {
    useStore.getState().setRadiusNm(150);
    expect(useStore.getState().radiusNm).toBe(150);
    useStore.getState().setRadiusNm(80); // reset for other tests sharing the singleton store
  });
});

describe("session state", () => {
  it("starts in BROWSE with no origin and no stats", () => {
    useStore.getState().resetSession();
    const s = useStore.getState();
    expect(s.mode).toBe("BROWSE");
    expect(s.origin).toBeNull();
    expect(s.endStats).toBeNull();
  });
  it("holds the frozen origin snapshot independently of selectedHex", () => {
    const c = contact("abc123");
    useStore.getState().setOrigin({ hex: "abc123", snapshot: c });
    // the contact ages out of the feed and the selection is nulled...
    useStore.getState().applyFetch(trafficResult([], "t", 5));
    expect(useStore.getState().selectedHex).toBeNull();
    // ...but the origin snapshot survives
    expect(useStore.getState().origin?.hex).toBe("abc123");
    expect(useStore.getState().origin?.snapshot.gs).toBe(120);
  });

  it("freezes the selected contact while an authoritative mission commit is unresolved", () => {
    useStore.getState().applyFetch(trafficResult([contact("abc123")]));
    useStore.getState().select("abc123");
    useStore.getState().setSelectionLocked(true);
    useStore.getState().select(null);
    expect(useStore.getState().selectedHex).toBe("abc123");

    useStore.getState().applyFetch(trafficResult([]));
    expect(useStore.getState().selectedHex).toBe("abc123");
    expect(useStore.getState().contacts.has("abc123")).toBe(true);

    useStore.getState().setSelectionLocked(false);
    useStore.getState().select(null);
    expect(useStore.getState().selectedHex).toBeNull();
  });
  it("fire routes every transition through the machine", () => {
    useStore.getState().resetSession();
    useStore.getState().fire("TAKE_CONTROLS");
    expect(useStore.getState().mode).toBe("COUNTDOWN");
    useStore.getState().fire("COUNTDOWN_DONE");
    expect(useStore.getState().mode).toBe("FLYING");
    useStore.getState().fire("IMPACT");
    expect(useStore.getState().mode).toBe("ENDED");
    useStore.getState().fire("EXIT_END");
    expect(useStore.getState().mode).toBe("BROWSE");
  });
  it("an illegal event is a no-op, not a bogus mode (late impacts race QUIT)", () => {
    useStore.getState().resetSession();
    useStore.getState().fire("IMPACT");
    expect(useStore.getState().mode).toBe("BROWSE");
    useStore.getState().fire("TAKE_CONTROLS");
    useStore.getState().fire("COUNTDOWN_DONE");
    useStore.getState().fire("QUIT");
    useStore.getState().fire("IMPACT"); // arrives one frame too late
    expect(useStore.getState().mode).toBe("BROWSE");
  });
  it("resetSession clears mode, origin and stats together (QUIT leaves no residue)", () => {
    useStore.getState().fire("TAKE_CONTROLS");
    useStore.getState().fire("COUNTDOWN_DONE");
    useStore.getState().setOrigin({ hex: "abc123", snapshot: contact("abc123") });
    useStore.getState().setEndStats({
      airtimeS: 1, distanceM: 2, maxIasMs: 3, maxAltitudeM: 4, maxG: 5,
      impactSinkFpm: 6, impactIasMs: 7, classification: "CRASHED",
    });
    useStore.getState().resetSession();
    const s = useStore.getState();
    expect(s.mode).toBe("BROWSE");
    expect(s.origin).toBeNull();
    expect(s.endStats).toBeNull();
  });
  it("does not hold any sim state (60 Hz set() would re-render React)", () => {
    const keys = Object.keys(useStore.getState());
    expect(keys).not.toContain("simState");
    expect(keys).not.toContain("position");
    expect(keys).not.toContain("attitude");
  });
});

describe("view preferences", () => {
  it("starts on the satellite basemap with the labels layer OFF", () => {
    const s = useStore.getState();
    expect(s.basemap).toBe("SAT");
    expect(s.labelsOn).toBe(false);
  });
  it("switches the basemap", () => {
    useStore.getState().setBasemap("CHART");
    expect(useStore.getState().basemap).toBe("CHART");
    useStore.getState().setBasemap("SAT");
  });
  it("turns the labels layer on and off", () => {
    useStore.getState().setLabelsOn(true);
    expect(useStore.getState().labelsOn).toBe(true);
    useStore.getState().setLabelsOn(false);
  });
  it("leaves them alone when the session resets — they are preferences, not session state", () => {
    useStore.getState().setBasemap("CHART");
    useStore.getState().setLabelsOn(true);
    useStore.getState().resetSession();
    expect(useStore.getState().basemap).toBe("CHART");
    expect(useStore.getState().labelsOn).toBe(true);
    useStore.getState().setBasemap("SAT");
    useStore.getState().setLabelsOn(false);
  });
});
