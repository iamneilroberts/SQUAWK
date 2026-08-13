import { describe, it, expect } from "vitest";
import {
  TRIM_FULL_SCALE, throttleKnobY, throttleWarn, flapDroopEnd,
  trimNeedle, gearGlyph, speedbrakeOut,
} from "./ControlIconMath";

describe("ControlIconMath", () => {
  it("throttle knob rides the track and is monotonic; unknown is null", () => {
    expect(throttleKnobY(null)).toBeNull();
    expect(throttleKnobY(0)).toBeCloseTo(32);   // bottom of track at idle
    expect(throttleKnobY(1)).toBeCloseTo(6);     // top at full
    expect(throttleKnobY(0.5)!).toBeGreaterThan(throttleKnobY(0.9)!); // higher throttle = smaller y
  });

  it("throttle warns only near the top", () => {
    expect(throttleWarn(0.8)).toBe(false);
    expect(throttleWarn(0.95)).toBe(true);
    expect(throttleWarn(null)).toBe(false);
  });

  it("flap trailing edge droops further with detent; clean is level and inactive", () => {
    const clean = flapDroopEnd(0, 5)!;
    const full = flapDroopEnd(4, 5)!;
    expect(clean.active).toBe(false);
    expect(clean.y).toBeCloseTo(17);            // level with the chord at detent 0
    expect(full.active).toBe(true);
    expect(full.y).toBeGreaterThan(clean.y);     // trailing edge lower (larger y) at full
    expect(flapDroopEnd(null, null)).toBeNull();
    expect(flapDroopEnd(1, 1)!.y).toBeCloseTo(17); // count 1 → no droop, never divide by zero
  });

  it("trim needle offsets from the center gate and flags neutral / pegged", () => {
    expect(trimNeedle(0)!.neutral).toBe(true);
    expect(trimNeedle(0)!.y).toBeCloseTo(19);         // on the gate
    expect(trimNeedle(TRIM_FULL_SCALE)!.y).toBeCloseTo(7);   // nose-up pegs high (small y)
    expect(trimNeedle(-TRIM_FULL_SCALE)!.y).toBeCloseTo(31); // nose-down pegs low
    expect(trimNeedle(0.5)!.pegged).toBe(true);       // beyond full-scale
    expect(trimNeedle(0.1)!.neutral).toBe(false);
    expect(trimNeedle(null)).toBeNull();
  });

  it("gear wheel extends with position; transit only mid-travel; fixed is flagged", () => {
    expect(gearGlyph("fixed", 1)!.fixed).toBe(true);
    const up = gearGlyph("retractable", 0)!;
    const down = gearGlyph("retractable", 1)!;
    const mid = gearGlyph("retractable", 0.5)!;
    expect(down.wheelY).toBeGreaterThan(up.wheelY);   // down = wheel lower
    expect(up.transit).toBe(false);
    expect(down.transit).toBe(false);
    expect(mid.transit).toBe(true);
    expect(gearGlyph(null, null)).toBeNull();
  });

  it("speedbrake out is a plain boolean, absent reads stowed", () => {
    expect(speedbrakeOut(true)).toBe(true);
    expect(speedbrakeOut(false)).toBe(false);
    expect(speedbrakeOut(undefined)).toBe(false);
  });
});
