import { describe, expect, it } from "vitest";
import { approachBandFor } from "./approachBand";
import { destinationPoint } from "./geo";
import { missionProfileForClass } from "./profiles";
import type { RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

// Threshold at (30, -88), landing to the east (heading 090). The approach side is west of it.
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

const profile = missionProfileForClass("c172s"); // approach 65 ± 5, 3° slope, approachLengthNm 5

/** A point `distanceNm` before the threshold on final (west of it). */
function onFinal(distanceNm: number): { latDeg: number; lonDeg: number } {
  return destinationPoint(assignment.assignedEnd.latDeg, assignment.assignedEnd.lonDeg, 270, distanceNm);
}

describe("approachBandFor", () => {
  it("publishes the per-class speed band while established on final", () => {
    const band = approachBandFor(onFinal(3), assignment, profile, "FULL");
    expect(band).not.toBeNull();
    expect(band!.speed).toEqual({ targetKt: 65, loKt: 60, hiKt: 70 });
    expect(band!.distanceNm).toBeCloseTo(3, 1);
  });

  it("puts the altitude band on the glide slope, symmetric and at least the floor wide", () => {
    const band = approachBandFor(onFinal(3), assignment, profile, "FULL")!;
    const expectedTargetFt = 110 + Math.tan((3 * Math.PI) / 180) * band.distanceNm * FEET_PER_NM;
    expect(band.altitude.targetFt).toBeCloseTo(expectedTargetFt, 0);
    expect(band.altitude.hiFt - band.altitude.targetFt).toBeCloseTo(
      band.altitude.targetFt - band.altitude.loFt,
      6,
    );
    expect(band.altitude.hiFt - band.altitude.targetFt).toBeGreaterThanOrEqual(120);
  });

  it("stays silent once past the threshold", () => {
    // 1 nm beyond the threshold, in the landing direction.
    const pastThreshold = destinationPoint(30, -88, 90, 1);
    expect(approachBandFor(pastThreshold, assignment, profile, "FULL")).toBeNull();
  });

  it("stays silent beyond the profile's approach length", () => {
    expect(approachBandFor(onFinal(6), assignment, profile, "FULL")).toBeNull();
  });

  it("stays silent with assist OFF", () => {
    expect(approachBandFor(onFinal(3), assignment, profile, "OFF")).toBeNull();
  });
});
