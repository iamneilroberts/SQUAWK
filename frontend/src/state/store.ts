import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import type { Contact, FeedStatus } from "../data/types";
import { fetchAdsb, fetchConfig } from "../data/api";
import { nextMode } from "../game/machine";
import type { GameEvent, Mode } from "../game/machine";
import type { FlightStats } from "../game/stats";

type State = {
  home: { lat: number; lon: number } | null;
  contacts: Map<string, Contact>;
  selectedHex: string | null;
  feedStatus: FeedStatus;
  feedSource: string | null;
  lastFetchAt: number | null;
  /** Fetch radius in nautical miles, cycled by the status-bar chip (StatusBar.tsx's nextRadius). */
  radiusNm: number;
  setHome(h: { lat: number; lon: number }): void;
  setRadiusNm(n: number): void;
  applyFetch(r: { contacts: Contact[]; source: string; fetched_at: number }): void;
  markFetchFailed(): void;
  select(hex: string | null): void;
  /**
   * Session mode. The ONLY session state zustand holds, along with origin and endStats:
   * sim state lives in a mutable ref because a 60 Hz set() would re-render React.
   */
  mode: Mode;
  /**
   * The frozen snapshot the flight was built from. Deliberately separate from selectedHex,
   * which applyFetch nulls the moment the contact leaves the feed — the origin must survive
   * that, and must never be dead-reckoned forward.
   */
  origin: { hex: string; snapshot: Contact } | null;
  endStats: FlightStats | null;
  /**
   * The ONLY thing that changes `mode`. Every transition goes through game/machine.ts's
   * table, so an illegal event (a terrain impact resolving a frame after QUIT) is a no-op
   * instead of a bogus state. There is no setMode by design — it would let callers bypass
   * the machine and the table would quietly become documentation.
   */
  fire(event: GameEvent): void;
  setOrigin(o: { hex: string; snapshot: Contact } | null): void;
  setEndStats(s: FlightStats | null): void;
  /** Clears the session payload without touching the mode. */
  clearSession(): void;
  resetSession(): void;
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
  radiusNm: 80,
  mode: "BROWSE",
  origin: null,
  endStats: null,

  setHome(h) {
    set({ home: h });
  },

  setRadiusNm(n) {
    set({ radiusNm: n });
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

  fire(event) {
    set({ mode: nextMode(get().mode, event) });
  },

  setOrigin(o) {
    set({ origin: o });
  },

  setEndStats(s) {
    set({ endStats: s });
  },

  clearSession() {
    set({ origin: null, endStats: null });
  },

  /** Hard reset: back to BROWSE with no residue (spec §6). */
  resetSession() {
    set({ mode: "BROWSE", origin: null, endStats: null });
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
        : fetchAdsb(home.lat, home.lon, useStore.getState().radiusNm).then((r) => {
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
