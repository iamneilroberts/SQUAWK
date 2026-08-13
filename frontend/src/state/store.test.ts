import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store";
import type { TrafficFetchResult } from "../data/api";
import type { LockedMissionView } from "../mission/contract";

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

const lockedMission = (assist: LockedMissionView["assist"] = "medium") => ({
  schemaVersion: 1,
  missionId: "00000000-0000-4000-8000-000000000001",
  status: "locked",
  contact: contact("abc123"),
  assist,
} as LockedMissionView);

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
  it("fails closed immediately when the Worker reports kill-switch maintenance", () => {
    useStore.getState().applyFetch(trafficResult([contact("abc123")]));
    useStore.getState().select("abc123");
    useStore.getState().markFetchFailed("KILL_SWITCH");
    expect(useStore.getState()).toMatchObject({
      systemMode: "KILL_SWITCH",
      feedStatus: "offline",
      providerAvailable: false,
      selectedHex: null,
    });
    expect(useStore.getState().contacts.size).toBe(0);
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
    expect(s.lockedMission).toBeNull();
    expect(s.assist).toBeNull();
    expect(s.endStats).toBeNull();
  });
  it("starts countdown only from a committed mission and freezes that authority", () => {
    useStore.getState().resetSession();
    const mission = lockedMission();
    expect(useStore.getState().startLockedMission(mission)).toBe(true);
    expect(useStore.getState()).toMatchObject({
      mode: "COUNTDOWN",
      lockedMission: mission,
      origin: { hex: "abc123" },
      assist: { current: "FULL", highestUsed: "FULL" },
    });
    expect(useStore.getState().startLockedMission(mission)).toBe(false);
  });
  it("startFreeFlight only starts from BROWSE, sets the freeFlight flag and clears contacts (#29)", () => {
    useStore.getState().resetSession();
    useStore.getState().applyFetch(trafficResult([contact("abc123")]));
    const mission = lockedMission("none");
    expect(useStore.getState().startFreeFlight(mission)).toBe(true);
    const s = useStore.getState();
    expect(s.mode).toBe("COUNTDOWN");
    expect(s.freeFlight).toBe(true);
    expect(s.tutorial).toBeNull();
    expect(s.lockedMission).toBe(mission);
    expect(s.contacts.size).toBe(0);
    expect(s.selectedHex).toBeNull();
    // A second start is refused: we are no longer in BROWSE.
    expect(useStore.getState().startFreeFlight(mission)).toBe(false);
  });
  it("resetSession and a live mission both clear the freeFlight flag (#29)", () => {
    useStore.getState().resetSession();
    useStore.getState().startFreeFlight(lockedMission("none"));
    expect(useStore.getState().freeFlight).toBe(true);
    useStore.getState().resetSession();
    expect(useStore.getState().freeFlight).toBe(false);
    useStore.getState().startLockedMission(lockedMission());
    expect(useStore.getState().freeFlight).toBe(false);
  });
  it("startInstantFlight starts from BROWSE, sets instantFlight (not freeFlight) and KEEPS contacts (#84)", () => {
    useStore.getState().resetSession();
    useStore.getState().applyFetch(trafficResult([contact("abc123")]));
    const mission = lockedMission("none");
    expect(useStore.getState().startInstantFlight(mission)).toBe(true);
    const s = useStore.getState();
    expect(s.mode).toBe("COUNTDOWN");
    expect(s.instantFlight).toBe(true);
    // Instant is its own mode: NOT freeFlight (its debrief is scored + trimmed, not "unavailable").
    expect(s.freeFlight).toBe(false);
    expect(s.tutorial).toBeNull();
    expect(s.lockedMission).toBe(mission);
    // Instant flight spawns from a REAL live contact, so live traffic keeps rendering as scenery
    // (design spec §FLYING). Unlike free flight it must NOT wipe the browse contacts — the poller
    // keeps them fresh from here.
    expect(s.contacts.has("abc123")).toBe(true);
    expect(s.selectedHex).toBeNull();
    // A second start is refused: no longer in BROWSE.
    expect(useStore.getState().startInstantFlight(mission)).toBe(false);
  });
  it("resetSession and other start actions clear the instantFlight flag (B3)", () => {
    useStore.getState().resetSession();
    useStore.getState().startInstantFlight(lockedMission("none"));
    expect(useStore.getState().instantFlight).toBe(true);
    useStore.getState().resetSession();
    expect(useStore.getState().instantFlight).toBe(false);
    useStore.getState().startFreeFlight(lockedMission("none"));
    expect(useStore.getState().instantFlight).toBe(false);
    useStore.getState().resetSession();
    useStore.getState().startLockedMission(lockedMission());
    expect(useStore.getState().instantFlight).toBe(false);
  });
  it("tracks highest assist monotonically for the locked flight", () => {
    useStore.getState().resetSession();
    useStore.getState().startLockedMission(lockedMission("none"));
    useStore.getState().setAssistMode("NAV");
    useStore.getState().setAssistMode("FULL");
    useStore.getState().setAssistMode("OFF");
    expect(useStore.getState().assist).toEqual({ current: "OFF", highestUsed: "FULL" });
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
    expect(s.lockedMission).toBeNull();
    expect(s.assist).toBeNull();
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
  it("starts with other-aircraft visibility ON (#85)", () => {
    expect(useStore.getState().showOtherAircraft).toBe(true);
  });
  it("toggles other-aircraft visibility", () => {
    useStore.getState().setShowOtherAircraft(false);
    expect(useStore.getState().showOtherAircraft).toBe(false);
    useStore.getState().setShowOtherAircraft(true);
  });
  it("leaves showOtherAircraft alone when the session resets — it is a preference, not session state", () => {
    useStore.getState().setShowOtherAircraft(false);
    useStore.getState().resetSession();
    expect(useStore.getState().showOtherAircraft).toBe(false);
    useStore.getState().setShowOtherAircraft(true);
  });
  it("starts decluttered off", () => {
    expect(useStore.getState().decluttered).toBe(false);
  });
  it("toggles the declutter flag", () => {
    useStore.getState().setDeclutter(true);
    expect(useStore.getState().decluttered).toBe(true);
    useStore.getState().setDeclutter(false);
    expect(useStore.getState().decluttered).toBe(false);
  });
});

describe("identifiedHex — in-flight tap-to-identify (#86)", () => {
  const toFlying = () => {
    useStore.getState().resetSession();
    useStore.getState().fire("TAKE_CONTROLS");
    useStore.getState().fire("COUNTDOWN_DONE");
  };
  it("defaults to null", () => {
    useStore.getState().resetSession();
    expect(useStore.getState().identifiedHex).toBeNull();
  });
  it("setter sets and clears", () => {
    useStore.getState().setIdentifiedHex("abc123");
    expect(useStore.getState().identifiedHex).toBe("abc123");
    useStore.getState().setIdentifiedHex(null);
    expect(useStore.getState().identifiedHex).toBeNull();
  });
  it("survives while FLYING and PAUSED", () => {
    toFlying();
    useStore.getState().setIdentifiedHex("abc123");
    useStore.getState().fire("PAUSE");
    expect(useStore.getState().mode).toBe("PAUSED");
    expect(useStore.getState().identifiedHex).toBe("abc123");
    useStore.getState().fire("RESUME");
    expect(useStore.getState().mode).toBe("FLYING");
    expect(useStore.getState().identifiedHex).toBe("abc123");
  });
  it("clears when the flight ends (IMPACT -> ENDED)", () => {
    toFlying();
    useStore.getState().setIdentifiedHex("abc123");
    useStore.getState().fire("IMPACT");
    expect(useStore.getState().mode).toBe("ENDED");
    expect(useStore.getState().identifiedHex).toBeNull();
  });
  it("clears when leaving flight to BROWSE (QUIT)", () => {
    toFlying();
    useStore.getState().setIdentifiedHex("abc123");
    useStore.getState().fire("QUIT");
    expect(useStore.getState().mode).toBe("BROWSE");
    expect(useStore.getState().identifiedHex).toBeNull();
  });
  it("resetSession clears it", () => {
    useStore.getState().setIdentifiedHex("abc123");
    useStore.getState().resetSession();
    expect(useStore.getState().identifiedHex).toBeNull();
  });
});
