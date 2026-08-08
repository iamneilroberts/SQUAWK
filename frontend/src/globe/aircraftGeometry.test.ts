import { describe, it, expect } from "vitest";
import { buildAirframe, type Triangle } from "./aircraftGeometry";
import { MODEL_DIMS } from "./aircraftModelDims";
import type { Vec3 } from "../sim/types";

/*
 * buildAirframe is the PURE local-frame geometry generator: one dimension record -> a small
 * closed low-poly TRIANGLE mesh (the solid flat-shaded airframe). Body axes per sim/types.ts:
 * X forward (nose), Y right wing, Z down. These tests pin the mesh's SHAPE to the dimensions and
 * its winding to a real solid, so a wrong mapping (ignored span, dropped sweep, no mirror) or a
 * flipped/open surface fails loudly rather than drawing a plausible-looking wrong aeroplane — the
 * shaded solid can only look right if its normals point OUT, which follows from the winding here.
 */
const dims = MODEL_DIMS.b738;

function tris(id = "b738"): Triangle[] {
  return buildAirframe(MODEL_DIMS[id]).triangles;
}
function allPoints(id = "b738"): Vec3[] {
  return tris(id).flat();
}
const key = (p: Vec3) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;

/** Signed volume of the triangle soup (divergence theorem). Positive iff every face is wound
 *  OUTWARD; reverse all windings and this flips sign — the broken-arm for a shaded solid. */
function signedVolume(t: Triangle[]): number {
  let v = 0;
  for (const [a, b, c] of t) {
    v += a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x);
  }
  return v / 6;
}

describe("buildAirframe (solid low-poly mesh)", () => {
  it("produces a non-empty set of triangles (triples of body-frame points)", () => {
    const geo = buildAirframe(dims);
    expect(geo.triangles.length).toBeGreaterThan(20);
    for (const tri of geo.triangles) expect(tri).toHaveLength(3);
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

  it("raises a vertical fin above the fuselage (up = -Z) to finHeight", () => {
    const zs = allPoints().map((p) => p.z);
    expect(Math.min(...zs)).toBeCloseTo(-(dims.fuselageRadiusM + dims.finHeightM), 6);
  });

  it("is left/right symmetric — mirroring Y maps the point set onto itself", () => {
    const pts = allPoints();
    const set = new Set(pts.map(key));
    for (const p of pts) {
      expect(set.has(key({ x: p.x, y: -p.y, z: p.z })), `mirror of ${key(p)}`).toBe(true);
    }
  });

  it("is a CLOSED, consistently-wound surface — every directed edge is matched by its reverse", () => {
    // A watertight manifold with consistent winding: each directed edge appears exactly once and
    // its reverse (from the neighbouring triangle) appears exactly once. A hole (open surface) or
    // a locally-flipped triangle breaks this. Coincident vertices across parts are keyed by value.
    const dir = new Map<string, number>();
    for (const [a, b, c] of tris()) {
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        dir.set(`${key(p)}>${key(q)}`, (dir.get(`${key(p)}>${key(q)}`) ?? 0) + 1);
      }
    }
    for (const [k, count] of dir) {
      const [p, q] = k.split(">");
      expect(count, `directed edge ${k} used once`).toBe(1);
      expect(dir.get(`${q}>${p}`), `reverse of ${k} present`).toBe(1);
    }
  });

  it("winds every face OUTWARD — the solid has positive signed volume (a real filled shape)", () => {
    for (const id of ["c172s", "b738", "f5e"]) {
      expect(signedVolume(tris(id)), `${id} volume > 0`).toBeGreaterThan(0);
    }
  });

  it("sweeps a swept wing tip aft of its root, and leaves a straight wing unswept", () => {
    const tipLeX = (id: string) => {
      const pts = allPoints(id);
      const maxY = Math.max(...pts.map((p) => p.y));
      return Math.max(...pts.filter((p) => Math.abs(p.y - maxY) < 1e-6).map((p) => p.x));
    };
    const rootLeX = (id: string) =>
      MODEL_DIMS[id].lengthM / 2 - MODEL_DIMS[id].wingXFrac * MODEL_DIMS[id].lengthM;
    expect(tipLeX("b738")).toBeLessThan(rootLeX("b738")); // tip aft of the root leading edge
    expect(tipLeX("f5e")).toBeLessThan(rootLeX("f5e")); // the fighter is swept too
    expect(tipLeX("c172s")).toBeCloseTo(rootLeX("c172s"), 6); // straight wing: tip LE aligns
  });

  it("scales with the dimensions — the airliner's bounding box dwarfs the GA single's", () => {
    const span = (id: string) => {
      const ys = allPoints(id).map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(span("b738")).toBeGreaterThan(span("c172s"));
  });
});
