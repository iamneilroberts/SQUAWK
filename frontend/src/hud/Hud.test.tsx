import { describe, it, expect } from "vitest";
import Hud from "./Hud";
import { tapeRangesFor } from "./ImmersiveHudBar";
import type { HudSnapshot } from "./snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

/**
 * No jsdom, no testing-library (spec §8) — a React element is a plain object, so we call
 * the component and walk what it returns. This checks the HUD's CONTENT; how it looks is
 * a screenshot question, answered in the Task 12 walkthrough.
 */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  // A local function component (Readout, Row) carries the function itself on `.type` and
  // has no `children` — without invoking it, everything it renders is invisible to this
  // walk and every assertion about those values would pass vacuously.
  if (typeof type === "function") {
    return collectText((type as (p: unknown) => unknown)(props), out);
  }
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

/** Walks the element tree collecting every className, so we can assert on structure. */
function collectClasses(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const c of node) collectClasses(c, out);
    return out;
  }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props as
    | { className?: unknown; children?: unknown }
    | undefined;
  if (typeof type === "function") {
    return collectClasses((type as (p: unknown) => unknown)(props), out);
  }
  if (props) {
    if (typeof props.className === "string") out.push(props.className);
    if ("children" in props) collectClasses(props.children, out);
  }
  return out;
}

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(105), tasMs: ktToMs(118), altitudeM: ftToM(3500),
  verticalSpeedMs: 0, headingRad: degToRad(270),
  pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30.6944, lonDeg: -88.0399,
  aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, trim: 0, flapLabel: "10", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false,
  simRate: 1, airtimeS: 65, classLabel: "C172S", callsign: "SIM-A1B2C3",
  modelNote: "C172 MODEL THIS BUILD",
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  lightPhase: "day",
  ...o,
});

describe("Hud", () => {
  it("shows the SIM banner and the synthetic callsign at all times", () => {
    const text = collectText(Hud({ snapshot: snap(), attribution: "RE:EARTH TERRAIN" }));
    expect(text).toContain("SIM");
    expect(text).toContain("SIM-A1B2C3");
  });
  it("shows the aircraft class beside the callsign (spec §9 asks for class AND callsign)", () => {
    const text = collectText(Hud({ snapshot: snap({ classLabel: "C172S" }), attribution: "" }));
    expect(text).toContain("C172S");
  });
  it("discloses which flight model is actually flying", () => {
    const text = collectText(Hud({ snapshot: snap(), attribution: "" }));
    expect(text).toContain("C172 MODEL THIS BUILD");
  });
  it("shows every §9 readout", () => {
    const tokens = collectText(Hud({ snapshot: snap(), attribution: "" }));
    const text = tokens.join(" ");
    expect(text).toContain("105"); // IAS
    expect(text).toContain("118"); // TAS
    expect(text).toContain("3500"); // altitude
    expect(text).toContain("270"); // heading
    expect(text).toContain("3.0"); // AoA
    expect(text).toContain("+1.0"); // g
    expect(text).toContain("60%"); // throttle
    expect(text).toContain("FLP"); // flaps icon cell label
    expect(tokens).toContain("10"); // flap value (exact-token: "10" is a substring of "105")
    expect(text).toContain("GEAR"); // gear icon cell label (icon-only, no text value)
    expect(text).toContain("01:05"); // airtime
  });
  it("shows the current sky light phase, tracking the time-aware lighting (issue #14)", () => {
    expect(collectText(Hud({ snapshot: snap({ lightPhase: "night" }), attribution: "" })).join(" "))
      .toContain("SKY NIGHT");
    expect(collectText(Hud({ snapshot: snap({ lightPhase: "civil-twilight" }), attribution: "" })).join(" "))
      .toContain("SKY TWILIGHT");
  });
  it("shows the required attribution line", () => {
    const text = collectText(
      Hud({
        snapshot: snap(),
        attribution: "IMAGERY © ESRI · RE:EARTH TERRAIN · MAPTERHORN CC BY 4.0 · TRAFFIC: AIRPLANES.LIVE",
      }),
    ).join(" ");
    expect(text).toContain("ESRI");
    expect(text).toContain("MAPTERHORN");
  });
  it("shows warnings when they fire", () => {
    const text = collectText(Hud({ snapshot: snap({ stalled: true, overspeed: true }), attribution: "" }));
    expect(text).toContain("STALL");
    expect(text).toContain("OVERSPEED");
  });
  it("shows the SIM RATE indicator only when the sim is behind", () => {
    expect(collectText(Hud({ snapshot: snap({ simRate: 1 }), attribution: "" })).join(" "))
      .not.toContain("SIM RATE");
    expect(collectText(Hud({ snapshot: snap({ simRate: 0.6 }), attribution: "" })).join(" "))
      .toContain("SIM RATE 0.6×");
  });
  it("backs the corner readouts with a scrim so cyan reads over bright sky (issue #6)", () => {
    // The fix is a translucent near-black backing panel (NOT a drop shadow — that violates the
    // no-shadow rule). Assert the scrim class rides on the corner readout blocks.
    const classes = collectClasses(Hud({ snapshot: snap(), attribution: "" }));
    expect(classes.some((c) => c.includes("hud-scrim"))).toBe(true);
  });
  it("renders nothing at all without a snapshot", () => {
    expect(Hud({ snapshot: null, attribution: "" })).toBeNull();
  });
  it("em-dashes terrain clearance rather than inventing a number", () => {
    const text = collectText(
      Hud({ snapshot: snap({ terrainClearanceM: null, terrainUnverified: true }), attribution: "" }),
    ).join(" ");
    expect(text).toContain("—");
    expect(text).toContain("TERRAIN UNVERIFIED");
  });
  it("prints the attribution it is given, so it cannot disagree with the status bar", () => {
    const text = collectText(
      Hud({
        snapshot: snap(),
        attribution: "BASEMAP © ESRI DARK GRAY CANVAS · TERRAIN LOADING… · TRAFFIC: AIRPLANES.LIVE",
      }),
    ).join(" ");
    expect(text).toContain("DARK GRAY CANVAS");
    expect(text).not.toContain("IMAGERY © ESRI");
  });

  // ---- Mobile immersive (#13 follow-up): the scattered corner clusters are replaced by ONE
  // dense top bar. The desktop / non-immersive tree above must stay exactly as it is. ----
  describe("immersive mobile flight", () => {
    const has = (classes: string[], token: string) =>
      classes.some((c) => c.split(/\s+/).includes(token));

    it("replaces the scattered clusters with the single top bar", () => {
      const classes = collectClasses(Hud({ snapshot: snap(), attribution: "", immersive: true }));
      expect(has(classes, "imm-bar")).toBe(true); // the one bar is present
      // Broken-arm: the old scattered clusters must be GONE in immersive, not merely repositioned.
      expect(has(classes, "hud-left")).toBe(false);
      expect(has(classes, "hud-right")).toBe(false);
      expect(has(classes, "hud-heading")).toBe(false);
    });

    it("keeps those scattered clusters on desktop / non-immersive (unchanged)", () => {
      const classes = collectClasses(Hud({ snapshot: snap(), attribution: "" }));
      expect(has(classes, "hud-left")).toBe(true);
      expect(has(classes, "hud-right")).toBe(true);
      expect(has(classes, "imm-bar")).toBe(false);
    });

    it("still shows the flight data, SIM badge and attribution in the bar (UI-002: callsign lives on the spawn/debrief cards, not here)", () => {
      const text = collectText(
        Hud({ snapshot: snap(), attribution: "RE:EARTH TERRAIN", immersive: true }),
      ).join(" ");
      expect(text).toContain("3500"); // ALT
      expect(text).toContain("105"); // IAS
      expect(text).toContain("SIM");
      expect(text).not.toContain("SIM-A1B2C3");
      expect(text).toContain("RE:EARTH TERRAIN");
    });

    it("keeps the top bar visible even when the chrome is faded (essential instrumentation)", () => {
      // Broken-arm: the bar must NOT drop out of the DOM when faded — you have to read alt/speed
      // while flying. The fade is CSS on the attribution only; the bar is still rendered.
      const classes = collectClasses(
        Hud({ snapshot: snap(), attribution: "", immersive: true, faded: true }),
      );
      expect(has(classes, "imm-bar")).toBe(true);
    });
  });

  // ---- Desktop destination indicator (#47): the scattered desktop HUD had no equivalent of
  // the mobile bar's NavDirector. A top-center cue names the assigned airport and its range —
  // a fixed reference, not a turn indicator. Driven by the same immersiveNavCue the bar uses
  // (populated for instant flight and any destinationCue-assist ranked flight), so it covers
  // instant flight too. The turn direction itself now lives in the edge cue (below), matching
  // the one-turn-indicator rule #82 set for the immersive bar. ----
  describe("desktop destination cue (#47)", () => {
    const has = (classes: string[], token: string) =>
      classes.some((c) => c.split(/\s+/).includes(token));
    const navCue = { destination: "KGPT", bearingDeg: 0, distanceNm: 22.4 };

    it("names the airport and range on the desktop HUD", () => {
      const text = collectText(
        Hud({ snapshot: snap({ headingRad: degToRad(270) }), attribution: "", immersiveNavCue: navCue }),
      ).join(" ");
      expect(text).toContain("KGPT");
      expect(text).toContain("22.4"); // NM
    });

    it("does not render a relative-bearing arrow (turn direction is the edge cue's job now)", () => {
      const classes = collectClasses(
        Hud({ snapshot: snap(), attribution: "", immersiveNavCue: navCue }),
      );
      expect(has(classes, "hud-destination-arrow")).toBe(false);
      expect(has(classes, "hud-destination-nav")).toBe(false);
    });

    it("renders no destination cue when there is no assigned destination (honest, no clutter)", () => {
      const classes = collectClasses(
        Hud({ snapshot: snap(), attribution: "", immersiveNavCue: null }),
      );
      expect(has(classes, "hud-destination")).toBe(false);
    });

    it("does not duplicate the cue in the immersive bar tree (the bar carries its own NavDirector)", () => {
      const classes = collectClasses(
        Hud({ snapshot: snap(), attribution: "", immersive: true, immersiveNavCue: navCue }),
      );
      expect(has(classes, "hud-destination")).toBe(false);
    });
  });

  // ---- Desktop edge turn-direction cue (#47): the desktop twin of the mobile immersive HUD's
  // edge chevron (#82) — REUSES EdgeTurnCue/edgeTurnCue as-is, just mounted in the desktop return
  // instead of the immersive bar tree. This is now the desktop HUD's sole turn indicator. ----
  describe("desktop edge turn cue (#47)", () => {
    // Finds the first raw element node (not the text/class walkers above) whose className
    // includes `token` — needed here because the turn side lives in a `data-side` attribute,
    // which the text/class collectors above don't expose.
    function findByClassToken(node: unknown, token: string): { props?: Record<string, unknown> } | null {
      if (node === null || node === undefined || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (const c of node) {
          const found = findByClassToken(c, token);
          if (found) return found;
        }
        return null;
      }
      const type = (node as { type?: unknown }).type;
      const props = (node as { props?: unknown }).props as
        | { className?: unknown; children?: unknown }
        | undefined;
      if (typeof type === "function") {
        return findByClassToken((type as (p: unknown) => unknown)(props), token);
      }
      if (props) {
        if (
          typeof props.className === "string" &&
          props.className.split(/\s+/).includes(token)
        ) {
          return node as { props?: Record<string, unknown> };
        }
        if ("children" in props) return findByClassToken(props.children, token);
      }
      return null;
    }

    // heading 270°, destination due north (bearing 0°) → 90° to the right of the nose.
    const navCue = { destination: "KGPT", bearingDeg: 0, distanceNm: 22.4 };

    it("mounts the edge chevron on the desktop HUD with the right side and degrees", () => {
      const tree = Hud({
        snapshot: snap({ headingRad: degToRad(270) }),
        attribution: "",
        immersiveNavCue: navCue,
      });
      const cue = findByClassToken(tree, "edge-turn-cue");
      expect(cue).not.toBeNull();
      expect(cue?.props?.["data-side"]).toBe("right");
      const text = collectText(tree).join(" ");
      expect(text).toContain("90");
    });

    it("renders no edge cue when there is no assigned destination", () => {
      const tree = Hud({ snapshot: snap(), attribution: "", immersiveNavCue: null });
      expect(findByClassToken(tree, "edge-turn-cue")).toBeNull();
    });
  });

  // ---- Always-narrow rail (mobile-rich-hud task 5): a narrow phone gets the compact rail
  // even before the user taps FULL. Immersive/fullscreen still drives the auto-hide fade. ----
  describe("always-narrow rail", () => {
    const tapeRange = tapeRangesFor({
      display: { asiMinKt: 40, asiMaxKt: 180 },
      limits: { serviceCeilingM: 4100 },
    });

    it("renders the immersive bar on a narrow flight even when not immersive", () => {
      const classes = collectClasses(
        Hud({ snapshot: snap(), attribution: "x", immersive: false, narrow: true, tapeRange }),
      );
      expect(classes.some((c) => c.split(/\s+/).includes("imm-hud"))).toBe(true);
    });

    it("fades the bar on narrow flight when the session says faded (auto-hide, 2026-08-11)", () => {
      // The fade decision lives upstream (FlightSession arms auto-hide on any narrow flight);
      // Hud simply applies it — fullscreen is no longer a precondition.
      const classes = collectClasses(
        Hud({
          snapshot: snap(), attribution: "x", immersive: false, narrow: true, faded: true, tapeRange,
        }),
      );
      expect(classes.some((c) => c.split(/\s+/).includes("hud-faded"))).toBe(true);
    });

    it("keeps the desktop layout when neither immersive nor narrow", () => {
      const classes = collectClasses(
        Hud({ snapshot: snap(), attribution: "x", immersive: false, narrow: false }),
      );
      expect(classes.some((c) => c.split(/\s+/).includes("imm-hud"))).toBe(false);
    });
  });
});
