/*
 * The desktop cockpit dashboard (unified-glass redesign). It replaces the old five-panel strip
 * (INSTRUMENTS / RADAR / NAVMAP / WEATHER / CONTROLS) with ONE glass panel — see UnifiedGlass.tsx
 * for the layout. This module keeps only the strip LIFECYCLE: the mount rule, the KeyC open/hide
 * and Slash help toggles, and the small pieces of furniture state (nav-map range, whether the
 * weather / controls aux folds are open).
 *
 * DESKTOP-ONLY: this component is gated in FlightSession by `!immersiveActive && !narrow`, so it
 * never renders on a phone — the mobile immersive path (top status bar + touch controls) is
 * untouched. `defaultStripState(narrow)` still starts folded on a narrow viewport purely for the
 * back-compat of that flag; on desktop `narrow` is always false.
 *
 * Collapse/fold state is LOCAL React state on purpose (decisions.md CD-006): nothing outside this
 * subtree reads it, it changes at human cadence, and unmounting on QUIT is the reset.
 *
 * Split in two so the rendering half is testable without a renderer: `DashboardStrip` owns the
 * hooks, `UnifiedGlassBody` (UnifiedGlass.tsx) owns every element.
 */
import { useEffect, useState } from "react";
import { loadAirports } from "../data/airports";
import type { HudSnapshot } from "../hud/snapshot";
import type { Mode } from "../game/machine";
import { loadC172 } from "../sim/params";
import { useStore } from "../state/store";
import { useViewport } from "../layout/useViewport";
import { isNarrowViewport } from "../layout/viewport";
import { DEFAULT_NAV_RANGE_NM } from "./navMath";
import { useWeather } from "./WeatherPanel";
import { useNavWeather } from "./NavWeatherLayer";
import { UnifiedGlassBody } from "./UnifiedGlass";

export type StripState = {
  open: boolean;
  navRangeNm: number;
  showWeather: boolean;
  showHelp: boolean;
};

/**
 * Which modes have a cockpit. FLYING, PAUSED and ENDED do; BROWSE and COUNTDOWN do not. This is
 * also the reset rule (CD-006): the state below lives in useState inside DashboardStrip, so
 * leaving the mounted set discards it, and QUIT gives the next flight a fresh cockpit.
 */
export function stripMountedForMode(mode: Mode): boolean {
  return mode === "FLYING" || mode === "PAUSED" || mode === "ENDED";
}

/**
 * The glass opens with weather closed and the controls quick reference visible on desktop. On a
 * narrow viewport it starts folded shut (`open: false`) with help closed — but the dashboard is
 * desktop-gated in FlightSession, so on the phone it never mounts at all; the flag is kept only
 * for back-compat.
 */
export function defaultStripState(narrow = false): StripState {
  return {
    open: !narrow,
    navRangeNm: DEFAULT_NAV_RANGE_NM,
    showWeather: false,
    showHelp: !narrow,
  };
}

export function setNavRange(s: StripState, nm: number): StripState {
  return { ...s, navRangeNm: nm };
}

export function toggleWeather(s: StripState): StripState {
  return { ...s, showWeather: !s.showWeather };
}

export function toggleHelp(s: StripState): StripState {
  return { ...s, showHelp: !s.showHelp };
}

export function toggleStrip(s: StripState): StripState {
  return { ...s, open: !s.open };
}

/**
 * The only two keys this strip claims. Everything else belongs to the aeroplane. Ctrl/Cmd/Alt+
 * <code> is an OS/browser shortcut sharing a `code` with ours — mirror input/keyboard.ts's guard
 * so this listener never hijacks a page shortcut just because the physical key matches.
 */
export function stripKeyAction(
  code: string,
  modifiers?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
): "strip" | "help" | null {
  if (modifiers?.ctrlKey || modifiers?.metaKey || modifiers?.altKey) return null;
  if (code === "KeyC") return "strip";
  if (code === "Slash") return "help";
  return null;
}

export default function DashboardStrip({ snapshot }: { snapshot: HudSnapshot | null }) {
  // Narrow at mount → the glass starts folded (back-compat only; desktop-gated upstream). Read
  // once for the initial state; we don't re-fold on later resize, which would fight the user.
  const narrow = isNarrowViewport(useViewport().width);
  const [state, setState] = useState<StripState>(() => defaultStripState(narrow));
  const contacts = useStore((s) => s.contacts);
  const feedStatus = useStore((s) => s.feedStatus);
  const origin = useStore((s) => s.origin);
  const lockedMission = useStore((s) => s.lockedMission);
  const radiusNm = useStore((s) => s.radiusNm);
  // The primary instruments read the flown class's params (per-class face). Falls back to the
  // C172 before an origin is set — the strip can mount a frame before a takeover exists.
  const params = lockedMission?.aircraftProfile ?? loadC172();
  const weather = useWeather(snapshot);
  // The WX toggle drives both the METAR fold and the precip-radar overlay; fetch only when on.
  const navWeather = useNavWeather(snapshot, state.showWeather);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = stripKeyAction(e.code, e);
      if (action === null) return;
      setState((s) => (action === "strip" ? toggleStrip(s) : toggleHelp(s)));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!state.open) {
    return (
      <div className="dash-strip dash-strip-closed">
        <button type="button" className="status-chip-button" onClick={() => setState(toggleStrip)}>
          COCKPIT [C]
        </button>
      </div>
    );
  }

  return (
    <UnifiedGlassBody
      snapshot={snapshot}
      params={params}
      contacts={contacts}
      feedStatus={feedStatus}
      ghostHex={origin?.hex ?? null}
      feedRadiusNm={radiusNm}
      airports={loadAirports()}
      navRangeNm={state.navRangeNm}
      weather={weather}
      navWeather={navWeather}
      showWeather={state.showWeather}
      showHelp={state.showHelp}
      onNavRangeChange={(nm) => setState((s) => setNavRange(s, nm))}
      onToggleWeather={() => setState(toggleWeather)}
      onToggleHelp={() => setState(toggleHelp)}
      onToggleStrip={() => setState(toggleStrip)}
    />
  );
}
