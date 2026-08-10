import { describe, expect, it } from "vitest";
import type { PassedLandingSafety } from "./landingSafety";
import { LANDING_SCORE_WEIGHTS, scoreCurve, scoreLanding } from "./landingScore";
import { missionProfileForClass } from "./profiles";

function safety(values: Partial<PassedLandingSafety["measurements"]> = {}): PassedLandingSafety {
  return {
    passed: true,
    failure: null,
    measurements: {
      sinkRateFpm: 0,
      centerlineErrorFt: 0,
      touchdownDistanceFt: 0,
      headingErrorDeg: 0,
      speedErrorKt: 0,
      bankDeg: 0,
      pitchDeg: 0,
      touchdownSpeedKt: 60,
      maxAbsLoadFactor: 1,
      gearPosition: 1,
      rolloutCrossTrackFt: 0,
      ...values,
    },
  };
}

describe("successful landing score", () => {
  it("uses the approved weights and totals exactly 100 for a perfect landing", () => {
    const score = scoreLanding(safety(), missionProfileForClass("c172s"));
    expect(score.components).toEqual(LANDING_SCORE_WEIGHTS);
    expect(score.total).toBe(100);
  });

  it("interpolates curves and clamps at both endpoints", () => {
    const curve = [{ value: 10, score: 1 }, { value: 20, score: 0.5 }, { value: 30, score: 0 }];
    expect(scoreCurve(0, curve)).toBe(1);
    expect(scoreCurve(15, curve)).toBe(0.75);
    expect(scoreCurve(40, curve)).toBe(0);
  });

  it.each(["c172s", "b738", "f5e"] as const)("keeps %s scores in the 0–100 contract", (classId) => {
    const profile = missionProfileForClass(classId);
    const last = <T extends keyof typeof profile.scoreCurves>(name: T) =>
      profile.scoreCurves[name].at(-1)!.value;
    const score = scoreLanding(safety({
      sinkRateFpm: last("verticalSpeedFpm"),
      centerlineErrorFt: last("centerlineErrorFt"),
      touchdownDistanceFt: last("touchdownZoneFt"),
      headingErrorDeg: last("headingErrorDeg"),
      speedErrorKt: last("speedErrorKt"),
      bankDeg: last("bankDeg"),
      rolloutCrossTrackFt: last("rolloutCrossTrackFt"),
    }), profile);
    expect(score.total).toBe(0);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it.each(["c172s", "b738", "f5e"] as const)("hits every declared %s curve point exactly", (classId) => {
    const curves = missionProfileForClass(classId).scoreCurves;
    for (const curve of Object.values(curves)) {
      for (const point of curve) expect(scoreCurve(point.value, curve)).toBeCloseTo(point.score, 12);
    }
  });
});
