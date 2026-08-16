import { describe, it, expect } from "vitest";
import {
  ZERO_LOOK,
  LOOK_SENSITIVITY_RAD_PER_PX,
  LOOK_MAX_PITCH_RAD,
  LOOK_EASE_RATE_PER_S,
  applyMouseDelta,
  easeToward,
  clampToLookArc,
} from "./lookAround";

describe("applyMouseDelta", () => {
  it("accumulates mouse motion into a non-zero offset — a no-op accumulator would fail this", () => {
    // BROKEN-ARM: if applyMouseDelta ignored its inputs and returned the offset unchanged,
    // both of these would still be 0. They must not be.
    const out = applyMouseDelta(ZERO_LOOK, 100, -40, LOOK_SENSITIVITY_RAD_PER_PX);
    expect(out.yawRad).not.toBe(0);
    expect(out.pitchRad).not.toBe(0);
    expect(out.yawRad).toBeCloseTo(100 * LOOK_SENSITIVITY_RAD_PER_PX, 12);
    // Mouse UP (negative movementY) looks UP (positive pitch): screen-natural, not inverted.
    expect(out.pitchRad).toBeCloseTo(40 * LOOK_SENSITIVITY_RAD_PER_PX, 12);
  });
  it("accumulates across successive deltas rather than replacing", () => {
    let o = applyMouseDelta(ZERO_LOOK, 50, 0, LOOK_SENSITIVITY_RAD_PER_PX);
    o = applyMouseDelta(o, 50, 0, LOOK_SENSITIVITY_RAD_PER_PX);
    expect(o.yawRad).toBeCloseTo(100 * LOOK_SENSITIVITY_RAD_PER_PX, 12);
  });
  it("scales with sensitivity — a bigger knob turns the head faster for the same pixels", () => {
    const slow = applyMouseDelta(ZERO_LOOK, 100, 0, 0.001).yawRad;
    const fast = applyMouseDelta(ZERO_LOOK, 100, 0, 0.004).yawRad;
    expect(fast).toBeCloseTo(4 * slow, 12);
  });
  it("wraps yaw the full way round so you can face the rear", () => {
    // Push yaw a long way clockwise; it must stay a valid angle in (-pi, pi], never run off
    // to +infinity, so looking over your shoulder for traffic works.
    let o = ZERO_LOOK;
    for (let i = 0; i < 20; i++) o = applyMouseDelta(o, 500, 0, LOOK_SENSITIVITY_RAD_PER_PX);
    expect(o.yawRad).toBeGreaterThan(-Math.PI);
    expect(o.yawRad).toBeLessThanOrEqual(Math.PI);
  });
  it("a yaw of just under half a turn stays put (does not wrap prematurely)", () => {
    const almostRear = Math.PI - 0.01;
    const px = almostRear / LOOK_SENSITIVITY_RAD_PER_PX;
    const o = applyMouseDelta(ZERO_LOOK, px, 0, LOOK_SENSITIVITY_RAD_PER_PX);
    expect(o.yawRad).toBeCloseTo(almostRear, 9);
  });
  it("clamps pitch to the ~85 degree limit so the view never flips over the top", () => {
    // Ask for way more than a quarter turn up; it must saturate at the limit, not invert.
    const up = applyMouseDelta(ZERO_LOOK, 0, -100000, LOOK_SENSITIVITY_RAD_PER_PX);
    expect(up.pitchRad).toBeCloseTo(LOOK_MAX_PITCH_RAD, 9);
    const down = applyMouseDelta(ZERO_LOOK, 0, 100000, LOOK_SENSITIVITY_RAD_PER_PX);
    expect(down.pitchRad).toBeCloseTo(-LOOK_MAX_PITCH_RAD, 9);
  });
});

describe("easeToward", () => {
  it("decays an offset toward zero rather than holding it", () => {
    const start = { yawRad: 0.5, pitchRad: -0.3 };
    const after = easeToward(start, 1 / 60, LOOK_EASE_RATE_PER_S);
    expect(Math.abs(after.yawRad)).toBeLessThan(Math.abs(start.yawRad));
    expect(Math.abs(after.pitchRad)).toBeLessThan(Math.abs(start.pitchRad));
  });
  it("converges to exactly zero within a fraction of a second (~0.3 s ease-back)", () => {
    let o = { yawRad: 1.2, pitchRad: -0.8 };
    const initialYaw = Math.abs(o.yawRad);
    // ~0.3 s of frames: should be well under a twentieth of the way out.
    for (let i = 0; i < 18; i++) o = easeToward(o, 1 / 60, LOOK_EASE_RATE_PER_S);
    expect(Math.abs(o.yawRad)).toBeLessThan(0.05 * initialYaw);
    // Keep going a full second: it must reach EXACTLY zero, not asymptotically hover.
    for (let i = 0; i < 60; i++) o = easeToward(o, 1 / 60, LOOK_EASE_RATE_PER_S);
    expect(o.yawRad).toBe(0);
    expect(o.pitchRad).toBe(0);
  });
  it("a zero offset stays zero", () => {
    const o = easeToward(ZERO_LOOK, 1 / 60, LOOK_EASE_RATE_PER_S);
    expect(o.yawRad).toBe(0);
    expect(o.pitchRad).toBe(0);
  });
});

describe("clampToLookArc", () => {
  const GA_ARC = { yawRad: (100 * Math.PI) / 180, pitchUpRad: (40 * Math.PI) / 180, pitchDownRad: (25 * Math.PI) / 180 };

  it("leaves an offset well inside the arc untouched", () => {
    const inside = { yawRad: 0.2, pitchRad: -0.1 };
    expect(clampToLookArc(inside, GA_ARC)).toEqual(inside);
  });
  it("clamps yaw symmetrically at +/- yawRad", () => {
    // BROKEN-ARM: a no-op clamp would let these values sail straight through.
    expect(clampToLookArc({ yawRad: 10, pitchRad: 0 }, GA_ARC).yawRad).toBeCloseTo(GA_ARC.yawRad, 12);
    expect(clampToLookArc({ yawRad: -10, pitchRad: 0 }, GA_ARC).yawRad).toBeCloseTo(-GA_ARC.yawRad, 12);
  });
  it("clamps pitch asymmetrically — up and down arcs differ", () => {
    expect(clampToLookArc({ yawRad: 0, pitchRad: 10 }, GA_ARC).pitchRad).toBeCloseTo(GA_ARC.pitchUpRad, 12);
    expect(clampToLookArc({ yawRad: 0, pitchRad: -10 }, GA_ARC).pitchRad).toBeCloseTo(-GA_ARC.pitchDownRad, 12);
  });
  it("a wider arc (fighter) clamps later than a narrower one (GA)", () => {
    const FIGHTER_ARC = { yawRad: (160 * Math.PI) / 180, pitchUpRad: (85 * Math.PI) / 180, pitchDownRad: (35 * Math.PI) / 180 };
    const raw = { yawRad: 2.0, pitchRad: 1.3 };
    const gaClamped = clampToLookArc(raw, GA_ARC);
    const fighterClamped = clampToLookArc(raw, FIGHTER_ARC);
    expect(fighterClamped.yawRad).toBeGreaterThan(gaClamped.yawRad);
    expect(fighterClamped.pitchRad).toBeGreaterThan(gaClamped.pitchRad);
  });
});
