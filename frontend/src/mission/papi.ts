/*
 * Real 4-box PAPI (#23): each light flips white/red at its own elevation-angle threshold
 * around the mission's glide slope. World furniture, not an assist — the renderer mounts it
 * at every assist level. Pure: no Cesium, fully table-tested.
 */
import { destinationPoint, greatCircleDistanceNm } from "./geo";
import type { GuidancePoint } from "./guidanceGeometry";
import type { RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;
const LATERAL_CLEARANCE_FT = 50;
const LIGHT_SPACING_FT = 25;

/** Per-light offsets from the glide slope; a light is WHITE above `glideSlopeDeg + offset`. */
export const PAPI_THRESHOLD_OFFSETS_DEG = [-0.5, -0.2, 0.2, 0.5] as const;

function runwayElevationFt(assignment: RunwayAssignment): number {
  return assignment.assignedEnd.elevationFt ?? assignment.airportElevationFt ?? 0;
}

export function papiPosition(assignment: RunwayAssignment): GuidancePoint {
  const leftBearing = assignment.runwayHeadingDeg - 90;
  const offsetNm = (assignment.runwayWidthFt / 2 + LATERAL_CLEARANCE_FT) / FEET_PER_NM;
  const { latDeg, lonDeg } = destinationPoint(
    assignment.assignedEnd.latDeg,
    assignment.assignedEnd.lonDeg,
    leftBearing,
    offsetNm,
  );
  return { latDeg, lonDeg, altitudeFt: runwayElevationFt(assignment) };
}

export function papiLightPositions(assignment: RunwayAssignment): GuidancePoint[] {
  const base = papiPosition(assignment);
  const leftBearing = assignment.runwayHeadingDeg - 90;
  return PAPI_THRESHOLD_OFFSETS_DEG.map((_, index) => {
    const { latDeg, lonDeg } = destinationPoint(
      base.latDeg,
      base.lonDeg,
      leftBearing,
      (index * LIGHT_SPACING_FT) / FEET_PER_NM,
    );
    return { latDeg, lonDeg, altitudeFt: base.altitudeFt };
  });
}

export function papiColors(
  aircraft: { latDeg: number; lonDeg: number; altitudeFt: number },
  papi: GuidancePoint,
  glideSlopeDeg: number,
): [boolean, boolean, boolean, boolean] {
  const horizontalFt =
    greatCircleDistanceNm(aircraft.latDeg, aircraft.lonDeg, papi.latDeg, papi.lonDeg) *
    FEET_PER_NM;
  const angleDeg =
    (Math.atan2(aircraft.altitudeFt - papi.altitudeFt, horizontalFt) * 180) / Math.PI;
  return PAPI_THRESHOLD_OFFSETS_DEG.map(
    (offset) => angleDeg > glideSlopeDeg + offset,
  ) as [boolean, boolean, boolean, boolean];
}
