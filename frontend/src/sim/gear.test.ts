import { describe, it, expect } from "vitest";
import { advanceGearPosition, GEAR_TRANSITION_S } from "./forces";

describe("gear transition integrator", () => {
  it("eases from up to down over GEAR_TRANSITION_S seconds", () => {
    let pos = 0;
    for (let i = 0; i < GEAR_TRANSITION_S * 60; i++) {
      pos = advanceGearPosition(pos, true, "retractable", 1 / 60);
    }
    expect(pos).toBeCloseTo(1, 2);
  });
  it("eases from down to up over GEAR_TRANSITION_S seconds", () => {
    let pos = 1;
    for (let i = 0; i < GEAR_TRANSITION_S * 60; i++) {
      pos = advanceGearPosition(pos, false, "retractable", 1 / 60);
    }
    expect(pos).toBeCloseTo(0, 2);
  });
  it("does not move before GEAR_TRANSITION_S has elapsed", () => {
    let pos = 0;
    for (let i = 0; i < (GEAR_TRANSITION_S / 2) * 60; i++) {
      pos = advanceGearPosition(pos, true, "retractable", 1 / 60);
    }
    expect(pos).toBeCloseTo(0.5, 2);
  });
  it("clamps to [0, 1] and does not overshoot on a large dt", () => {
    expect(advanceGearPosition(0.9, true, "retractable", 5)).toBe(1);
    expect(advanceGearPosition(0.1, false, "retractable", 5)).toBe(0);
  });
  it("holds position when the command already matches it", () => {
    expect(advanceGearPosition(1, true, "retractable", 1 / 60)).toBe(1);
    expect(advanceGearPosition(0, false, "retractable", 1 / 60)).toBe(0);
  });
  it("fixed gear is pinned at 1 regardless of the command or dt (GR-005)", () => {
    expect(advanceGearPosition(0, true, "fixed", 1 / 60)).toBe(1);
    expect(advanceGearPosition(1, false, "fixed", 1 / 60)).toBe(1);
    expect(advanceGearPosition(0.3, false, "fixed", 100)).toBe(1);
  });
});
