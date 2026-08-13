import { describe, it, expect } from "vitest";
import { ImmersiveControlRow } from "./ImmersiveHudBar";
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
  aoaRad: degToRad(3), loadFactor: 1, throttle: 0.6, trim: 0, flapLabel: "0", gear: "retractable",
  stalled: false, overspeed: false, gLimited: false, terrainClearanceM: ftToM(2000),
  terrainUnverified: false, simRate: 1, airtimeS: 0, classLabel: "F5E", callsign: "SIM-A1",
  modelNote: "M", machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  lightPhase: "day", ...o,
});

describe("mobile immersive control row (#48)", () => {
  it("now includes gear and trim (were missing on mobile)", () => {
    const k = kinds(ImmersiveControlRow({ snapshot: snap() }));
    expect(k).toEqual(expect.arrayContaining(["throttle", "flaps", "trim", "gear"]));
  });
  it("gates the speedbrake cell on hasSpeedbrake", () => {
    expect(kinds(ImmersiveControlRow({ snapshot: snap({ hasSpeedbrake: true }) }))).toContain("speedbrake");
    expect(kinds(ImmersiveControlRow({ snapshot: snap({ hasSpeedbrake: false }) }))).not.toContain("speedbrake");
  });
  it("returns ONE wrapping container, not a fragment that hoists into the rail grid (#48)", () => {
    const el = ImmersiveControlRow({ snapshot: snap() }) as { type?: unknown; props?: { className?: string } };
    expect(el.type).toBe("div");
    expect(el.props?.className).toBe("imm-control-cells");
  });
});
