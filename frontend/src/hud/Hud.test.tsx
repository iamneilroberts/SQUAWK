import { describe, it, expect } from "vitest";
import Hud from "./Hud";
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
  machNumber: 0, machOverspeed: false,
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
    const text = collectText(Hud({ snapshot: snap(), attribution: "" })).join(" ");
    expect(text).toContain("105"); // IAS
    expect(text).toContain("118"); // TAS
    expect(text).toContain("3500"); // altitude
    expect(text).toContain("270"); // heading
    expect(text).toContain("3.0"); // AoA
    expect(text).toContain("+1.0"); // g
    expect(text).toContain("60%"); // throttle
    expect(text).toContain("FLAPS 10");
    expect(text).toContain("GEAR FIXED");
    expect(text).toContain("01:05"); // airtime
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
});
