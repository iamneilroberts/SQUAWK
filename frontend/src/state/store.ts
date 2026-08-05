import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import type { Contact, FeedStatus } from "../data/types";
import { fetchAdsb, fetchConfig } from "../data/api";

type State = {
  home: { lat: number; lon: number } | null;
  contacts: Map<string, Contact>;
  selectedHex: string | null;
  feedStatus: FeedStatus;
  feedSource: string | null;
  lastFetchAt: number | null;
  setHome(h: { lat: number; lon: number }): void;
  applyFetch(r: { contacts: Contact[]; source: string; fetched_at: number }): void;
  markFetchFailed(): void;
  select(hex: string | null): void;
};

// Consecutive-failure count backing markFetchFailed's stale/offline threshold.
// Kept outside the store since it's an implementation detail, not state consumers read.
let consecutiveFailures = 0;

export const useStore: UseBoundStore<StoreApi<State>> = create<State>()((set, get) => ({
  home: null,
  contacts: new Map(),
  selectedHex: null,
  feedStatus: "offline",
  feedSource: null,
  lastFetchAt: null,

  setHome(h) {
    set({ home: h });
  },

  applyFetch(r) {
    consecutiveFailures = 0;
    const contacts = new Map(r.contacts.map((c) => [c.hex, c]));
    const selectedHex = get().selectedHex;
    set({
      contacts,
      feedStatus: "live",
      feedSource: r.source,
      lastFetchAt: r.fetched_at,
      selectedHex: selectedHex !== null && contacts.has(selectedHex) ? selectedHex : null,
    });
  },

  markFetchFailed() {
    consecutiveFailures += 1;
    set({ feedStatus: consecutiveFailures >= 3 ? "offline" : "stale" });
  },

  select(hex) {
    set({ selectedHex: hex });
  },
}));

export function startPolling(intervalMs = 5000): () => void {
  let stopped = false;
  let inFlight = false;
  let home: { lat: number; lon: number } | null = null;

  // One recurring tick, armed for the whole lifetime of the poller: fetch config until
  // it succeeds, then fetch ADS-B. This is what lets a backend that's down at page load
  // (config fetch rejects) still retry on the normal cadence — reaching OFFLINE via the
  // usual 3-failure threshold and recovering on its own once the backend answers, instead
  // of failing once and never being retried.
  function tick() {
    if (inFlight) return; // previous tick's fetch hasn't resolved yet — skip, don't queue
    inFlight = true;

    const attempt =
      home === null
        ? fetchConfig().then((config) => {
            if (stopped) return; // stop() fired while this fetch was in flight — don't touch the store
            home = config.home;
            useStore.getState().setHome(config.home);
          })
        : fetchAdsb(home.lat, home.lon, 80).then((r) => {
            if (stopped) return;
            useStore.getState().applyFetch(r);
          });

    attempt
      .catch(() => {
        if (stopped) return;
        useStore.getState().markFetchFailed();
      })
      .finally(() => {
        inFlight = false;
      });
  }

  tick(); // fire the first attempt immediately rather than waiting a full interval
  const timer = setInterval(tick, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
