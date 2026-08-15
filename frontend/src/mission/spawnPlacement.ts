import { destinationPoint, initialBearingDeg } from "./geo";
import { finalApproachFix } from "./guidanceGeometry";
import type { MissionProfile, RunwayAssignment } from "./types";

export type Placement = {
  latDeg: number; lonDeg: number; altitudeFt: number; headingDeg: number; speedKt: number;
};

export function onFinalPlacement(assignment: RunwayAssignment, profile: MissionProfile): Placement {
  const faf = finalApproachFix(assignment, profile.guidance);
  return {
    latDeg: faf.point.latDeg,
    lonDeg: faf.point.lonDeg,
    altitudeFt: faf.altitudeFt,
    headingDeg: faf.headingDeg,
    speedKt: profile.approach.targetSpeedKt,
  };
}

export function baseLegPlacement(assignment: RunwayAssignment, profile: MissionProfile): Placement {
  const faf = finalApproachFix(assignment, profile.guidance);
  // A base-leg entry: offset from the FAF along the outbound reciprocal, swung out by the base angle,
  // so that flying toward the FAF and one turn rolls onto final.
  const outbound = faf.headingDeg + 180;
  const entry = destinationPoint(
    faf.point.latDeg, faf.point.lonDeg,
    outbound + profile.guidance.baseLegOffsetDeg,
    profile.guidance.baseLegOffsetNm,
  );
  return {
    latDeg: entry.latDeg,
    lonDeg: entry.lonDeg,
    altitudeFt: faf.altitudeFt,
    headingDeg: initialBearingDeg(entry.latDeg, entry.lonDeg, faf.point.latDeg, faf.point.lonDeg),
    speedKt: profile.approach.targetSpeedKt,
  };
}
