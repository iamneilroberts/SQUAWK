import { describe, it, expect } from "vitest";
import { validateClassParams, loadC172 } from "./params";

describe("loadC172", () => {
  it("loads and validates the shipped C172S parameter file", () => {
    const p = loadC172();
    expect(p.id).toBe("c172s");
    expect(p.label).toBe("C172S");
    expect(p.modelNote).toBe("C172 MODEL THIS BUILD");
    expect(p.massKg).toBeGreaterThan(0);
    expect(p.flaps).toHaveLength(4);
    expect(p.flaps.map((f) => f.label)).toEqual(["0", "10", "20", "30"]);
    expect(p.gear).toBe("fixed");
    expect(p.propulsion.lapseModel).toBe("piston");
  });
  it("has an aspect ratio consistent with its span and area", () => {
    const p = loadC172();
    expect(p.aspectRatio).toBeCloseTo((p.wingSpanM * p.wingSpanM) / p.wingAreaM2, 2);
  });
  it("documents every tuning knob in sources", () => {
    const text = JSON.stringify(loadC172().sources);
    expect(text).toContain("TUNING KNOB");
  });
});

describe("validateClassParams", () => {
  it("rejects a non-object", () => {
    expect(() => validateClassParams(null)).toThrow(/must be an object/);
    expect(() => validateClassParams(42)).toThrow(/must be an object/);
  });
  it("names the missing field", () => {
    expect(() => validateClassParams({ id: "x" })).toThrow(/label/);
  });
  it("rejects a non-positive mass", () => {
    const bad = { ...(loadC172() as unknown as Record<string, unknown>), massKg: 0 };
    expect(() => validateClassParams(bad)).toThrow(/massKg/);
  });
  it("rejects an empty flap list", () => {
    const bad = { ...(loadC172() as unknown as Record<string, unknown>), flaps: [] };
    expect(() => validateClassParams(bad)).toThrow(/flaps/);
  });
  it("rejects a flap detent missing a delta", () => {
    const bad = {
      ...(loadC172() as unknown as Record<string, unknown>),
      flaps: [{ label: "0", dCL0: 0, dStallAlphaRad: 0 }],
    };
    expect(() => validateClassParams(bad)).toThrow(/dCD0/);
  });
  // The lapse model is data because the alternative is a per-class branch in forces.ts. It
  // must fail loudly rather than default, or a typo silently turns one engine into another.
  it("rejects an unknown propulsion lapse model", () => {
    const p = loadC172();
    const bad = {
      ...(p as unknown as Record<string, unknown>),
      propulsion: { ...p.propulsion, lapseModel: "turboprop" },
    };
    expect(() => validateClassParams(bad)).toThrow(/lapseModel must be one of/);
  });
  it("rejects a missing propulsion lapse model rather than defaulting", () => {
    const p = loadC172();
    const { lapseModel: _omitted, ...propulsion } = p.propulsion;
    const bad = { ...(p as unknown as Record<string, unknown>), propulsion };
    expect(() => validateClassParams(bad)).toThrow(/lapseModel/);
  });
  it("accepts a flat-rated powerplant that takes no density lapse", () => {
    const p = loadC172();
    const jetish = {
      ...(p as unknown as Record<string, unknown>),
      propulsion: { ...p.propulsion, lapseModel: "none" },
    };
    expect(validateClassParams(jetish).propulsion.lapseModel).toBe("none");
  });
  it("accepts the shipped file unchanged", () => {
    expect(() => validateClassParams(loadC172())).not.toThrow();
  });
});
