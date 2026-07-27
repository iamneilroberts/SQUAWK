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
  let timer: ReturnType<typeof setInterval> | undefined;

  fetchConfig()
    .then((config) => {
      if (stopped) return;
      useStore.getState().setHome(config.home);
      const { lat, lon } = config.home;
      timer = setInterval(() => {
        fetchAdsb(lat, lon, 80)
          .then((r) => useStore.getState().applyFetch(r))
          .catch(() => useStore.getState().markFetchFailed());
      }, intervalMs);
    })
    .catch(() => useStore.getState().markFetchFailed());

  return () => {
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
  };
}
