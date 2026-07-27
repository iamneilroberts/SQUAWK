import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

const contact = (hex: string): any => ({
  hex, flight: null, t: null, lat: 30, lon: -88, alt_geom: 3500,
  alt_baro: 3400, gs: 120, track: 90, baro_rate: 0, military: false, seen_pos: 1,
});

beforeEach(() => useStore.getState().applyFetch({ contacts: [], source: "t", fetched_at: 0 }));

describe("store", () => {
  it("applyFetch replaces the contact set and goes live", () => {
    useStore.getState().applyFetch({ contacts: [contact("abc123")], source: "airplanes.live", fetched_at: 111 });
    const s = useStore.getState();
    expect(s.contacts.get("abc123")).toBeTruthy();
    expect(s.feedStatus).toBe("live");
    expect(s.feedSource).toBe("airplanes.live");
  });
  it("selection survives a refresh while the contact exists, clears when it ages out", () => {
    useStore.getState().applyFetch({ contacts: [contact("abc123")], source: "t", fetched_at: 1 });
    useStore.getState().select("abc123");
    useStore.getState().applyFetch({ contacts: [contact("abc123")], source: "t", fetched_at: 2 });
    expect(useStore.getState().selectedHex).toBe("abc123");
    useStore.getState().applyFetch({ contacts: [], source: "t", fetched_at: 3 });
    expect(useStore.getState().selectedHex).toBeNull();
  });
  it("three consecutive failures = offline, one success recovers", () => {
    const s = () => useStore.getState();
    s().markFetchFailed(); expect(s().feedStatus).toBe("stale");
    s().markFetchFailed(); s().markFetchFailed();
    expect(s().feedStatus).toBe("offline");
    s().applyFetch({ contacts: [], source: "t", fetched_at: 9 });
    expect(s().feedStatus).toBe("live");
  });
});
