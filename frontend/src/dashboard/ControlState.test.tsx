import { describe, it, expect } from "vitest";
import ControlState from "./ControlState";
import type { HudSnapshot } from "../hud/snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

/** No jsdom (spec §8): a React element is a plain object, so walk what the component returns. */
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

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: 0, pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30.0, lonDeg: -88.0, aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, trim: 0, flapLabel: "0", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false, simRate: 1,
  airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1B2C3", modelNote: "C172 MODEL THIS BUILD",
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  ...o,
});

describe("ControlState", () => {
  it("shows throttle %, flaps, trim and gear (issue #7)", () => {
    const text = collectText(
      ControlState({ snapshot: snap({ throttle: 0.6, trim: 0.25, flapLabel: "10", gear: "fixed" }) }),
    ).join(" ");
    expect(text).toContain("THR 60%");
    expect(text).toContain("FLAPS 10");
    expect(text).toContain("TRIM NOSE UP 25%");
    expect(text).toContain("GEAR FIXED");
  });
  it("shows GEAR DOWN for a retractable class with gear extended", () => {
    const text = collectText(
      ControlState({ snapshot: snap({ gear: "retractable", gearPosition: 1, trim: -0.4 }) }),
    ).join(" ");
    expect(text).toContain("GEAR DOWN");
    expect(text).toContain("TRIM NOSE DN 40%");
  });
  it("shows GEAR UP for a retractable class with gear retracted (the acceptance-flight bug fix)", () => {
    const text = collectText(
      ControlState({ snapshot: snap({ gear: "retractable", gearPosition: 0 }) }),
    ).join(" ");
    expect(text).toContain("GEAR UP");
  });
  it("em-dashes what it does not know rather than inventing a zero (honesty rule)", () => {
    const text = collectText(ControlState({ snapshot: null })).join(" ");
    expect(text).toContain("—");
    expect(text).not.toContain("0%");
  });
});
