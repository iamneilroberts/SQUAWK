import { describe, it, expect } from "vitest";
import ControlIcon from "./ControlIcon";
import type { HudSnapshot } from "../snapshot";
import { ktToMs, ftToM, degToRad } from "../../sim/units";

/** No jsdom: React elements are plain objects — collect every className in the returned tree. */
function collectClasses(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectClasses(c, out); return out; }
  const props = (node as { props?: { className?: unknown; children?: unknown } }).props;
  if (props && typeof props.className === "string") out.push(props.className);
  if (props && "children" in props) collectClasses(props.children, out);
  return out;
}

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: 0, pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30, lonDeg: -88, aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, trim: 0, flapLabel: "0", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false, simRate: 1,
  airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1B2C3", modelNote: "M",
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false, lightPhase: "day",
  ...o,
});

describe("ControlIcon", () => {
  it("draws every kind without throwing and returns an svg", () => {
    for (const kind of ["throttle", "flaps", "trim", "gear", "speedbrake"] as const) {
      const el = ControlIcon({ kind, snapshot: snap() });
      expect((el as { type?: unknown }).type).toBe("svg");
    }
  });
  it("throttle goes amber near full power", () => {
    expect(collectClasses(ControlIcon({ kind: "throttle", snapshot: snap({ throttle: 0.5 }) })).some(c => c.includes("ci-am"))).toBe(false);
    expect(collectClasses(ControlIcon({ kind: "throttle", snapshot: snap({ throttle: 0.98 }) })).some(c => c.includes("ci-am"))).toBe(true);
  });
  it("trim needle is amber off the detent, cyan on it", () => {
    expect(collectClasses(ControlIcon({ kind: "trim", snapshot: snap({ trim: 0 }) })).some(c => c.includes("ci-am"))).toBe(false);
    expect(collectClasses(ControlIcon({ kind: "trim", snapshot: snap({ trim: 0.2 }) })).some(c => c.includes("ci-am"))).toBe(true);
  });
  it("gear goes amber in transit", () => {
    expect(collectClasses(ControlIcon({ kind: "gear", snapshot: snap({ gear: "retractable", gearPosition: 0.5 }) })).some(c => c.includes("ci-am"))).toBe(true);
  });
  it("speedbrake boards are amber when out", () => {
    expect(collectClasses(ControlIcon({ kind: "speedbrake", snapshot: snap({ speedbrake: true }) })).some(c => c.includes("ci-am"))).toBe(true);
  });
});
