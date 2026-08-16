import { describe, it, expect } from "vitest";
import {
  AUTO_RESET_AGL_M,
  TIME_COMPRESSION_FACTORS,
  scaleElapsed,
  shouldAutoResetCompression,
} from "./timeCompression";
import { FIXED_DT, MAX_STEPS_PER_FRAME, createAccumulator, runFixedSteps } from "../sim/integrator";

describe("scaleElapsed", () => {
  it("multiplies elapsed wall time by the factor, leaving 1x unchanged", () => {
    expect(scaleElapsed(1 / 60, 1)).toBeCloseTo(1 / 60, 12);
    expect(scaleElapsed(1 / 60, 2)).toBeCloseTo(2 / 60, 12);
    expect(scaleElapsed(1 / 60, 4)).toBeCloseTo(4 / 60, 12);
  });

  it("only offers 1x/2x/4x — no 8x+ in v1 (see file header)", () => {
    expect(TIME_COMPRESSION_FACTORS).toEqual([1, 2, 4]);
  });

  it("stays comfortably inside the fixed-step clamp at every offered factor, a typical 60 fps frame", () => {
    // A typical frame is ~1/60 s; the highest offered factor (4x) must not brush the 15-step cap.
    for (const factor of TIME_COMPRESSION_FACTORS) {
      const acc = createAccumulator();
      const { steps, clamped } = runFixedSteps(acc, scaleElapsed(1 / 60, factor), () => {});
      expect(steps).toBe(factor);
      expect(clamped).toBe(false);
      expect(steps).toBeLessThan(MAX_STEPS_PER_FRAME);
    }
  });

  it("physics dt itself never changes — scaling only feeds MORE fixed 1/60s steps to the accumulator", () => {
    const acc = createAccumulator();
    const { steps } = runFixedSteps(acc, scaleElapsed(0.05, 4), () => {});
    // 0.05s * 4 = 0.2s of sim time / (1/60 s) per step = 12 steps, each still exactly FIXED_DT.
    expect(steps).toBe(12);
    expect(steps * FIXED_DT).toBeCloseTo(0.2, 9);
  });
});

describe("shouldAutoResetCompression", () => {
  it("never resets at 1x — there is nothing to reset", () => {
    expect(shouldAutoResetCompression(1, 10)).toBe(false);
  });

  it("never claims proximity against an unmeasured clearance", () => {
    expect(shouldAutoResetCompression(4, null)).toBe(false);
  });

  it("stays active comfortably above the floor", () => {
    expect(shouldAutoResetCompression(4, AUTO_RESET_AGL_M + 50)).toBe(false);
  });

  it("resets once the aircraft descends inside the floor", () => {
    expect(shouldAutoResetCompression(4, AUTO_RESET_AGL_M - 1)).toBe(true);
    expect(shouldAutoResetCompression(2, 0)).toBe(true);
  });
});
