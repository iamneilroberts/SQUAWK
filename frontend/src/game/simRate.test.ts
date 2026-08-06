import { describe, it, expect } from "vitest";
import { createRateMeter } from "./simRate";

describe("sim rate meter", () => {
  it("reads 1.0 when the sim keeps up with the wall clock", () => {
    const m = createRateMeter(2);
    for (let i = 0; i < 120; i++) m.record(1 / 60, 1 / 60);
    expect(m.rate()).toBeCloseTo(1, 3);
  });
  it("reads about 0.5 when the sim runs at half speed", () => {
    const m = createRateMeter(2);
    for (let i = 0; i < 120; i++) m.record(1 / 60, 2 / 60);
    expect(m.rate()).toBeCloseTo(0.5, 3);
  });
  it("recovers once the sim catches up (the window rolls)", () => {
    const m = createRateMeter(1);
    for (let i = 0; i < 60; i++) m.record(1 / 60, 4 / 60);
    expect(m.rate()).toBeLessThan(0.4);
    for (let i = 0; i < 120; i++) m.record(1 / 60, 1 / 60);
    expect(m.rate()).toBeGreaterThan(0.9);
  });
  it("reads 1.0 before any samples rather than 0 (no false SIM RATE warning on frame one)", () => {
    expect(createRateMeter(2).rate()).toBe(1);
  });
  it("ignores a zero-length wall interval instead of dividing by zero", () => {
    const m = createRateMeter(2);
    m.record(1 / 60, 0);
    expect(Number.isFinite(m.rate())).toBe(true);
  });
});
