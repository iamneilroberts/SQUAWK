import { describe, it, expect } from "vitest";
import { FIXED_DT, MAX_FRAME_S, MAX_STEPS_PER_FRAME, createAccumulator, runFixedSteps } from "./integrator";

describe("fixed-step accumulator", () => {
  it("runs at 60 Hz", () => {
    expect(FIXED_DT).toBeCloseTo(1 / 60, 12);
    expect(MAX_STEPS_PER_FRAME).toBe(Math.round(MAX_FRAME_S / FIXED_DT));
  });
  it("runs 0 steps for a frame shorter than one tick, and carries the remainder", () => {
    const acc = createAccumulator();
    expect(runFixedSteps(acc, 0.008, () => {})).toEqual({ steps: 0, clamped: false });
    expect(runFixedSteps(acc, 0.009, () => {}).steps).toBe(1);
  });
  it("runs exactly 6 steps for a 100 ms frame", () => {
    const acc = createAccumulator();
    let n = 0;
    const r = runFixedSteps(acc, 0.1, () => { n++; });
    expect(r.steps).toBe(6);
    expect(n).toBe(6);
    expect(r.clamped).toBe(false);
  });
  it("a 30 s gap (backgrounded tab) is capped at 15 steps and reported as clamped", () => {
    const acc = createAccumulator();
    let n = 0;
    const r = runFixedSteps(acc, 30, () => { n++; });
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(n).toBe(MAX_STEPS_PER_FRAME);
    expect(r.clamped).toBe(true);
  });
  it("drops the excess rather than carrying it (no death spiral after a gap)", () => {
    const acc = createAccumulator();
    runFixedSteps(acc, 30, () => {});
    const next = runFixedSteps(acc, 0.016, () => {});
    expect(next.steps).toBeLessThanOrEqual(1);
    expect(next.clamped).toBe(false);
  });
  it("a synthetic dt sequence totals the right number of steps", () => {
    const acc = createAccumulator();
    const frames = [0.016, 0.017, 0.016, 0.033, 0.016, 0.016, 0.016, 0.016];
    let n = 0;
    for (const f of frames) runFixedSteps(acc, f, () => { n++; });
    const total = frames.reduce((a, b) => a + b, 0);
    expect(n).toBe(Math.floor(total / FIXED_DT));
  });
  it("ignores negative or non-finite elapsed times", () => {
    const acc = createAccumulator();
    expect(runFixedSteps(acc, -5, () => {}).steps).toBe(0);
    expect(runFixedSteps(acc, Number.NaN, () => {}).steps).toBe(0);
  });
});
