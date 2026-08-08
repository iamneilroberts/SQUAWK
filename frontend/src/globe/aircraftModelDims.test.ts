import { describe, it, expect } from "vitest";
import { MODEL_DIMS, modelDimsForClass } from "./aircraftModelDims";

/*
 * The per-class model dimensions are DATA, keyed by the same class id the flight params use
 * (c172s / b738 / f5e — see resolveClass + loadClassById). These tests pin the data-not-branches
 * shape and the class ORDERING that makes the three silhouettes tell apart on screen: an airliner
 * is the biggest, the GA single the smallest, the fighter short-but-stubby with the sharpest sweep.
 */
describe("modelDimsForClass", () => {
  it("resolves every flight-model class id the resolver can produce", () => {
    for (const id of ["c172s", "b738", "f5e"]) {
      expect(modelDimsForClass(id)).toBe(MODEL_DIMS[id]);
    }
  });

  it("is a pure lookup, not a branch — the map holds exactly the three classes", () => {
    expect(Object.keys(MODEL_DIMS).sort()).toEqual(["b738", "c172s", "f5e"]);
  });

  it("throws on an unknown id rather than silently substituting (a bug, not data)", () => {
    expect(() => modelDimsForClass("a380")).toThrow(/unknown class id/);
  });

  it("every dimension is a finite positive number, sweep is non-negative", () => {
    for (const dims of Object.values(MODEL_DIMS)) {
      for (const [k, v] of Object.entries(dims)) {
        expect(Number.isFinite(v), `${k} finite`).toBe(true);
        if (k === "wingSweepRad" || k === "wingXFrac") expect(v).toBeGreaterThanOrEqual(0);
        else expect(v, `${k} positive`).toBeGreaterThan(0);
      }
    }
  });

  it("orders the silhouettes so the classes read apart: airliner largest, GA smallest", () => {
    expect(MODEL_DIMS.b738.lengthM).toBeGreaterThan(MODEL_DIMS.f5e.lengthM);
    expect(MODEL_DIMS.f5e.lengthM).toBeGreaterThan(MODEL_DIMS.c172s.lengthM);
    expect(MODEL_DIMS.b738.wingSpanM).toBeGreaterThan(MODEL_DIMS.f5e.wingSpanM);
    expect(MODEL_DIMS.b738.wingSpanM).toBeGreaterThan(MODEL_DIMS.c172s.wingSpanM);
  });

  it("gives the GA single a straight wing and the jets swept wings", () => {
    expect(MODEL_DIMS.c172s.wingSweepRad).toBe(0);
    expect(MODEL_DIMS.b738.wingSweepRad).toBeGreaterThan(0);
    expect(MODEL_DIMS.f5e.wingSweepRad).toBeGreaterThan(0);
  });

  it("gives the fighter a low aspect ratio (short span for its length) — stubby wings", () => {
    const aspect = (id: string) => MODEL_DIMS[id].wingSpanM / MODEL_DIMS[id].lengthM;
    expect(aspect("f5e")).toBeLessThan(aspect("c172s"));
  });
});
