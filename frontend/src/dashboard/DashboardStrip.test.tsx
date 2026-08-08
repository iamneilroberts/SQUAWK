import { describe, it, expect } from "vitest";
import {
  PANEL_IDS, defaultStripState, togglePanel, toggleStrip, stripKeyAction, DashboardStripBody,
  stripMountedForMode,
} from "./DashboardStrip";
import { loadC172 } from "../sim/params";
import { DEFAULT_RANGE_NM } from "./radarMath";
import { DEFAULT_NAV_RANGE_NM } from "./navMath";

const P = loadC172();

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const body = (state = defaultStripState()) =>
  collectText(
    DashboardStripBody({
      state, snapshot: null, params: P, contacts: new Map(), feedStatus: "live", ghostHex: null,
      feedRadiusNm: 80, airports: [], weather: { kind: "no-position" },
      onTogglePanel: () => {}, onToggleStrip: () => {}, onRangeChange: () => {},
      onNavRangeChange: () => {},
    }),
  ).join(" ");

describe("strip state", () => {
  it("opens with the instruments showing and the help folded away", () => {
    const s = defaultStripState();
    expect(s.open).toBe(true);
    expect(s.collapsed.gauges).toBe(false);
    expect(s.collapsed.weather).toBe(false);
    expect(s.collapsed.help).toBe(true);
  });

  it("has a collapse flag for every panel it knows about", () => {
    const s = defaultStripState();
    for (const id of PANEL_IDS) expect(typeof s.collapsed[id]).toBe("boolean");
  });

  it("collapses exactly the panel named and leaves the others alone", () => {
    const s = togglePanel(defaultStripState(), "weather");
    expect(s.collapsed.weather).toBe(true);
    expect(s.collapsed.gauges).toBe(false);
    expect(s.collapsed.radar).toBe(false);
  });

  it("does not mutate the state it was given", () => {
    const before = defaultStripState();
    const snapshot = JSON.stringify(before);
    togglePanel(before, "weather");
    toggleStrip(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("toggles the whole strip without disturbing the per-panel flags", () => {
    const s = toggleStrip(togglePanel(defaultStripState(), "weather"));
    expect(s.open).toBe(false);
    expect(s.collapsed.weather).toBe(true);
  });
});

describe("strip keys", () => {
  it("maps KeyC to the whole strip and Slash to the help panel", () => {
    expect(stripKeyAction("KeyC")).toBe("strip");
    expect(stripKeyAction("Slash")).toBe("help");
  });
  it("ignores every flight-control key so the cockpit cannot eat an input", () => {
    for (const code of ["ArrowUp", "ArrowDown", "KeyW", "KeyS", "KeyF", "KeyV", "Escape"]) {
      expect(stripKeyAction(code)).toBeNull();
    }
  });
  it("lets an OS/browser shortcut through untouched when a modifier is held (Ctrl+C copy, etc.)", () => {
    expect(stripKeyAction("KeyC", { ctrlKey: true })).toBeNull();
    expect(stripKeyAction("KeyC", { metaKey: true })).toBeNull();
    expect(stripKeyAction("KeyC", { altKey: true })).toBeNull();
    expect(stripKeyAction("Slash", { ctrlKey: true })).toBeNull();
    expect(stripKeyAction("Slash", { altKey: true })).toBeNull();
  });
  it("still toggles on the bare, unmodified key", () => {
    expect(stripKeyAction("KeyC", {})).toBe("strip");
    expect(stripKeyAction("Slash", { ctrlKey: false, metaKey: false, altKey: false })).toBe("help");
  });
});

describe("DashboardStripBody", () => {
  it("titles every panel it is showing", () => {
    const text = body();
    for (const title of ["INSTRUMENTS", "WEATHER", "CONTROLS"]) {
      expect(text).toContain(title);
    }
  });

  it("keeps a collapsed panel's frame and title but drops its contents", () => {
    // Open, the weather panel shows its empty-state line (no own position yet in this test);
    // collapsed, the frame keeps only the WEATHER title and drops that body.
    expect(body()).toContain("AWAITING OWN POSITION");
    const text = body(togglePanel(defaultStripState(), "weather"));
    expect(text).toContain("WEATHER");
    expect(text).not.toContain("AWAITING OWN POSITION");
  });

  it("shows only the restore affordance when the whole strip is closed", () => {
    const text = body(toggleStrip(defaultStripState()));
    expect(text).toContain("COCKPIT");
    expect(text).not.toContain("INSTRUMENTS");
  });
});

describe("the radar panel joins the strip", () => {
  it("titles it, between the instruments and the placeholders", () => {
    const text = body();
    expect(text).toContain("RADAR");
    expect(text.indexOf("INSTRUMENTS")).toBeLessThan(text.indexOf("RADAR"));
    expect(text.indexOf("RADAR")).toBeLessThan(text.indexOf("WEATHER"));
  });

  it("collapses on its own like every other panel", () => {
    const text = body(togglePanel(defaultStripState(), "radar"));
    expect(text).toContain("RADAR");
    expect(text).not.toContain("NM");
  });

  it("starts on the 40 NM range", () => {
    expect(DEFAULT_RANGE_NM).toBe(40);
    expect(defaultStripState().scopeRangeNm).toBe(40);
  });
});

describe("the nav map joins the strip", () => {
  it("titles it, between the radar and the weather", () => {
    const text = body();
    expect(text).toContain("NAVMAP");
    expect(text.indexOf("RADAR")).toBeLessThan(text.indexOf("NAVMAP"));
    expect(text.indexOf("NAVMAP")).toBeLessThan(text.indexOf("WEATHER"));
  });

  it("has its own collapse flag and folds closed by default (a secondary panel, like the help)", () => {
    const s = defaultStripState();
    expect(typeof s.collapsed.navmap).toBe("boolean");
    expect(s.collapsed.navmap).toBe(true);
  });

  it("collapses on its own like every other panel", () => {
    const s = togglePanel(defaultStripState(), "navmap");
    expect(s.collapsed.navmap).toBe(false); // was folded, now open
    expect(s.collapsed.radar).toBe(false);
    expect(s.collapsed.weather).toBe(false);
  });

  it("starts on the 50 NM map range", () => {
    expect(DEFAULT_NAV_RANGE_NM).toBe(50);
    expect(defaultStripState().navRangeNm).toBe(50);
  });
});

describe("when the cockpit exists at all", () => {
  it("is up for the whole flight, including the pause and the end card", () => {
    expect(stripMountedForMode("FLYING")).toBe(true);
    expect(stripMountedForMode("PAUSED")).toBe(true);
    expect(stripMountedForMode("ENDED")).toBe(true);
  });

  it("is NOT up in BROWSE or COUNTDOWN — which is exactly what makes QUIT reset the cockpit", () => {
    // Collapse flags and the scope range live in useState inside DashboardStrip (CD-006), so
    // unmounting IS the reset. Pinning the mount rule pins the reset; React supplies the rest.
    expect(stripMountedForMode("BROWSE")).toBe(false);
    expect(stripMountedForMode("COUNTDOWN")).toBe(false);
  });

  it("keeps a folded panel folded across a pause, because the strip never unmounts to pause", () => {
    const folded = togglePanel(defaultStripState(), "weather");
    expect(stripMountedForMode("FLYING")).toBe(stripMountedForMode("PAUSED"));
    expect(folded.collapsed.weather).toBe(true);
  });
});
