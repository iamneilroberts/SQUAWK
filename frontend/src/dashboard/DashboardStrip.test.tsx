import { describe, it, expect } from "vitest";
import {
  PANEL_IDS, defaultStripState, togglePanel, toggleStrip, stripKeyAction, DashboardStripBody,
  stripMountedForMode,
} from "./DashboardStrip";
import { loadC172 } from "../sim/params";
import { DEFAULT_RANGE_NM } from "./radarMath";

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
      onTogglePanel: () => {}, onToggleStrip: () => {}, onRangeChange: () => {},
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
    expect(s.collapsed.atc).toBe(false);
  });

  it("does not mutate the state it was given", () => {
    const before = defaultStripState();
    const snapshot = JSON.stringify(before);
    togglePanel(before, "weather");
    toggleStrip(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("toggles the whole strip without disturbing the per-panel flags", () => {
    const s = toggleStrip(togglePanel(defaultStripState(), "atc"));
    expect(s.open).toBe(false);
    expect(s.collapsed.atc).toBe(true);
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
    for (const title of ["INSTRUMENTS", "WEATHER", "ATC", "CONTROLS"]) {
      expect(text).toContain(title);
    }
  });

  it("keeps a collapsed panel's frame and title but drops its contents", () => {
    const text = body(togglePanel(defaultStripState(), "weather"));
    expect(text).toContain("WEATHER");
    // Assert on the WEATHER panel's own line: NO_FEED is shared with AtcPanel, which is still
    // open, so asserting on that string would pass or fail for the wrong reason.
    expect(text).not.toContain("WEATHER RADAR MOSAIC");
    expect(text).toContain("NO FEED · FUTURE INTEGRATION"); // still there — from the ATC panel
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
