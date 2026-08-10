import { destinationPoint } from "./geo";
import type { MissionProfile, RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

export type GuidancePoint = { latDeg: number; lonDeg: number; altitudeFt: number };
export type GuidanceSegment = { left: GuidancePoint; right: GuidancePoint };

function point(
  origin: { latDeg: number; lonDeg: number },
  bearingDeg: number,
  distanceNm: number,
  altitudeFt: number,
): GuidancePoint {
  return { ...destinationPoint(origin.latDeg, origin.lonDeg, bearingDeg, distanceNm), altitudeFt };
}

function runwayElevationFt(assignment: RunwayAssignment): number {
  return assignment.assignedEnd.elevationFt ?? assignment.airportElevationFt ?? 0;
}

export function runwayOutline(assignment: RunwayAssignment): GuidancePoint[] {
  const threshold = assignment.assignedEnd;
  const elevationFt = runwayElevationFt(assignment);
  const halfWidthNm = assignment.runwayWidthFt / 2 / FEET_PER_NM;
  const lengthNm = assignment.runwayLengthFt / FEET_PER_NM;
  const far = destinationPoint(
    threshold.latDeg,
    threshold.lonDeg,
    assignment.runwayHeadingDeg,
    lengthNm,
  );
  const leftBearing = assignment.runwayHeadingDeg - 90;
  const rightBearing = assignment.runwayHeadingDeg + 90;
  const nearLeft = point(threshold, leftBearing, halfWidthNm, elevationFt);
  const nearRight = point(threshold, rightBearing, halfWidthNm, elevationFt);
  const farLeft = point(far, leftBearing, halfWidthNm, elevationFt);
  const farRight = point(far, rightBearing, halfWidthNm, elevationFt);
  return [nearLeft, farLeft, farRight, nearRight, nearLeft];
}

export function approachGuidance(
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
): {
  corridorEdges: [GuidanceSegment, GuidanceSegment];
  gates: GuidanceSegment[];
  flare: GuidancePoint;
} {
  const threshold = assignment.assignedEnd;
  const elevationFt = runwayElevationFt(assignment);
  const outbound = assignment.runwayHeadingDeg + 180;
  const halfWidthNm = guidance.corridorWidthFt / 2 / FEET_PER_NM;
  const leftBearing = assignment.runwayHeadingDeg - 90;
  const rightBearing = assignment.runwayHeadingDeg + 90;
  const altitudeAt = (distanceNm: number) =>
    elevationFt + Math.tan(guidance.glideSlopeDeg * Math.PI / 180) * distanceNm * FEET_PER_NM;
  const crossSection = (distanceNm: number): GuidanceSegment => {
    const center = destinationPoint(threshold.latDeg, threshold.lonDeg, outbound, distanceNm);
    const altitudeFt = altitudeAt(distanceNm);
    return {
      left: point(center, leftBearing, halfWidthNm, altitudeFt),
      right: point(center, rightBearing, halfWidthNm, altitudeFt),
    };
  };
  const near = crossSection(0);
  const far = crossSection(guidance.approachLengthNm);
  const gates: GuidanceSegment[] = [];
  for (
    let distanceNm = guidance.gateSpacingNm;
    distanceNm <= guidance.approachLengthNm + 1e-9;
    distanceNm += guidance.gateSpacingNm
  ) {
    gates.push(crossSection(Math.min(distanceNm, guidance.approachLengthNm)));
  }
  const flareDistanceNm =
    guidance.flareHeightFt /
    Math.tan(guidance.glideSlopeDeg * Math.PI / 180) /
    FEET_PER_NM;
  return {
    corridorEdges: [
      { left: near.left, right: far.left },
      { left: near.right, right: far.right },
    ],
    gates,
    flare: point(
      threshold,
      outbound,
      flareDistanceNm,
      elevationFt + guidance.flareHeightFt,
    ),
  };
}
