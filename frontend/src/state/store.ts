import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import type { Contact, FeedStatus } from "../data/types";
import {
  FeedDownError,
  fetchConfig,
  fetchTraffic,
  type TrafficFetchResult,
} from "../data/api";
import {
  ACTIVE_FLIGHT_REFRESH_SECONDS,
  ANONYMOUS_REFRESH_SECONDS,
  CONSERVATION_ANONYMOUS_REFRESH_SECONDS,
  CONSERVATION_SIGNED_BROWSE_REFRESH_SECONDS,
  SIGNED_BROWSE_REFRESH_SECONDS,
  TRAFFIC_EXPIRE_SECONDS,
} from "../shared/limits";
import type { SystemMode } from "../shared/mode";
import { nextMode } from "../game/machine";
import type { GameEvent, Mode } from "../game/machine";
import type { FlightStats } from "../game/stats";
import type { BasemapKind } from "../globe/mapSources";

export type PollingIdentity = "anonymous" | "signed";

type State = {
  home: { lat: number; lon: number } | null;
  savedCenter: { lat: number; lon: number } | null;
  pollingIdentity: PollingIdentity;
  contacts: Map<string, Contact>;
  selectedHex: string | null;
  feedStatus: FeedStatus;
  feedSource: string | null;
  lastFetchAt: number | null;
  cacheAgeSeconds: number | null;
  providerAvailable: boolean;
  regionKey: string | null;
  nextRefreshSeconds: number;
  systemMode: SystemMode;
  /** Fetch radius in nautical miles, cycled by the status-bar chip (StatusBar.tsx's nextRadius). */
  radiusNm: number;
  /**
   * View preferences, NOT session state — which is why `resetSession` does not touch them.
   * They live in the store, unlike the cockpit strip's collapse flags, because `StatusBar` is a
   * flex sibling of `ViewerHost` (decisions B-015) and has no other route to the viewer.
   */
  basemap: BasemapKind;
  labelsOn: boolean;
  /**
   * Mobile immersive/fullscreen flight requested (#13). A view preference like basemap/labels,
   * held here for the same reason: StatusBar (a flex sibling of the viewer) and FlightSession both
   * need it and have no other shared channel. Inert unless narrow + FLYING (isImmersiveActive).
   */
  immersive: boolean;
  /**
   * Whether the informational overlays are currently shown, driven by the video-player auto-hide
   * in immersive flight (overlaysVisible). Default true; only ImmersiveControl flips it, and only
   * while immersive is active. Attribution is faded via this flag, never removed from the DOM.
   */
  chromeVisible: boolean;
  setHome(h: { lat: number; lon: number }): void;
  setSavedCenter(center: { lat: number; lon: number } | null): void;
  setPollingIdentity(identity: PollingIdentity): void;
  setRadiusNm(n: number): void;
  setBasemap(k: BasemapKind): void;
  setLabelsOn(on: boolean): void;
  setImmersive(on: boolean): void;
  setChromeVisible(on: boolean): void;
  applyFetch(r: TrafficFetchResult): void;
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
let lastTrafficAppliedAtMs: number | null = null;

export const useStore: UseBoundStore<StoreApi<State>> = create<State>()((set, get) => ({
  home: null,
  savedCenter: null,
  pollingIdentity: "anonymous",
  contacts: new Map(),
  selectedHex: null,
  feedStatus: "offline",
  feedSource: null,
  lastFetchAt: null,
  cacheAgeSeconds: null,
  providerAvailable: false,
  regionKey: null,
  nextRefreshSeconds: ANONYMOUS_REFRESH_SECONDS,
  systemMode: "NORMAL",
  radiusNm: 80,
  basemap: "SAT",
  labelsOn: false,
  immersive: false,
  chromeVisible: true,
  mode: "BROWSE",
  origin: null,
  endStats: null,

  setHome(h) {
    set({ home: h });
  },

  setSavedCenter(center) {
    set({ savedCenter: center });
  },

  setPollingIdentity(identity) {
    set({ pollingIdentity: identity });
  },

  setRadiusNm(n) {
    set({ radiusNm: n });
  },

  setBasemap(k) {
    set({ basemap: k });
  },

  setLabelsOn(on) {
    set({ labelsOn: on });
  },

  setImmersive(on) {
    // Leaving immersive restores the informational overlays so nothing is left faded off-screen.
    set(on ? { immersive: true } : { immersive: false, chromeVisible: true });
  },

  setChromeVisible(on) {
    set({ chromeVisible: on });
  },

  applyFetch(r) {
    consecutiveFailures = 0;
    lastTrafficAppliedAtMs = Date.now();
    const contacts = new Map(r.contacts.map((c) => [c.hex, c]));
    const selectedHex = get().selectedHex;
    set({
      contacts,
      feedStatus: r.freshness === "FRESH" ? "live" : r.freshness === "STALE" ? "stale" : "offline",
      feedSource: r.source,
      lastFetchAt: r.fetchedAt,
      cacheAgeSeconds: r.cacheAgeSeconds,
      providerAvailable: r.providerAvailable,
      regionKey: r.regionKey,
      nextRefreshSeconds: r.nextRefreshSeconds,
      systemMode: r.mode,
      selectedHex: selectedHex !== null && contacts.has(selectedHex) ? selectedHex : null,
    });
  },

  markFetchFailed() {
    consecutiveFailures += 1;
    const state = get();
    const elapsedSeconds = lastTrafficAppliedAtMs === null
      ? 0
      : Math.max(0, (Date.now() - lastTrafficAppliedAtMs) / 1_000);
    const totalCacheAgeSeconds = state.cacheAgeSeconds === null
      ? null
      : state.cacheAgeSeconds + elapsedSeconds;
    if (totalCacheAgeSeconds !== null && totalCacheAgeSeconds >= TRAFFIC_EXPIRE_SECONDS) {
      set({
        contacts: new Map(),
        selectedHex: null,
        feedStatus: "offline",
        cacheAgeSeconds: totalCacheAgeSeconds,
        providerAvailable: false,
      });
      return;
    }
    set({
      feedStatus: consecutiveFailures >= 3 ? "offline" : "stale",
      cacheAgeSeconds: totalCacheAgeSeconds,
      providerAvailable: false,
    });
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

export type PollingVisibility = {
  isVisible(): boolean;
  subscribe(listener: () => void): () => void;
};

export type TrafficPollingOptions = {
  intervalMs?: number;
  identity?: () => PollingIdentity;
  visibility?: PollingVisibility;
};

const alwaysVisible: PollingVisibility = {
  isVisible: () => true,
  subscribe: () => () => undefined,
};

export function browserPollingVisibility(): PollingVisibility {
  if (typeof document === "undefined") return alwaysVisible;
  return {
    isVisible: () => document.visibilityState !== "hidden",
    subscribe(listener) {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

export function clientTrafficCadenceSeconds(
  identity: PollingIdentity,
  mode: Mode,
  systemMode: SystemMode,
): number {
  if (mode === "COUNTDOWN" || mode === "FLYING" || mode === "PAUSED") {
    return ACTIVE_FLIGHT_REFRESH_SECONDS;
  }
  const conserving = systemMode !== "NORMAL";
  if (identity === "signed") {
    return conserving
      ? CONSERVATION_SIGNED_BROWSE_REFRESH_SECONDS
      : SIGNED_BROWSE_REFRESH_SECONDS;
  }
  return conserving ? CONSERVATION_ANONYMOUS_REFRESH_SECONDS : ANONYMOUS_REFRESH_SECONDS;
}

export function startTrafficPolling(options: TrafficPollingOptions = {}): () => void {
  let stopped = false;
  let inFlight = false;
  let home: { lat: number; lon: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const visibility = options.visibility ?? browserPollingVisibility();
  const identity = options.identity ?? (() => useStore.getState().pollingIdentity);

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function delayMs(serverSeconds?: number): number {
    const state = useStore.getState();
    const clientMs = options.intervalMs ??
      clientTrafficCadenceSeconds(identity(), state.mode, state.systemMode) * 1_000;
    const serverMs = serverSeconds === undefined ? 0 : serverSeconds * 1_000;
    return Math.max(clientMs, serverMs);
  }

  function schedule(milliseconds: number): void {
    clearTimer();
    if (stopped || !visibility.isVisible()) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, milliseconds);
  }

  // One recurring tick, armed for the whole lifetime of the poller: fetch config until
  // it succeeds, then fetch regional traffic. This is what lets a backend that's down at page load
  // (config fetch rejects) still retry on the normal cadence — reaching OFFLINE via the
  // usual 3-failure threshold and recovering on its own once the backend answers, instead
  // of failing once and never being retried.
  function tick(): void {
    if (stopped || inFlight || !visibility.isVisible()) return;
    inFlight = true;
    let serverNextSeconds: number | undefined;
    let retryAfterSeconds: number | undefined;
    let loadedConfig = false;
    const attempt: Promise<void | TrafficFetchResult> =
      home === null
        ? fetchConfig().then((config) => {
            if (stopped) return; // stop() fired while this fetch was in flight — don't touch the store
            home = config.home;
            useStore.getState().setHome(config.home);
            loadedConfig = true;
          })
        : (() => {
            const state = useStore.getState();
            const center = state.savedCenter ?? home;
            return fetchTraffic(center.lat, center.lon, state.radiusNm);
          })().then((r) => {
            if (stopped) return;
            useStore.getState().applyFetch(r);
            serverNextSeconds = r.nextRefreshSeconds;
            return r;
          });

    attempt
      .catch((error: unknown) => {
        if (stopped) return;
        if (error instanceof FeedDownError && error.retryAfterSeconds !== null) {
          retryAfterSeconds = error.retryAfterSeconds;
        }
        useStore.getState().markFetchFailed();
      })
      .finally(() => {
        inFlight = false;
        if (!stopped) {
          schedule(
            loadedConfig
              ? 0
              : delayMs(Math.max(serverNextSeconds ?? 0, retryAfterSeconds ?? 0)),
          );
        }
      });
  }

  const unsubscribeVisibility = visibility.subscribe(() => {
    if (!visibility.isVisible()) clearTimer();
    else if (!inFlight) schedule(0);
  });
  tick();

  return () => {
    stopped = true;
    clearTimer();
    unsubscribeVisibility();
  };
}
