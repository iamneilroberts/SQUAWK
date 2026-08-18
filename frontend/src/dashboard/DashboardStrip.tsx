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
import { formatAltFt, formatHeadingDeg, formatIasKt, formatVsiFpm } from "../hud/format";
import { DEFAULT_NAV_RANGE_NM } from "./navMath";
import { useWeather } from "./WeatherPanel";
import { useNavWeather } from "./NavWeatherLayer";
import { UnifiedGlassBody } from "./UnifiedGlass";
import { nextNavMode, type NavMode } from "./navModes";

export type StripState = {
  open: boolean;
  navRangeNm: number;
  showWeather: boolean;
  showHelp: boolean;
  tacticalMode: NavMode;
  showContacts: boolean;
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
 * The glass opens with weather and the controls quick reference both closed — the keymap list is
 * on-demand (Slash / the CONTROLS toggle chip), not something that should cover the instruments
 * every flight. On a narrow viewport it also starts folded shut (`open: false`) — but the
 * dashboard is desktop-gated in FlightSession, so on the phone it never mounts at all; the flag is
 * kept only for back-compat.
 */
export function defaultStripState(narrow = false): StripState {
  return {
    open: !narrow,
    navRangeNm: DEFAULT_NAV_RANGE_NM,
    showWeather: false,
    showHelp: false,
    tacticalMode: "normal",
    showContacts: true,
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

/** Tactical-map mode chip: cycle normal -> large -> hidden -> normal (#67 rework). */
export function cycleTactical(s: StripState): StripState {
  return { ...s, tacticalMode: nextNavMode(s.tacticalMode) };
}

/** Tactical-map show/hide (desktop control-strip TAC button, #3): flips between hidden and the
 *  normal small map only — never the sim-freezing LARGE mode, which stays the chip's job. */
export function toggleTactical(s: StripState): StripState {
  return { ...s, tacticalMode: s.tacticalMode === "hidden" ? "normal" : "hidden" };
}

/** Tactical-map CONTACTS chip: hide/show the traffic blips to declutter the line map. */
export function toggleContacts(s: StripState): StripState {
  return { ...s, showContacts: !s.showContacts };
}

/**
 * The only two keys this strip claims. Everything else belongs to the aeroplane. Ctrl/Cmd/Alt+
 * <code> is an OS/browser shortcut sharing a `code` with ours — mirror input/keyboard.ts's guard
 * so this listener never hijacks a page shortcut just because the physical key matches.
 */
export function stripKeyAction(
  code: string,
  modifiers?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
): "strip" | "help" | "tactical" | null {
  if (modifiers?.ctrlKey || modifiers?.metaKey || modifiers?.altKey) return null;
  if (code === "KeyC") return "strip";
  if (code === "Slash") return "help";
  if (code === "KeyT") return "tactical";
  return null;
}

export default function DashboardStrip({
  snapshot,
  onMapExpanded,
}: {
  snapshot: HudSnapshot | null;
  /** Called when the tactical map enters/leaves LARGE — FlightSession freezes the physics loop
   *  while the big location map is up (owner: a pull-up tool, sim pauses behind it). */
  onMapExpanded?: (expanded: boolean) => void;
}) {
  // Narrow at mount → the glass starts folded (back-compat only; desktop-gated upstream). Read
  // once for the initial state; we don't re-fold on later resize, which would fight the user.
  const narrow = isNarrowViewport(useViewport().width);
  const [state, setState] = useState<StripState>(() => defaultStripState(narrow));
  const contacts = useStore((s) => s.contacts);
  const feedStatus = useStore((s) => s.feedStatus);
  const origin = useStore((s) => s.origin);
  const lockedMission = useStore((s) => s.lockedMission);
  const radiusNm = useStore((s) => s.radiusNm);
  const labelsOn = useStore((s) => s.labelsOn);
  // The primary instruments read the flown class's params (per-class face). Falls back to the
  // C172 before an origin is set — the strip can mount a frame before a takeover exists.
  const params = lockedMission?.aircraftProfile ?? loadC172();
  const weather = useWeather(snapshot);
  // The WX toggle drives both the METAR fold and the precip-radar overlay; fetch only when on.
  const navWeather = useNavWeather(snapshot, state.showWeather);

  // Freeze the sim while the big location map is up; resume (or on unmount) when it closes.
  const mapExpanded = state.tacticalMode === "large";
  useEffect(() => {
    onMapExpanded?.(mapExpanded);
    return () => {
      if (mapExpanded) onMapExpanded?.(false);
    };
  }, [mapExpanded, onMapExpanded]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = stripKeyAction(e.code, e);
      if (action === null) return;
      setState((s) =>
        action === "strip" ? toggleStrip(s) : action === "help" ? toggleHelp(s) : toggleTactical(s),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // #78: collapsed to a compact "mini-dash" rather than just a bare expand button — IAS/ALT/HDG/
  // VSI stay glanceable while the pilot wants more of the outside view, same idea as the mobile
  // immersive bar (#13) keeping the essentials up even at its most stripped-down.
  if (!state.open) {
    return (
      <div className="dash-strip dash-strip-closed">
        <div className="dash-mini glass panel">
          <span className="dash-mini-item">{`IAS ${formatIasKt(snapshot?.iasMs ?? null)}`}</span>
          <span className="dash-mini-item">{`ALT ${formatAltFt(snapshot?.altitudeM ?? null)}`}</span>
          <span className="dash-mini-item">{`HDG ${formatHeadingDeg(snapshot?.headingRad ?? null)}`}</span>
          <span className="dash-mini-item">{`VSI ${formatVsiFpm(snapshot?.verticalSpeedMs ?? null)}`}</span>
          <button type="button" className="status-chip-button" onClick={() => setState(toggleStrip)}>
            COCKPIT [C]
          </button>
        </div>
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
      tacticalMode={state.tacticalMode}
      labelsOn={labelsOn}
      showContacts={state.showContacts}
      onCycleTactical={() => setState(cycleTactical)}
      onToggleContacts={() => setState(toggleContacts)}
      onNavRangeChange={(nm) => setState((s) => setNavRange(s, nm))}
      onToggleWeather={() => setState(toggleWeather)}
      onToggleHelp={() => setState(toggleHelp)}
      onToggleStrip={() => setState(toggleStrip)}
    />
  );
}
