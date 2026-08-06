import { describe, it, expect } from "vitest";
import { lowPassCoefficient, lowPassAngleRad, EYE_OFFSET_BODY_M } from "./fpvCamera";
import { degToRad, radToDeg } from "../sim/units";

describe("lowPassCoefficient", () => {
  it("is between 0 and 1 across the specced 5-15 Hz band at 60 fps", () => {
    for (const hz of [5, 10, 15]) {
      const c = lowPassCoefficient(hz, 1 / 60);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThan(1);
    }
  });
  it("a higher cutoff follows the raw attitude more closely", () => {
    expect(lowPassCoefficient(15, 1 / 60)).toBeGreaterThan(lowPassCoefficient(5, 1 / 60));
  });
  it("a longer frame catches up more per frame, so the filter is frame-rate independent", () => {
    expect(lowPassCoefficient(10, 1 / 30)).toBeGreaterThan(lowPassCoefficient(10, 1 / 60));
  });
  it("saturates at 1 rather than overshooting after a very long frame", () => {
    expect(lowPassCoefficient(10, 5)).toBeLessThanOrEqual(1);
  });
});

describe("lowPassAngleRad", () => {
  it("moves partway toward the target", () => {
    const out = lowPassAngleRad(0, degToRad(10), 0.5);
    expect(radToDeg(out)).toBeCloseTo(5, 6);
  });
  it("takes the short way round 359 -> 001, not the long way through 180", () => {
    const out = radToDeg(lowPassAngleRad(degToRad(359), degToRad(1), 0.5));
    const normalized = (out + 360) % 360;
    expect(normalized > 359.5 || normalized < 0.5).toBe(true);
  });
  it("takes the short way round 001 -> 359 as well", () => {
    const out = (radToDeg(lowPassAngleRad(degToRad(1), degToRad(359), 0.5)) + 360) % 360;
    expect(out > 359.5 || out < 0.5).toBe(true);
  });
  it("with coefficient 1 it snaps to the target", () => {
    expect(radToDeg(lowPassAngleRad(degToRad(30), degToRad(120), 1))).toBeCloseTo(120, 6);
  });
  it("with coefficient 0 it does not move", () => {
    expect(lowPassAngleRad(0.4, 1.9, 0)).toBeCloseTo(0.4, 12);
  });
  it("handles a 180 degree reversal without producing NaN", () => {
    expect(Number.isFinite(lowPassAngleRad(0, Math.PI, 0.5))).toBe(true);
  });
});

describe("eye point", () => {
  it("sits ahead of and above the CG (body z is down, so up is negative)", () => {
    expect(EYE_OFFSET_BODY_M.x).toBeGreaterThan(0);
    expect(EYE_OFFSET_BODY_M.z).toBeLessThan(0);
  });
});
