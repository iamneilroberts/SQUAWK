import { describe, it, expect } from "vitest";
import {
  defaultStripState, setNavRange, toggleWeather, toggleHelp, toggleStrip, toggleTactical,
  stripKeyAction, stripMountedForMode,
} from "./DashboardStrip";
import { DEFAULT_NAV_RANGE_NM } from "./navMath";

// The DashboardStrip module now owns only the strip LIFECYCLE (state + keys + mount rule); the
// element tree moved to UnifiedGlass.tsx (see UnifiedGlass.test.tsx). These tests were reworked
// for the unified-glass redesign — the old five-panel PANEL_IDS/collapse/scopeRange API is gone.

describe("strip state", () => {
  it("opens on desktop with weather and the controls quick reference both collapsed", () => {
    const s = defaultStripState();
    expect(s.open).toBe(true);
    expect(s.showWeather).toBe(false);
    expect(s.showHelp).toBe(false);
    expect(s.navRangeNm).toBe(DEFAULT_NAV_RANGE_NM);
  });

  it("starts FOLDED on a narrow viewport (back-compat flag; desktop is unchanged)", () => {
    expect(defaultStripState(false).open).toBe(true);
    expect(defaultStripState(true).open).toBe(false);
  });

  it("toggles the weather fold without disturbing the others", () => {
    const s = toggleWeather(defaultStripState());
    expect(s.showWeather).toBe(true);
    expect(s.showHelp).toBe(false);
    expect(s.open).toBe(true);
  });

  it("toggles the controls-help fold on its own", () => {
    const s = toggleHelp(defaultStripState());
    expect(s.showHelp).toBe(true);
    expect(s.showWeather).toBe(false);
  });

  it("sets the tactical map range", () => {
    expect(setNavRange(defaultStripState(), 100).navRangeNm).toBe(100);
  });

  it("TAC toggles the tactical map hidden<->normal, never the sim-freezing LARGE (#3)", () => {
    const hidden = toggleTactical(defaultStripState()); // normal -> hidden
    expect(hidden.tacticalMode).toBe("hidden");
    const shown = toggleTactical(hidden); // hidden -> normal
    expect(shown.tacticalMode).toBe("normal");
    // From LARGE it collapses to hidden, never leaving the map in the frozen big mode.
    expect(toggleTactical({ ...defaultStripState(), tacticalMode: "large" }).tacticalMode).toBe("hidden");
  });

  it("toggles the whole strip without disturbing the folds", () => {
    const s = toggleStrip(toggleWeather(defaultStripState()));
    expect(s.open).toBe(false);
    expect(s.showWeather).toBe(true);
  });

  it("does not mutate the state it was given", () => {
    const before = defaultStripState();
    const snap = JSON.stringify(before);
    toggleWeather(before);
    toggleHelp(before);
    setNavRange(before, 200);
    toggleStrip(before);
    expect(JSON.stringify(before)).toBe(snap);
  });
});

describe("strip keys", () => {
  it("maps KeyC to the whole strip, Slash to the controls-help fold, KeyT to the tactical map", () => {
    expect(stripKeyAction("KeyC")).toBe("strip");
    expect(stripKeyAction("Slash")).toBe("help");
    expect(stripKeyAction("KeyT")).toBe("tactical");
  });
  it("ignores every flight-control key so the cockpit cannot eat an input", () => {
    for (const code of ["ArrowUp", "ArrowDown", "KeyW", "KeyS", "KeyF", "KeyV", "Escape"]) {
      expect(stripKeyAction(code)).toBeNull();
    }
  });
  it("lets an OS/browser shortcut through untouched when a modifier is held", () => {
    expect(stripKeyAction("KeyC", { ctrlKey: true })).toBeNull();
    expect(stripKeyAction("KeyC", { metaKey: true })).toBeNull();
    expect(stripKeyAction("Slash", { altKey: true })).toBeNull();
  });
  it("still toggles on the bare, unmodified key", () => {
    expect(stripKeyAction("KeyC", {})).toBe("strip");
    expect(stripKeyAction("Slash", { ctrlKey: false, metaKey: false, altKey: false })).toBe("help");
  });
});

describe("when the cockpit exists at all", () => {
  it("is up for the whole flight, including the pause and the end card", () => {
    expect(stripMountedForMode("FLYING")).toBe(true);
    expect(stripMountedForMode("PAUSED")).toBe(true);
    expect(stripMountedForMode("ENDED")).toBe(true);
  });
  it("is NOT up in BROWSE or COUNTDOWN — which is what makes QUIT reset the cockpit", () => {
    expect(stripMountedForMode("BROWSE")).toBe(false);
    expect(stripMountedForMode("COUNTDOWN")).toBe(false);
  });
});
