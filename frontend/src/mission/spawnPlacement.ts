import { destinationPoint, initialBearingDeg } from "./geo";
import { finalApproachFix } from "./guidanceGeometry";
import type { MissionProfile, RunwayAssignment } from "./types";

export type Placement = {
  latDeg: number; lonDeg: number; altitudeFt: number; headingDeg: number; speedKt: number;
  verticalRateFpm: number;
};

export function onFinalPlacement(assignment: RunwayAssignment, profile: MissionProfile): Placement {
  const faf = finalApproachFix(assignment, profile.guidance);
  // On-slope descent rate: the sink rate that holds a -glideSlopeDeg flight-path angle at
  // approach speed (101.269 converts kt to ft/min). Negative = descending.
  const verticalRateFpm =
    -(profile.approach.targetSpeedKt * 101.269) * Math.sin(profile.guidance.glideSlopeDeg * Math.PI / 180);
  return {
    latDeg: faf.point.latDeg,
    lonDeg: faf.point.lonDeg,
    altitudeFt: faf.altitudeFt,
    headingDeg: faf.headingDeg,
    speedKt: profile.approach.targetSpeedKt,
    verticalRateFpm,
  };
}

/**
 * Maps an `onFinalPlacement` result onto `buildLockedMissionSpawn`'s override opts (#87): the
 * shape a "put the SIM aircraft on a stabilized final" reposition needs, whether that happens
 * before the flight starts (spawn chooser's "final" mode) or mid-flight (SKIP TO FINAL). Gear
 * down + landing flaps, same as any other stabilized-final spawn — an aircraft on short final
 * flying clean would be an obviously wrong "stabilized" claim.
 */
export function finalApproachSpawnOverrides(
  place: Placement,
  landingFlapDetentIndex: number,
): {
  spawnPositionOverride: { latDeg: number; lonDeg: number };
  spawnAltitudeFtOverride: number;
  spawnSpeedKtOverride: number;
  spawnVerticalRateFpmOverride: number;
  spawnHeadingDeg: number;
  initialGearDown: true;
  initialFlapDetent: number;
} {
  return {
    spawnPositionOverride: { latDeg: place.latDeg, lonDeg: place.lonDeg },
    spawnAltitudeFtOverride: place.altitudeFt,
    spawnSpeedKtOverride: place.speedKt,
    spawnVerticalRateFpmOverride: place.verticalRateFpm,
    spawnHeadingDeg: place.headingDeg,
    initialGearDown: true,
    initialFlapDetent: landingFlapDetentIndex,
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
    // Level on base leg — still maneuvering toward final, not yet on the glideslope.
    verticalRateFpm: 0,
  };
}
