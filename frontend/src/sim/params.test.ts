import { describe, it, expect } from "vitest";
import { validateClassParams, loadC172, loadB738, loadF5e } from "./params";
import { msToKt } from "./units";
import c172Raw from "../params/c172.json";

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
    expect(p.propulsion.afterburnerFactor).toBe(1.0);
    expect(p.limits.mmo).toBeGreaterThan(0);
    expect(p.display.asiMinKt).toBe(40);
    expect(p.display.asiMaxKt).toBe(180);
    expect(p.display.attitudeStyle).toBe("line");
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

describe("loadB738", () => {
  it("loads and validates the shipped 737-800 file", () => {
    const p = loadB738();
    expect(p.id).toBe("b738");
    expect(p.label).toBe("B738");
    expect(p.modelNote).toBe("737-800 MODEL");
    expect(p.propulsion.lapseModel).toBe("turbofan");
    expect(p.propulsion.afterburnerFactor).toBe(1.0);
    expect(p.limits.mmo).toBeCloseTo(0.82, 2);
    expect(p.limits.gLimitPos).toBe(2.5);
    expect(p.limits.gLimitNeg).toBe(-1.0);
    expect(p.display.attitudeStyle).toBe("ball");
    expect(p.display.asiMinKt).toBe(60);
    expect(p.display.asiMaxKt).toBe(400);
    expect(p.gear).toBe("retractable");
    expect(p.flaps.map((f) => f.label)).toEqual(["0", "1", "2", "5", "10", "15", "25", "30", "40"]);
  });
  it("has an aspect ratio consistent with its span and area", () => {
    const p = loadB738();
    expect(p.aspectRatio).toBeCloseTo((p.wingSpanM * p.wingSpanM) / p.wingAreaM2, 1);
  });
  it("documents every tuning knob in sources", () => {
    const text = JSON.stringify(loadB738().sources);
    expect(text).toContain("TUNING KNOB");
  });
});

describe("loadF5e", () => {
  it("loads and validates the shipped F-5E file", () => {
    const p = loadF5e();
    expect(p.id).toBe("f5e");
    expect(p.label).toBe("F5E");
    expect(p.modelNote).toBe("F-5E MODEL");
    expect(p.propulsion.lapseModel).toBe("turbofan");
    expect(p.propulsion.afterburnerFactor).toBeGreaterThan(1); // real dry->wet factor
    expect(p.limits.mmo).toBeLessThanOrEqual(0.95);            // capped subsonic
    expect(p.limits.gLimitPos).toBeGreaterThan(5);             // fighter g
    expect(p.limits.gLimitNeg).toBeLessThan(0);
    expect(p.display.attitudeStyle).toBe("ball");
    expect(p.display.asiMinKt).toBe(80);
    expect(p.display.asiMaxKt).toBe(800);
    expect(p.gear).toBe("retractable");
  });
  it("has an aspect ratio consistent with its span and area", () => {
    const p = loadF5e();
    expect(p.aspectRatio).toBeCloseTo((p.wingSpanM * p.wingSpanM) / p.wingAreaM2, 1);
  });
  it("documents every tuning knob in sources", () => {
    const text = JSON.stringify(loadF5e().sources);
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
  it("accepts turbofan as a lapse model", () => {
    const p = loadC172();
    const jet = {
      ...(p as unknown as Record<string, unknown>),
      propulsion: { ...p.propulsion, lapseModel: "turbofan" },
    };
    expect(validateClassParams(jet).propulsion.lapseModel).toBe("turbofan");
  });
  it("rejects a missing propulsion.afterburnerFactor rather than defaulting", () => {
    const p = loadC172();
    const { afterburnerFactor: _omitted, ...propulsion } = p.propulsion as Record<string, unknown>;
    const bad = { ...(p as unknown as Record<string, unknown>), propulsion };
    expect(() => validateClassParams(bad)).toThrow(/afterburnerFactor/);
  });
  it("rejects a missing limits.mmo rather than defaulting", () => {
    const raw = JSON.parse(JSON.stringify(c172Raw)) as Record<string, unknown>;
    delete (raw.limits as Record<string, unknown>).mmo;
    expect(() => validateClassParams(raw)).toThrow(/mmo/);
  });
  it("rejects a missing display block", () => {
    const raw = JSON.parse(JSON.stringify(c172Raw)) as Record<string, unknown>;
    delete raw.display;
    expect(() => validateClassParams(raw)).toThrow(/display/);
  });
  it("rejects an unknown attitudeStyle", () => {
    const raw = JSON.parse(JSON.stringify(c172Raw)) as Record<string, unknown>;
    (raw.display as Record<string, unknown>).attitudeStyle = "sphere";
    expect(() => validateClassParams(raw)).toThrow(/attitudeStyle/);
  });
});

describe("ASI arc V-speeds", () => {
  it("carries the POH's Vno and Vfe — the ASI arcs are sourced data, not drawn from taste", () => {
    const p = loadC172();
    expect(msToKt(p.limits.vnoIasMs)).toBeCloseTo(129, 0); // 172S POH max structural cruising
    expect(msToKt(p.limits.vfeIasMs)).toBeCloseTo(85, 0);  // 172S POH, flaps 10-30 deg
    // Ordering is what makes the arcs meaningful at all.
    expect(p.limits.vfeIasMs).toBeLessThan(p.limits.vnoIasMs);
    expect(p.limits.vnoIasMs).toBeLessThan(p.limits.vneIasMs);
  });

  it("rejects a params file that omits them rather than defaulting to a guess", () => {
    const raw = JSON.parse(JSON.stringify(c172Raw)) as Record<string, unknown>;
    delete (raw.limits as Record<string, unknown>).vnoIasMs;
    expect(() => validateClassParams(raw)).toThrow(/vnoIasMs/);
  });
});
