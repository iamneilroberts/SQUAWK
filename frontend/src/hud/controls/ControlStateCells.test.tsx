import { describe, it, expect } from "vitest";
import ControlStateCells, { THROTTLE_AMBER_ABOVE } from "./ControlStateCells";
import type { HudSnapshot } from "../snapshot";
import { ktToMs, ftToM, degToRad } from "../../sim/units";

/*
 * Locks the value-tone thresholds for the SINGLE shared control-state row (#48). Both the glass
 * strip (ControlState) and the HUD bottom (HudControlRow) render ControlStateCells, so a drift in
 * these boundaries fails here rather than silently diverging one surface from the other.
 */

// Walk the returned element tree, pairing each cell's `kind` with the `tone-*` class of its value span.
function tones(node: unknown, out: Record<string, string> = {}, kind: string | null = null): Record<string, string> {
  if (node == null || typeof node === "boolean" || typeof node === "number" || typeof node === "string") return out;
  if (Array.isArray(node)) { for (const c of node) tones(c, out, kind); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  const nextKind = props?.kind ? String(props.kind) : kind;
  const cls = typeof props?.className === "string" ? props.className : "";
  const m = cls.match(/tone-(cyan|amber|dim)/);
  if (m && nextKind) out[nextKind] = m[1];
  if (typeof type === "function") return tones((type as (p: unknown) => unknown)(props), out, nextKind);
  if (props && "children" in props) tones(props.children, out, nextKind);
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

describe("ControlStateCells value-tone thresholds (#48)", () => {
  it("throttle is amber only above the near-max threshold", () => {
    expect(tones(ControlStateCells({ snapshot: snap({ throttle: THROTTLE_AMBER_ABOVE + 0.01 }) })).throttle).toBe("amber");
    expect(tones(ControlStateCells({ snapshot: snap({ throttle: THROTTLE_AMBER_ABOVE }) })).throttle).toBe("cyan");
    expect(tones(ControlStateCells({ snapshot: snap({ throttle: 0.5 }) })).throttle).toBe("cyan");
  });
  it("trim is dim when neutral, cyan when trimmed", () => {
    expect(tones(ControlStateCells({ snapshot: snap({ trim: 0 }) })).trim).toBe("dim");
    expect(tones(ControlStateCells({ snapshot: snap({ trim: 0.25 }) })).trim).toBe("cyan");
  });
  it("speedbrake OUT is amber and only present when the class has an airbrake", () => {
    expect(tones(ControlStateCells({ snapshot: snap({ hasSpeedbrake: true, speedbrake: true }) })).speedbrake).toBe("amber");
    expect(tones(ControlStateCells({ snapshot: snap({ hasSpeedbrake: false }) })).speedbrake).toBeUndefined();
  });
});
