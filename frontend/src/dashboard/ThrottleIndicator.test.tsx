import { describe, it, expect } from "vitest";
import ThrottleIndicator from "./ThrottleIndicator";
import { THROTTLE_AMBER_ABOVE } from "../hud/controls/ControlStateCells";
import type { HudSnapshot } from "../hud/snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

/*
 * No jsdom (spec §8), matching the other dashboard/*.test.tsx suites: call the component and
 * walk the plain-object element tree.
 */
function collectStyleHeight(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectStyleHeight(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return collectStyleHeight((type as (p: unknown) => unknown)(props), out);
  const style = props?.style as { height?: string } | undefined;
  if (style?.height) out.push(style.height);
  if (props && "children" in props) collectStyleHeight(props.children, out);
  return out;
}

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

function classesOf(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) classesOf(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return classesOf((type as (p: unknown) => unknown)(props), out);
  if (typeof props?.className === "string") out.push(props.className);
  if (props && "children" in props) classesOf(props.children, out);
  return out;
}

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: degToRad(0), pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30, lonDeg: -88, aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, trim: 0, flapLabel: "0", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false, simRate: 1,
  airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1B2C3", modelNote: "M",
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false, lightPhase: "day",
  ...o,
});

describe("ThrottleIndicator (hud chrome rework)", () => {
  it("fills from the bottom in proportion to throttle", () => {
    const el = ThrottleIndicator({ snapshot: snap({ throttle: 0.82 }), hasAfterburner: false });
    expect(collectStyleHeight(el)).toContain("82%");
  });

  it("prints the same THR % string the control-state cell uses", () => {
    const text = collectText(ThrottleIndicator({ snapshot: snap({ throttle: 0.6 }), hasAfterburner: false })).join(" ");
    expect(text).toContain("60%");
  });

  it("em-dashes and shows an empty bar rather than inventing a reading without a snapshot", () => {
    const el = ThrottleIndicator({ snapshot: null, hasAfterburner: false });
    expect(collectText(el).join(" ")).toContain("—");
    expect(collectStyleHeight(el)).toContain("0%");
  });

  it("marks a WET/afterburner zone only for afterburner-capable classes", () => {
    const withAb = classesOf(ThrottleIndicator({ snapshot: snap(), hasAfterburner: true }));
    const withoutAb = classesOf(ThrottleIndicator({ snapshot: snap(), hasAfterburner: false }));
    expect(withAb).toContain("dash-throttle-wet-zone");
    expect(withoutAb).not.toContain("dash-throttle-wet-zone");
  });

  it("goes amber only above the shared near-max threshold, same boundary as the control-state cell", () => {
    const hot = classesOf(ThrottleIndicator({ snapshot: snap({ throttle: THROTTLE_AMBER_ABOVE + 0.01 }), hasAfterburner: false }));
    const nominal = classesOf(ThrottleIndicator({ snapshot: snap({ throttle: THROTTLE_AMBER_ABOVE }), hasAfterburner: false }));
    expect(hot.some((c) => c.includes("dash-throttle-fill-amber"))).toBe(true);
    expect(nominal.some((c) => c.includes("dash-throttle-fill-amber"))).toBe(false);
  });
});
