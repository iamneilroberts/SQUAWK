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

  it("is a pure lookup, not a branch — the map holds exactly the known classes", () => {
    expect(Object.keys(MODEL_DIMS).sort()).toEqual(["b738", "biz", "c172s", "f5e", "tprop"]);
  });

  it("throws on an unknown id rather than silently substituting (a bug, not data)", () => {
    expect(() => modelDimsForClass("a380")).toThrow(/unknown class id/);
  });

  it("every dimension is a finite positive number, sweep is non-negative, placement is signed", () => {
    // wingSweepRad / wingXFrac are non-negative fractions; wingZFrac is a SIGNED placement
    // (negative = high wing); engine is a nested object validated separately below.
    const signed = new Set(["wingZFrac"]);
    const nonNeg = new Set(["wingSweepRad", "wingXFrac"]);
    for (const dims of Object.values(MODEL_DIMS)) {
      for (const [k, v] of Object.entries(dims)) {
        if (k === "engine") continue;
        expect(Number.isFinite(v), `${k} finite`).toBe(true);
        if (signed.has(k)) continue; // any finite sign allowed
        if (nonNeg.has(k)) expect(v).toBeGreaterThanOrEqual(0);
        else expect(v, `${k} positive`).toBeGreaterThan(0);
      }
    }
  });

  it("wing taper is a fraction in (0,1]; only the airliner carries engine nacelles", () => {
    for (const dims of Object.values(MODEL_DIMS)) {
      expect(dims.wingTipChordFrac).toBeGreaterThan(0);
      expect(dims.wingTipChordFrac).toBeLessThanOrEqual(1);
    }
    // Nacelles are DATA (present only where a class has them), not a per-class code branch.
    expect(MODEL_DIMS.c172s.engine).toBeUndefined();
    expect(MODEL_DIMS.f5e.engine).toBeUndefined();
    const e = MODEL_DIMS.b738.engine;
    expect(e).toBeDefined();
    if (e) {
      expect(e.spanFracs).toHaveLength(e.count);
      expect(e.lengthM).toBeGreaterThan(0);
      expect(e.radiusM).toBeGreaterThan(0);
      // Symmetric span stations keep the airframe left/right symmetric.
      expect([...e.spanFracs].sort((a, b) => a - b)).toEqual(
        [...e.spanFracs].map((f) => -f).sort((a, b) => a - b),
      );
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

  it("resolves biz model dimensions (swept low-wing twinjet with nacelles)", () => {
    const d = modelDimsForClass("biz");
    expect(d.wingSweepRad).toBeGreaterThan(0);
    expect(d.engine?.count).toBe(2);
    expect(d.lengthM).toBeGreaterThan(15);
    expect(d.lengthM).toBeLessThan(25);
  });

  it("resolves tprop model dimensions (straight high-AR low wing, twin wing-mounted turboprops)", () => {
    const d = modelDimsForClass("tprop");
    expect(d.wingSweepRad).toBe(0);         // straight wing (turboprop, not swept)
    expect(d.engine?.count).toBe(2);        // two wing-mounted turboprops
    expect(d.wingSpanM).toBeGreaterThan(d.lengthM); // high-AR: span exceeds length
    expect(d.lengthM).toBeGreaterThan(12);
    expect(d.lengthM).toBeLessThan(18);
  });
});
