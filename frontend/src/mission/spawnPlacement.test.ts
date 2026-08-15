import { describe, expect, it } from "vitest";
import { onFinalPlacement, baseLegPlacement } from "./spawnPlacement";
import { finalApproachFix } from "./guidanceGeometry";
import { greatCircleDistanceNm, headingDeltaDeg, initialBearingDeg } from "./geo";
import { missionProfileForClass } from "./profiles";
import type { RunwayAssignment } from "./types";

const assignment = {
  airportElevationFt: 100,
  runwayHeadingDeg: 90,
  runwayLengthFt: 6000,
  runwayWidthFt: 100,
  assignedEnd: {
    ident: "09",
    latDeg: 30,
    lonDeg: -88,
    elevationFt: 110,
    headingDeg: 90,
    displacedThresholdFt: 0,
  },
} as RunwayAssignment;

describe("onFinalPlacement", () => {
  it("sits at the FAF, on-slope, runway heading, approach speed", () => {
    const profile = missionProfileForClass("c172s");
    const p = onFinalPlacement(assignment, profile);
    const faf = finalApproachFix(assignment, profile.guidance);
    expect(p.latDeg).toBeCloseTo(faf.point.latDeg, 9);
    expect(p.lonDeg).toBeCloseTo(faf.point.lonDeg, 9);
    expect(p.altitudeFt).toBeCloseTo(faf.altitudeFt, 6);
    expect(p.headingDeg).toBeCloseTo(assignment.runwayHeadingDeg, 6);
    expect(p.speedKt).toBe(profile.approach.targetSpeedKt);
  });
});

describe("baseLegPlacement", () => {
  it("is offset from the FAF and points at it", () => {
    const profile = missionProfileForClass("c172s");
    const p = baseLegPlacement(assignment, profile);
    const faf = finalApproachFix(assignment, profile.guidance);
    // offset ~baseLegOffsetNm from the FAF
    const d = greatCircleDistanceNm(p.latDeg, p.lonDeg, faf.point.latDeg, faf.point.lonDeg);
    expect(d).toBeGreaterThan(0.5);
    // heading points at the FAF
    const toFaf = initialBearingDeg(p.latDeg, p.lonDeg, faf.point.latDeg, faf.point.lonDeg);
    expect(headingDeltaDeg(p.headingDeg, toFaf)).toBeLessThan(1);
    expect(p.speedKt).toBe(profile.approach.targetSpeedKt);
  });
});
