import { describe, it, expect } from "vitest";
import { HudControlRow } from "./Hud";
import type { HudSnapshot } from "./snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

function kinds(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) kinds(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props?.kind) out.push(String(props.kind));
  if (typeof type === "function") return kinds((type as (p: unknown) => unknown)(props), out);
  if (props && "children" in props) kinds(props.children, out);
  return out;
}
const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: 0, pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0, latDeg: 30, lonDeg: -88,
  aoaRad: degToRad(3), loadFactor: 1, throttle: 0.6, trim: 0, flapLabel: "0", gear: "fixed",
  stalled: false, overspeed: false, gLimited: false, terrainClearanceM: ftToM(2000),
  terrainUnverified: false, simRate: 1, airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1",
  modelNote: "M", machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  lightPhase: "day", ...o,
});

describe("HUD bottom control row (#48)", () => {
  it("shows throttle, flaps, trim and gear icon cells (trim added)", () => {
    expect(kinds(HudControlRow({ snapshot: snap() }))).toEqual(expect.arrayContaining(["throttle", "flaps", "trim", "gear"]));
  });
  it("shows the speedbrake cell only for airbrake classes", () => {
    expect(kinds(HudControlRow({ snapshot: snap({ hasSpeedbrake: true }) }))).toContain("speedbrake");
    expect(kinds(HudControlRow({ snapshot: snap({ hasSpeedbrake: false }) }))).not.toContain("speedbrake");
  });
});
