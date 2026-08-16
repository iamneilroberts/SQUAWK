import { describe, expect, it } from "vitest";
import { onFinalPlacement, baseLegPlacement, finalApproachSpawnOverrides } from "./spawnPlacement";
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
    // On-slope descent rate: negative (descending), matching the -glideSlopeDeg flight-path
    // angle formula (101.269 converts kt to ft/min).
    const expectedRateFpm =
      -(profile.approach.targetSpeedKt * 101.269) * Math.sin(profile.guidance.glideSlopeDeg * Math.PI / 180);
    expect(p.verticalRateFpm).toBeLessThan(0);
    expect(p.verticalRateFpm).toBeCloseTo(expectedRateFpm, 6);
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
    expect(p.verticalRateFpm).toBe(0);
  });
});

describe("finalApproachSpawnOverrides", () => {
  it("maps the placement onto buildLockedMissionSpawn's override shape, gear down, landing flaps (#87)", () => {
    const profile = missionProfileForClass("c172s");
    const place = onFinalPlacement(assignment, profile);
    const overrides = finalApproachSpawnOverrides(place, 2);
    expect(overrides.spawnPositionOverride).toEqual({ latDeg: place.latDeg, lonDeg: place.lonDeg });
    expect(overrides.spawnAltitudeFtOverride).toBe(place.altitudeFt);
    expect(overrides.spawnSpeedKtOverride).toBe(place.speedKt);
    expect(overrides.spawnVerticalRateFpmOverride).toBe(place.verticalRateFpm);
    expect(overrides.spawnHeadingDeg).toBe(place.headingDeg);
    expect(overrides.initialGearDown).toBe(true);
    expect(overrides.initialFlapDetent).toBe(2);
  });
});
