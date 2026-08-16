import { describe, it, expect } from "vitest";
import { wheelToThrottle, WHEEL_THROTTLE_SENS_PER_UNIT } from "./mouseFlightStick";

describe("wheel -> throttle lever", () => {
  it("scroll up (negative deltaY) increases throttle", () => {
    expect(wheelToThrottle(0.5, -100)).toBeGreaterThan(0.5);
  });
  it("scroll down (positive deltaY) decreases throttle", () => {
    expect(wheelToThrottle(0.5, 100)).toBeLessThan(0.5);
  });
  it("one typical wheel click (~100 units) moves throttle by the documented sensitivity", () => {
    expect(wheelToThrottle(0.5, -100)).toBeCloseTo(0.5 + 100 * WHEEL_THROTTLE_SENS_PER_UNIT, 6);
  });
  it("clamps at full throttle rather than overshooting", () => {
    expect(wheelToThrottle(0.99, -1000)).toBe(1);
  });
  it("clamps at idle rather than going negative", () => {
    expect(wheelToThrottle(0.01, 1000)).toBe(0);
  });
  it("a zero delta leaves the lever exactly where it was", () => {
    expect(wheelToThrottle(0.42, 0)).toBe(0.42);
  });
});
