import { describe, expect, it } from "vitest";
import { descentGuidanceFor } from "./descentGuidance";
import { destinationPoint } from "./geo";
import { glideSlopeAltitudeFt } from "./guidanceGeometry";
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

const profile = missionProfileForClass("c172s"); // approachLengthNm 5, 3° slope

/** A point `distanceNm` before the threshold (west of it, on the approach side). */
function inbound(distanceNm: number): { latDeg: number; lonDeg: number } {
  return destinationPoint(assignment.assignedEnd.latDeg, assignment.assignedEnd.lonDeg, 270, distanceNm);
}

describe("descentGuidanceFor", () => {
  it("advises a descent to the glide-slope top when high and far out", () => {
    const p = inbound(20);
    const g = descentGuidanceFor(
      { latDeg: p.latDeg, lonDeg: p.lonDeg, altitudeFt: 5000, groundSpeedKt: 120 },
      assignment, profile, "NAV",
    )!;
    expect(g).not.toBeNull();
    // target = glide-slope altitude at the approach entry (approachLengthNm out)
    expect(g.targetAltitudeFt).toBeCloseTo(glideSlopeAltitudeFt(assignment, profile.guidance, 5), 0);
    expect(g.distanceNm).toBeCloseTo(20, 0);
    // ~15 nm to the approach entry at 120 kt = 7.5 min; (5000 - ~1702)/7.5 ≈ 440 fpm
    expect(g.descentRateFpm).toBeGreaterThan(300);
    expect(g.descentRateFpm).toBeLessThan(600);
    expect(g.onProfile).toBe(false);
  });

  it("reports on-profile (no descent) when already at or below the target altitude", () => {
    const p = inbound(20);
    const g = descentGuidanceFor(
      { latDeg: p.latDeg, lonDeg: p.lonDeg, altitudeFt: 1500, groundSpeedKt: 120 },
      assignment, profile, "NAV",
    )!;
    expect(g.onProfile).toBe(true);
    expect(g.descentRateFpm).toBe(0);
  });

  it("stays silent inside the approach length (the approach band takes over there)", () => {
    const p = inbound(3);
    expect(descentGuidanceFor(
      { latDeg: p.latDeg, lonDeg: p.lonDeg, altitudeFt: 2000, groundSpeedKt: 100 },
      assignment, profile, "NAV",
    )).toBeNull();
  });

  it("stays silent beyond the guidance range", () => {
    const p = inbound(80);
    expect(descentGuidanceFor(
      { latDeg: p.latDeg, lonDeg: p.lonDeg, altitudeFt: 9000, groundSpeedKt: 120 },
      assignment, profile, "NAV",
    )).toBeNull();
  });

  it("stays silent with assist OFF", () => {
    const p = inbound(20);
    expect(descentGuidanceFor(
      { latDeg: p.latDeg, lonDeg: p.lonDeg, altitudeFt: 5000, groundSpeedKt: 120 },
      assignment, profile, "OFF",
    )).toBeNull();
  });
});
