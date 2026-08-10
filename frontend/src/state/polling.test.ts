import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clientTrafficCadenceSeconds,
  startTrafficPolling,
  useStore,
  type PollingVisibility,
} from "./store";
import {
  fetchActiveMissionTraffic,
  fetchConfig,
  fetchTraffic,
  type TrafficFetchResult,
} from "../data/api";
import type { Contact } from "../data/types";
import type { LockedMissionView } from "../mission/contract";

vi.mock("../data/api", () => ({
  FeedDownError: class FeedDownError extends Error {
    retryAfterSeconds = null;
  },
  fetchConfig: vi.fn(),
  fetchTraffic: vi.fn(),
  fetchActiveMissionTraffic: vi.fn(),
}));

const mockedFetchConfig = vi.mocked(fetchConfig);
const mockedFetchTraffic = vi.mocked(fetchTraffic);
const mockedFetchActiveMissionTraffic = vi.mocked(fetchActiveMissionTraffic);

type FetchResult = TrafficFetchResult;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeVisibility(initial: boolean): PollingVisibility & { set(visible: boolean): void } {
  let visible = initial;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      visible = next;
      for (const listener of listeners) listener();
    },
  };
}

const contact = (hex: string): any => ({
  hex, flight: null, t: null, lat: 30, lon: -88, alt_geom: 3500,
  alt_baro: 3400, gs: 120, track: 90, baro_rate: 0, military: false, seen_pos: 1,
});

const trafficResult = (
  contacts: Contact[] = [],
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
  regionKey: "r1:1:2:100",
  nextRefreshSeconds: 1,
  cacheStatus: "MISS",
  radiusNm: 80,
  mode: "NORMAL",
  ...overrides,
});

const lockedMission = {
  schemaVersion: 1,
  missionId: "00000000-0000-4000-8000-000000000001",
  status: "locked",
  classId: "c172s",
  contact: contact("abc123"),
  assist: "medium",
} as LockedMissionView;

beforeEach(() => {
  vi.useFakeTimers();
  mockedFetchConfig.mockReset();
  mockedFetchTraffic.mockReset();
  mockedFetchActiveMissionTraffic.mockReset();
  useStore.getState().resetSession();
  useStore.getState().applyFetch(trafficResult());
  useStore.getState().setSavedCenter(null);
  useStore.getState().setPollingIdentity("anonymous");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startTrafficPolling overlap and quiescence", () => {
  it("skips a tick while the previous fetch is still in flight", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    // Default so an unguarded overlapping call resolves instead of crashing on
    // an unstubbed mock — keeps the broken-arm failure a clean call-count
    // mismatch rather than an unrelated TypeError.
    mockedFetchTraffic.mockResolvedValue(trafficResult());
    const first = deferred<FetchResult>();
    mockedFetchTraffic.mockReturnValueOnce(first.promise);

    const stop = startTrafficPolling({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // config resolves and traffic starts immediately
    expect(mockedFetchTraffic).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // no next timer is armed while traffic is pending
    expect(mockedFetchTraffic).toHaveBeenCalledTimes(1);

    first.resolve(trafficResult([], "t", 1));
    await vi.advanceTimersByTimeAsync(0); // flush the resolved fetch's finally()

    mockedFetchTraffic.mockResolvedValueOnce(trafficResult([], "t", 2));
    await vi.advanceTimersByTimeAsync(1000); // tick 3: free again, fires
    expect(mockedFetchTraffic).toHaveBeenCalledTimes(2);

    stop();
  });

  it("does not mutate the store when a fetch resolves after stop()", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    const pending = deferred<FetchResult>();
    mockedFetchTraffic.mockReturnValueOnce(pending.promise);

    useStore.getState().applyFetch(trafficResult([contact("baseline")], "sentinel", 42));

    const stop = startTrafficPolling({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // config resolves and traffic is left pending
    expect(mockedFetchTraffic).toHaveBeenCalledTimes(1);

    stop();
    pending.resolve(trafficResult([contact("late")], "late-source", 999));
    await vi.advanceTimersByTimeAsync(0); // flush the now-resolved promise

    const s = useStore.getState();
    expect(s.feedSource).toBe("sentinel");
    expect(s.contacts.has("late")).toBe(false);
    expect(s.contacts.has("baseline")).toBe(true);
  });
});

describe("startTrafficPolling radius", () => {
  it("reads the current radiusNm from the store on each tick, not a hard-coded value", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    mockedFetchTraffic.mockResolvedValue(trafficResult());
    useStore.getState().setRadiusNm(150);

    const stop = startTrafficPolling({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // config resolves and traffic starts immediately

    expect(mockedFetchTraffic).toHaveBeenCalledWith(1, 2, 150);
    expect(mockedFetchTraffic).toHaveBeenCalledOnce();

    stop();
    useStore.getState().setRadiusNm(80); // reset for other tests sharing the singleton store
  });

  it("uses the active mission endpoint, simulator position, and same bounded radius", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    mockedFetchActiveMissionTraffic.mockResolvedValue(trafficResult());
    useStore.getState().startLockedMission(lockedMission);

    const stop = startTrafficPolling({
      intervalMs: 1000,
      activePosition: () => ({ lat: 31, lon: -87 }),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockedFetchActiveMissionTraffic).toHaveBeenCalledWith(
      lockedMission.missionId,
      31,
      -87,
      80,
    );
    expect(mockedFetchTraffic).not.toHaveBeenCalled();
    stop();
  });

  it("makes zero config or traffic requests while a local tutorial is active", async () => {
    useStore.getState().startTutorial(lockedMission, {
      definitionId: "landing-c172s-kmob-15",
      version: "v1",
      classId: "c172s",
      unranked: true,
    });
    const stop = startTrafficPolling({ intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockedFetchConfig).not.toHaveBeenCalled();
    expect(mockedFetchTraffic).not.toHaveBeenCalled();
    expect(mockedFetchActiveMissionTraffic).not.toHaveBeenCalled();
    stop();
  });

  it("keeps the locked local simulation running when active traffic is unavailable", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    mockedFetchActiveMissionTraffic.mockRejectedValue(new Error("network lost"));
    useStore.getState().startLockedMission(lockedMission);
    useStore.getState().fire("COUNTDOWN_DONE");

    const stop = startTrafficPolling({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);

    expect(useStore.getState().mode).toBe("FLYING");
    expect(useStore.getState().lockedMission?.missionId).toBe(lockedMission.missionId);
    expect(useStore.getState().feedStatus).toBe("stale");
    stop();
  });

  it("uses the authenticated saved center once config establishes the fallback", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    mockedFetchTraffic.mockResolvedValue(trafficResult());
    useStore.getState().setSavedCenter({ lat: 30.69, lon: -88.04 });
    useStore.getState().setPollingIdentity("signed");

    const stop = startTrafficPolling({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockedFetchTraffic).toHaveBeenCalledWith(30.69, -88.04, 80);
    stop();
  });
});

describe("startTrafficPolling cold-start recovery (backend down at page load)", () => {
  it("escalates to OFFLINE via the normal 3-failure threshold when fetchConfig keeps rejecting", async () => {
    mockedFetchConfig.mockRejectedValue(new Error("backend down"));

    const stop = startTrafficPolling({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // attempt 1: fails immediately, before any interval tick
    expect(useStore.getState().feedStatus).toBe("stale");

    await vi.advanceTimersByTimeAsync(1000); // attempt 2
    expect(useStore.getState().feedStatus).toBe("stale");

    await vi.advanceTimersByTimeAsync(1000); // attempt 3 -> threshold reached
    expect(useStore.getState().feedStatus).toBe("offline");

    stop();
  });

  it("recovers to LIVE on its own once the backend answers again, with no reload", async () => {
    mockedFetchConfig
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue({ home: { lat: 1, lon: 2 } });
    mockedFetchTraffic.mockResolvedValue(trafficResult([contact("recovered")], "recovered-src", 123));

    const stop = startTrafficPolling({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // attempt 1: reject
    await vi.advanceTimersByTimeAsync(1000); // attempt 2: reject
    await vi.advanceTimersByTimeAsync(1000); // attempt 3: reject -> offline
    expect(useStore.getState().feedStatus).toBe("offline");

    await vi.advanceTimersByTimeAsync(1000); // attempt 4: config resolves, then traffic loads immediately
    await vi.advanceTimersByTimeAsync(1); // run the zero-delay traffic tick armed by config

    const s = useStore.getState();
    expect(s.feedStatus).toBe("live");
    expect(s.feedSource).toBe("recovered-src");
    expect(s.contacts.has("recovered")).toBe(true);

    stop();
  });
});

describe("visibility and cadence policy", () => {
  it("uses anonymous, signed, active-flight, and conservation cadences", () => {
    expect(clientTrafficCadenceSeconds("anonymous", "BROWSE", "NORMAL")).toBe(15);
    expect(clientTrafficCadenceSeconds("signed", "BROWSE", "NORMAL")).toBe(8);
    expect(clientTrafficCadenceSeconds("anonymous", "FLYING", "NORMAL")).toBe(12);
    expect(clientTrafficCadenceSeconds("anonymous", "BROWSE", "READ_ONLY")).toBe(30);
    expect(clientTrafficCadenceSeconds("signed", "BROWSE", "READ_ONLY")).toBe(15);
  });

  it("does no polling while hidden and resumes immediately when visible", async () => {
    const visibility = fakeVisibility(false);
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    mockedFetchTraffic.mockResolvedValue(trafficResult());
    const stop = startTrafficPolling({ intervalMs: 1000, visibility });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockedFetchConfig).not.toHaveBeenCalled();
    visibility.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedFetchConfig).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); // run the zero-delay traffic tick armed by config
    expect(mockedFetchTraffic).toHaveBeenCalledOnce();

    visibility.set(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockedFetchTraffic).toHaveBeenCalledOnce();
    visibility.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedFetchTraffic).toHaveBeenCalledTimes(2);
    stop();
  });

  it("never schedules sooner than nextRefreshSeconds returned by the server", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    mockedFetchTraffic.mockResolvedValue(trafficResult([], "t", 1, { nextRefreshSeconds: 30 }));
    const stop = startTrafficPolling({ intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockedFetchTraffic).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mockedFetchTraffic).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockedFetchTraffic).toHaveBeenCalledTimes(2);
    stop();
  });
});
