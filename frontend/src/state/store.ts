import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import type { Contact, FeedStatus } from "../data/types";
import {
  FeedDownError,
  fetchActiveMissionTraffic,
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
import type { LockedMissionView } from "../mission/contract";
import type { TutorialRun } from "../tutorial/definitions";
import {
  initialAssistState,
  selectAssist,
  type AssistState,
} from "../mission/assistState";
import {
  assistModeFromPreference,
  type AssistMode,
} from "../mission/assists";

export type PollingIdentity = "anonymous" | "signed";

type State = {
  home: { lat: number; lon: number } | null;
  savedCenter: { lat: number; lon: number } | null;
  pollingIdentity: PollingIdentity;
  contacts: Map<string, Contact>;
  selectedHex: string | null;
  selectionLocked: boolean;
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
  /**
   * Manual "declutter" toggle (#57): hides informational flight chrome (HUD variant button,
   * APP button, PILOT callsign chip, traffic labels) on demand. A view preference like
   * immersive/chromeVisible, and deliberately SEPARATE from chromeVisible's timer-based
   * auto-hide — this is an owner-driven choice, not idle detection, so the two compose
   * (`!decluttered && ...`) rather than one reusing the other.
   */
  decluttered: boolean;
  /**
   * Exterior (chase/orbit) camera active during flight (#61). The view mode itself lives in the
   * camera host (a plain closure, not React state); FlightSession mirrors it here so React layers
   * — e.g. MissionRouteLayer, which hides the route line in exterior view — can react to it.
   */
  exterior: boolean;
  setHome(h: { lat: number; lon: number }): void;
  setSavedCenter(center: { lat: number; lon: number } | null): void;
  setPollingIdentity(identity: PollingIdentity): void;
  setRadiusNm(n: number): void;
  setBasemap(k: BasemapKind): void;
  setLabelsOn(on: boolean): void;
  setImmersive(on: boolean): void;
  setChromeVisible(on: boolean): void;
  setDeclutter(on: boolean): void;
  setExterior(on: boolean): void;
  applyFetch(r: TrafficFetchResult): void;
  markFetchFailed(mode?: SystemMode): void;
  select(hex: string | null): void;
  setSelectionLocked(locked: boolean): void;
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
  /** The committed Worker response that is the sole authority for a running simulation. */
  lockedMission: LockedMissionView | null;
  /** Present only for a deterministic local tutorial; suppresses all traffic/API polling. */
  tutorial: TutorialRun | null;
  assist: AssistState | null;
  endStats: FlightStats | null;
  /**
   * The ONLY thing that changes `mode`. Every transition goes through game/machine.ts's
   * table, so an illegal event (a terrain impact resolving a frame after QUIT) is a no-op
   * instead of a bogus state. There is no setMode by design — it would let callers bypass
   * the machine and the table would quietly become documentation.
   */
  fire(event: GameEvent): void;
  setOrigin(o: { hex: string; snapshot: Contact } | null): void;
  startLockedMission(mission: LockedMissionView): boolean;
  startTutorial(mission: LockedMissionView, tutorial: TutorialRun): boolean;
  setAssistMode(mode: AssistMode): void;
  setEndStats(s: FlightStats | null): void;
  /** Clears the session payload without touching the mode. */
  clearSession(): void;
  resetSession(): void;
};

// Consecutive-failure count backing markFetchFailed's stale/offline threshold.
// Kept outside the store since it's an implementation detail, not state consumers read.
let consecutiveFailures = 0;
let lastTrafficAppliedAtMs: number | null = null;

// The running traffic poller registers its immediate-refresh here (issue #41), so store actions
// that change what the client should be looking at — select() and setRadiusNm() — can ADVANCE the
// next poll instead of waiting out the 30 s browse cadence. It only reuses the poller's schedule(0)
// debounce; it never fires a parallel upstream call (the server keeps a 30 s region cache and a DO
// 1/s gate). Null when no poller is running, so it is a no-op off the browse screen and in tests.
let activeRefreshNow: (() => void) | null = null;

function triggerRefreshNow(): void {
  activeRefreshNow?.();
}

/**
 * Seconds of wall-clock elapsed since the last traffic snapshot was applied, from the same
 * `lastTrafficAppliedAtMs` clock markFetchFailed ages the cache with. Used to age a frozen
 * snapshot's `seen_pos` forward so displayed flyability stays honest between polls (issue #41).
 */
export function secondsSinceTrafficApplied(nowMs: number = Date.now()): number {
  if (lastTrafficAppliedAtMs === null) return 0;
  return Math.max(0, (nowMs - lastTrafficAppliedAtMs) / 1_000);
}

export const useStore: UseBoundStore<StoreApi<State>> = create<State>()((set, get) => ({
  home: null,
  savedCenter: null,
  pollingIdentity: "anonymous",
  contacts: new Map(),
  selectedHex: null,
  selectionLocked: false,
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
  decluttered: false,
  exterior: false,
  mode: "BROWSE",
  origin: null,
  lockedMission: null,
  tutorial: null,
  assist: null,
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
    // Advance the next poll so the client's freshness matches the new radius the server will
    // validate against (issue #41). No-op if no poller is running or one is already in flight.
    triggerRefreshNow();
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

  setDeclutter(on) {
    set({ decluttered: on });
  },

  setExterior(on) {
    set({ exterior: on });
  },

  applyFetch(r) {
    consecutiveFailures = 0;
    lastTrafficAppliedAtMs = Date.now();
    const state = get();
    const contacts = new Map(r.contacts.map((c) => [c.hex, c]));
    const selectedHex = state.selectedHex;
    if (state.selectionLocked && selectedHex !== null && !contacts.has(selectedHex)) {
      const frozen = state.contacts.get(selectedHex);
      if (frozen !== undefined) contacts.set(selectedHex, frozen);
    }
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
      selectedHex: state.selectionLocked
        ? selectedHex
        : selectedHex !== null && contacts.has(selectedHex) ? selectedHex : null,
    });
  },

  markFetchFailed(mode) {
    consecutiveFailures += 1;
    const state = get();
    if (mode === "KILL_SWITCH") {
      set({
        systemMode: mode,
        contacts: new Map(),
        selectedHex: null,
        feedStatus: "offline",
        providerAvailable: false,
      });
      return;
    }
    const elapsedSeconds = lastTrafficAppliedAtMs === null
      ? 0
      : Math.max(0, (Date.now() - lastTrafficAppliedAtMs) / 1_000);
    const totalCacheAgeSeconds = state.cacheAgeSeconds === null
      ? null
      : state.cacheAgeSeconds + elapsedSeconds;
    if (totalCacheAgeSeconds !== null && totalCacheAgeSeconds >= TRAFFIC_EXPIRE_SECONDS) {
      if (state.selectionLocked && state.selectedHex !== null) {
        const frozen = state.contacts.get(state.selectedHex);
        set({
          contacts: frozen === undefined ? new Map() : new Map([[state.selectedHex, frozen]]),
          feedStatus: "offline",
          cacheAgeSeconds: totalCacheAgeSeconds,
          providerAvailable: false,
        });
        return;
      }
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
      ...(mode === undefined ? {} : { systemMode: mode }),
      feedStatus: consecutiveFailures >= 3 ? "offline" : "stale",
      cacheAgeSeconds: totalCacheAgeSeconds,
      providerAvailable: false,
    });
  },

  select(hex) {
    if (get().selectionLocked) return;
    set({ selectedHex: hex });
    // Refresh on select so the picked contact's freshness is current when the player hits TAKE
    // CONTROLS and the server re-checks it (issue #41) — otherwise a snapshot up to 30 s old fails
    // the mission-lock freshness gate. Only when picking a real contact, not on deselect.
    if (hex !== null) triggerRefreshNow();
  },

  setSelectionLocked(locked) {
    set({ selectionLocked: locked });
  },

  fire(event) {
    set({ mode: nextMode(get().mode, event) });
  },

  setOrigin(o) {
    set({ origin: o });
  },

  startLockedMission(mission) {
    const currentMode = get().mode;
    const next = nextMode(currentMode, "TAKE_CONTROLS");
    if (currentMode !== "BROWSE" || next !== "COUNTDOWN" || mission.status !== "locked") {
      return false;
    }
    set({
      mode: next,
      lockedMission: mission,
      tutorial: null,
      origin: { hex: mission.contact.hex, snapshot: mission.contact },
      assist: initialAssistState(assistModeFromPreference(mission.assist)),
      endStats: null,
      selectionLocked: false,
    });
    return true;
  },

  startTutorial(mission, tutorial) {
    const currentMode = get().mode;
    const next = nextMode(currentMode, "TAKE_CONTROLS");
    if (currentMode !== "BROWSE" || next !== "COUNTDOWN" || mission.classId !== tutorial.classId) {
      return false;
    }
    set({
      mode: next,
      lockedMission: mission,
      tutorial,
      origin: { hex: mission.contact.hex, snapshot: mission.contact },
      assist: initialAssistState("FULL"),
      endStats: null,
      contacts: new Map(),
      selectedHex: null,
      selectionLocked: false,
    });
    return true;
  },

  setAssistMode(mode) {
    const current = get().assist;
    if (current === null) return;
    set({ assist: selectAssist(current, mode) });
  },

  setEndStats(s) {
    set({ endStats: s });
  },

  clearSession() {
    set({
      origin: null,
      lockedMission: null,
      tutorial: null,
      assist: null,
      endStats: null,
      selectionLocked: false,
    });
  },

  /** Hard reset: back to BROWSE with no residue (spec §6). */
  resetSession() {
    set({
      mode: "BROWSE",
      origin: null,
      lockedMission: null,
      tutorial: null,
      assist: null,
      endStats: null,
      selectionLocked: false,
    });
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
  activePosition?: () => { lat: number; lon: number } | null;
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
    if (useStore.getState().tutorial !== null) {
      inFlight = false;
      schedule(delayMs());
      return;
    }
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
            const active = state.mode === "COUNTDOWN" ||
              state.mode === "FLYING" ||
              state.mode === "PAUSED";
            if (active && state.lockedMission !== null) {
              const position = options.activePosition?.() ?? {
                lat: state.lockedMission.contact.lat,
                lon: state.lockedMission.contact.lon,
              };
              return fetchActiveMissionTraffic(
                state.lockedMission.missionId,
                position.lat,
                position.lon,
                state.radiusNm,
              );
            }
            // Location lock (2026-08-11): browse is pinned to the fixed home location.
            // savedCenter is ignored for now; custom locations return once the ADS-B
            // provider is validated for arbitrary centers.
            const center = home;
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
        useStore.getState().markFetchFailed(
          error instanceof FeedDownError ? error.mode ?? undefined : undefined,
        );
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

  // Advance the next poll to now, reusing the same schedule(0) debounce visibility uses. A no-op
  // while a fetch is in flight (that fetch already carries the latest radius/selection) or while
  // hidden — so callers (select/setRadiusNm) never open a parallel upstream call. See issue #41.
  function refreshNow(): void {
    if (stopped || inFlight || !visibility.isVisible()) return;
    schedule(0);
  }

  const unsubscribeVisibility = visibility.subscribe(() => {
    if (!visibility.isVisible()) clearTimer();
    else if (!inFlight) schedule(0);
  });
  activeRefreshNow = refreshNow;
  tick();

  return () => {
    stopped = true;
    clearTimer();
    unsubscribeVisibility();
    if (activeRefreshNow === refreshNow) activeRefreshNow = null;
  };
}
