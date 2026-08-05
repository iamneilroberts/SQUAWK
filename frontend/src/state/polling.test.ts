import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useStore, startPolling } from "./store";
import { fetchAdsb, fetchConfig } from "../data/api";
import type { Contact } from "../data/types";

vi.mock("../data/api", () => ({
  fetchConfig: vi.fn(),
  fetchAdsb: vi.fn(),
}));

const mockedFetchConfig = vi.mocked(fetchConfig);
const mockedFetchAdsb = vi.mocked(fetchAdsb);

type FetchResult = { contacts: Contact[]; source: string; fetched_at: number };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const contact = (hex: string): any => ({
  hex, flight: null, t: null, lat: 30, lon: -88, alt_geom: 3500,
  alt_baro: 3400, gs: 120, track: 90, baro_rate: 0, military: false, seen_pos: 1,
});

beforeEach(() => {
  vi.useFakeTimers();
  mockedFetchConfig.mockReset();
  mockedFetchAdsb.mockReset();
  useStore.getState().applyFetch({ contacts: [], source: "t", fetched_at: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startPolling overlap and quiescence", () => {
  it("skips a tick while the previous fetch is still in flight", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    // Default so an unguarded overlapping call resolves instead of crashing on
    // an unstubbed mock — keeps the broken-arm failure a clean call-count
    // mismatch rather than an unrelated TypeError.
    mockedFetchAdsb.mockResolvedValue({ contacts: [], source: "t", fetched_at: 0 });
    const first = deferred<FetchResult>();
    mockedFetchAdsb.mockReturnValueOnce(first.promise);

    const stop = startPolling(1000);
    await vi.advanceTimersByTimeAsync(0); // let fetchConfig's .then arm the interval

    await vi.advanceTimersByTimeAsync(1000); // tick 1: fires, stays pending
    expect(mockedFetchAdsb).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // tick 2: previous still in flight, should be skipped
    expect(mockedFetchAdsb).toHaveBeenCalledTimes(1);

    first.resolve({ contacts: [], source: "t", fetched_at: 1 });
    await vi.advanceTimersByTimeAsync(0); // flush the resolved fetch's finally()

    mockedFetchAdsb.mockResolvedValueOnce({ contacts: [], source: "t", fetched_at: 2 });
    await vi.advanceTimersByTimeAsync(1000); // tick 3: free again, fires
    expect(mockedFetchAdsb).toHaveBeenCalledTimes(2);

    stop();
  });

  it("does not mutate the store when a fetch resolves after stop()", async () => {
    mockedFetchConfig.mockResolvedValue({ home: { lat: 1, lon: 2 } });
    const pending = deferred<FetchResult>();
    mockedFetchAdsb.mockReturnValueOnce(pending.promise);

    useStore.getState().applyFetch({
      contacts: [contact("baseline")],
      source: "sentinel",
      fetched_at: 42,
    });

    const stop = startPolling(1000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000); // tick fires, fetch left pending
    expect(mockedFetchAdsb).toHaveBeenCalledTimes(1);

    stop();
    pending.resolve({ contacts: [contact("late")], source: "late-source", fetched_at: 999 });
    await vi.advanceTimersByTimeAsync(0); // flush the now-resolved promise

    const s = useStore.getState();
    expect(s.feedSource).toBe("sentinel");
    expect(s.contacts.has("late")).toBe(false);
    expect(s.contacts.has("baseline")).toBe(true);
  });
});

describe("startPolling cold-start recovery (backend down at page load)", () => {
  it("escalates to OFFLINE via the normal 3-failure threshold when fetchConfig keeps rejecting", async () => {
    mockedFetchConfig.mockRejectedValue(new Error("backend down"));

    const stop = startPolling(1000);
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
    mockedFetchAdsb.mockResolvedValue({
      contacts: [contact("recovered")],
      source: "recovered-src",
      fetched_at: 123,
    });

    const stop = startPolling(1000);
    await vi.advanceTimersByTimeAsync(0); // attempt 1: reject
    await vi.advanceTimersByTimeAsync(1000); // attempt 2: reject
    await vi.advanceTimersByTimeAsync(1000); // attempt 3: reject -> offline
    expect(useStore.getState().feedStatus).toBe("offline");

    await vi.advanceTimersByTimeAsync(1000); // attempt 4: fetchConfig finally resolves
    await vi.advanceTimersByTimeAsync(1000); // attempt 5: fetchAdsb resolves -> back to live

    const s = useStore.getState();
    expect(s.feedStatus).toBe("live");
    expect(s.feedSource).toBe("recovered-src");
    expect(s.contacts.has("recovered")).toBe(true);

    stop();
  });
});
