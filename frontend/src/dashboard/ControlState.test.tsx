import { describe, it, expect } from "vitest";
import ControlState from "./ControlState";
import type { HudSnapshot } from "../hud/snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

function collect(node: unknown, out: { text: string[]; labels: string[] } = { text: [], labels: [] }) {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") { out.text.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collect(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  // Check kind on the element itself before unwrapping: ControlIconCell/ControlIcon are function
  // components, so their `kind` prop lives on this node, not on whatever they render.
  if (props?.kind) out.labels.push(String(props.kind)); // ControlIcon(Cell) kind
  if (typeof type === "function") return collect((type as (p: unknown) => unknown)(props), out);
  if (props && "children" in props) collect(props.children, out);
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

describe("ControlState (#48 graphic)", () => {
  it("renders throttle/flaps/trim/gear icon cells with their values", () => {
    const r = collect(ControlState({ snapshot: snap({ throttle: 0.6, trim: 0.25, flapLabel: "10", flapDetentIndex: 1, flapDetentCount: 5 }) }));
    expect(r.labels).toEqual(expect.arrayContaining(["throttle", "flaps", "trim", "gear"]));
    expect(r.text.join(" ")).toContain("60%");
    expect(r.text.join(" ")).toContain("10");
    expect(r.text.join(" ")).toContain("NOSE UP 25%");
  });
  it("adds a speedbrake cell only when the class has an airbrake", () => {
    expect(collect(ControlState({ snapshot: snap({ hasSpeedbrake: true }) })).labels).toContain("speedbrake");
    expect(collect(ControlState({ snapshot: snap({ hasSpeedbrake: false }) })).labels).not.toContain("speedbrake");
  });
  it("still em-dashes an unknown snapshot rather than inventing a value (honesty rule)", () => {
    expect(collect(ControlState({ snapshot: null })).text.join(" ")).toContain("—");
  });
});
