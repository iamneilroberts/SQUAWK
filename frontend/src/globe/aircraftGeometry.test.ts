import { describe, it, expect } from "vitest";
import { buildAirframe } from "./aircraftGeometry";
import { MODEL_DIMS } from "./aircraftModelDims";
import type { Vec3 } from "../sim/types";

/*
 * buildAirframe is the PURE local-frame geometry generator: dimensions -> a set of body-frame
 * line segments (the LORAN wireframe). Body axes per sim/types.ts: X forward (nose), Y right
 * wing, Z down. These tests pin the airframe's SHAPE to the dimensions so a wrong mapping
 * (ignored span, dropped sweep, no mirror) fails loudly rather than drawing a plausible-looking
 * wrong aeroplane the unit tests can't see.
 */
const dims = MODEL_DIMS.b738;

function allPoints(): Vec3[] {
  return buildAirframe(dims).segments.flat();
}

describe("buildAirframe", () => {
  it("produces a non-empty set of line segments (pairs of body-frame points)", () => {
    const geo = buildAirframe(dims);
    expect(geo.segments.length).toBeGreaterThan(5);
    for (const seg of geo.segments) expect(seg).toHaveLength(2);
  });

  it("puts the nose at +length/2 forward and the tail at -length/2 (fuselage spans the length)", () => {
    const xs = allPoints().map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(dims.lengthM / 2, 6);
    expect(Math.min(...xs)).toBeCloseTo(-dims.lengthM / 2, 6);
  });

  it("spreads the wings the full span — the widest points are at ±wingSpanM/2", () => {
    const ys = allPoints().map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(dims.wingSpanM / 2, 6);
    expect(Math.min(...ys)).toBeCloseTo(-dims.wingSpanM / 2, 6);
  });

  it("is left/right symmetric — mirroring Y maps the point set onto itself", () => {
    const pts = allPoints();
    const key = (p: Vec3) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
    const set = new Set(pts.map(key));
    for (const p of pts) {
      expect(set.has(key({ x: p.x, y: -p.y, z: p.z })), `mirror of ${key(p)}`).toBe(true);
    }
  });

  it("raises a vertical fin above the fuselage (up = -Z) to finHeight", () => {
    const zs = allPoints().map((p) => p.z);
    // Highest point is the fin tip: fuselage top (-fuselageRadius) minus the fin height.
    expect(Math.min(...zs)).toBeCloseTo(-(dims.fuselageRadiusM + dims.finHeightM), 6);
  });

  it("sweeps a swept wing tip aft of its root, and leaves a straight wing unswept", () => {
    const tipX = (d: typeof dims) => {
      const pts = buildAirframe(d).segments.flat();
      const maxY = Math.max(...pts.map((p) => p.y));
      // Leading-edge x at the tip is the largest x among points at the tip station.
      return Math.max(...pts.filter((p) => Math.abs(p.y - maxY) < 1e-6).map((p) => p.x));
    };
    const swept = tipX(MODEL_DIMS.b738);
    const rootLeX = MODEL_DIMS.b738.lengthM / 2 - MODEL_DIMS.b738.wingXFrac * MODEL_DIMS.b738.lengthM;
    expect(swept).toBeLessThan(rootLeX); // tip is aft of the root leading edge
    const straightTipX = tipX(MODEL_DIMS.c172s);
    const straightRootLeX =
      MODEL_DIMS.c172s.lengthM / 2 - MODEL_DIMS.c172s.wingXFrac * MODEL_DIMS.c172s.lengthM;
    expect(straightTipX).toBeCloseTo(straightRootLeX, 6); // no sweep, tip LE aligns with root LE
  });

  it("scales with the dimensions — the airliner's bounding box dwarfs the GA single's", () => {
    const span = (id: string) => {
      const ys = buildAirframe(MODEL_DIMS[id]).segments.flat().map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(span("b738")).toBeGreaterThan(span("c172s"));
  });
});
