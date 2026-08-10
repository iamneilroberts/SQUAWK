import { describe, expect, it } from "vitest";
import { destinationPoint } from "./geo";
import {
  isInRolloutEnvironment,
  isInTouchdownZone,
  isOnAssignedSurface,
  isPermittedDirection,
  permittedRunwayLimits,
  projectToRunwayFrame,
  runwaySurfacePolygon,
} from "./runwayGeometry";
import type { RunwayAssignment } from "./types";

function assignment(lonDeg = -88): RunwayAssignment {
  return {
    airportIdent: "KMOB",
    airportName: "Mobile Regional",
    airportLatDeg: 30,
    airportLonDeg: lonDeg,
    airportElevationFt: 100,
    runwayId: "1",
    runwayIdent: "09/27",
    runwayEndIdent: "09",
    runwayHeadingDeg: 90,
    runwayLengthFt: 6_000,
    runwayWidthFt: 100,
    runwaySurface: "HARD",
    runwayLighted: true,
    assignedEnd: {
      ident: "09",
      latDeg: 30,
      lonDeg,
      elevationFt: 100,
      headingDeg: 90,
      displacedThresholdFt: 300,
    },
    distanceNm: 10,
    estimatedMinutes: 5,
    suitability: 1,
  };
}

function runwayPoint(a: RunwayAssignment, alongFt: number, crossFt = 0) {
  const center = destinationPoint(
    a.assignedEnd.latDeg,
    a.assignedEnd.lonDeg,
    a.runwayHeadingDeg,
    alongFt / 6076.11549,
  );
  return destinationPoint(
    center.latDeg,
    center.lonDeg,
    a.runwayHeadingDeg + 90,
    crossFt / 6076.11549,
  );
}

describe("assigned runway frame", () => {
  it("projects centerline, right cross-track, and both thresholds", () => {
    const a = assignment();
    expect(projectToRunwayFrame(a, runwayPoint(a, 2_000))).toMatchObject({
      alongTrackFt: expect.closeTo(2_000, 3),
      crossTrackFt: expect.closeTo(0, 3),
    });
    expect(projectToRunwayFrame(a, runwayPoint(a, 1_000, 25))).toMatchObject({
      alongTrackFt: expect.closeTo(1_000, 2),
      crossTrackFt: expect.closeTo(25, 2),
    });
    expect(permittedRunwayLimits(a)).toEqual({ startFt: 300, endFt: 6_000, halfWidthFt: 50 });
  });

  it("separates permitted direction, surface, touchdown zone, and rollout environment", () => {
    const a = assignment();
    const good = projectToRunwayFrame(a, runwayPoint(a, 1_000, 20));
    expect(isPermittedDirection(a, 89.999)).toBe(true);
    expect(isPermittedDirection(a, 90.001)).toBe(false);
    expect(isOnAssignedSurface(a, good)).toBe(true);
    expect(isInTouchdownZone(a, good)).toBe(true);
    expect(isInRolloutEnvironment(a, good)).toBe(true);
    expect(isOnAssignedSurface(a, projectToRunwayFrame(a, runwayPoint(a, 299)))).toBe(false);
    expect(isOnAssignedSurface(a, projectToRunwayFrame(a, runwayPoint(a, 1_000, 51)))).toBe(false);
    expect(isInTouchdownZone(a, projectToRunwayFrame(a, runwayPoint(a, 2_500)))).toBe(false);
  });

  it("builds a closed surface polygon", () => {
    const polygon = runwaySurfacePolygon(assignment());
    expect(polygon).toHaveLength(5);
    expect(polygon[0]).toEqual(polygon[4]);
  });

  it("takes the short geodesic path across the antimeridian", () => {
    const a = assignment(179.999);
    const frame = projectToRunwayFrame(a, runwayPoint(a, 5_000, -20));
    expect(frame.alongTrackFt).toBeCloseTo(5_000, 2);
    expect(frame.crossTrackFt).toBeCloseTo(-20, 2);
    expect(runwaySurfacePolygon(a).some((point) => point.lonDeg < -179.9)).toBe(true);
  });
});
