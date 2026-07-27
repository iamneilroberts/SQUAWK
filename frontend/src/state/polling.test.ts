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
