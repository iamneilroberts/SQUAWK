import {
  EARTH_RADIUS_NM,
  degToRad,
  destinationPoint,
  greatCircleDistanceNm,
  initialBearingDeg,
} from "./geo";
import type { RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

export type RunwayFramePoint = {
  /** Feet from the assigned physical threshold in the permitted landing direction. */
  alongTrackFt: number;
  /** Feet right of the assigned runway centerline. */
  crossTrackFt: number;
};

export type RunwayGeoPoint = { latDeg: number; lonDeg: number };

export function projectToRunwayFrame(
  assignment: RunwayAssignment,
  point: RunwayGeoPoint,
): RunwayFramePoint {
  const threshold = assignment.assignedEnd;
  const distanceNm = greatCircleDistanceNm(
    threshold.latDeg,
    threshold.lonDeg,
    point.latDeg,
    point.lonDeg,
  );
  if (distanceNm === 0) return { alongTrackFt: 0, crossTrackFt: 0 };

  const angularDistance = distanceNm / EARTH_RADIUS_NM;
  const bearingDelta = degToRad(
    initialBearingDeg(threshold.latDeg, threshold.lonDeg, point.latDeg, point.lonDeg) -
      assignment.runwayHeadingDeg,
  );
  const crossAngular = Math.asin(
    Math.max(-1, Math.min(1, Math.sin(angularDistance) * Math.sin(bearingDelta))),
  );
  const alongAngular = Math.atan2(
    Math.sin(angularDistance) * Math.cos(bearingDelta),
    Math.cos(angularDistance),
  );
  return {
    alongTrackFt: alongAngular * EARTH_RADIUS_NM * FEET_PER_NM,
    crossTrackFt: crossAngular * EARTH_RADIUS_NM * FEET_PER_NM,
  };
}

export function permittedRunwayLimits(assignment: RunwayAssignment): {
  startFt: number;
  endFt: number;
  halfWidthFt: number;
} {
  return {
    startFt: Math.max(0, assignment.assignedEnd.displacedThresholdFt ?? 0),
    endFt: assignment.runwayLengthFt,
    halfWidthFt: assignment.runwayWidthFt / 2,
  };
}

export function isOnAssignedSurface(
  assignment: RunwayAssignment,
  frame: RunwayFramePoint,
): boolean {
  const limits = permittedRunwayLimits(assignment);
  return frame.alongTrackFt >= limits.startFt &&
    frame.alongTrackFt <= limits.endFt &&
    Math.abs(frame.crossTrackFt) <= limits.halfWidthFt;
}

/** A landing must point into the assigned runway half-plane, not down the reciprocal end. */
export function isPermittedDirection(
  assignment: RunwayAssignment,
  headingErrorDeg: number,
): boolean {
  void assignment;
  return headingErrorDeg <= 90;
}

export function touchdownZone(assignment: RunwayAssignment): {
  startFt: number;
  endFt: number;
} {
  const limits = permittedRunwayLimits(assignment);
  const usableLengthFt = Math.max(0, limits.endFt - limits.startFt);
  return {
    startFt: limits.startFt,
    // Standard first-third logic, capped at 3,000 ft for long runways.
    endFt: limits.startFt + Math.min(3_000, usableLengthFt / 3),
  };
}

export function isInTouchdownZone(
  assignment: RunwayAssignment,
  frame: RunwayFramePoint,
): boolean {
  const zone = touchdownZone(assignment);
  return isOnAssignedSurface(assignment, frame) &&
    frame.alongTrackFt >= zone.startFt && frame.alongTrackFt <= zone.endFt;
}

/**
 * The simulator currently terminates at first terrain contact. Its rollout evidence is therefore
 * the runway-contained, low-altitude/contact path leading into that contact, bounded by the same
 * physical surface a later ground-roll model can extend without changing this contract.
 */
export function isInRolloutEnvironment(
  assignment: RunwayAssignment,
  frame: RunwayFramePoint,
): boolean {
  return isOnAssignedSurface(assignment, frame);
}

export function runwaySurfacePolygon(assignment: RunwayAssignment): RunwayGeoPoint[] {
  const threshold = assignment.assignedEnd;
  const start = destinationPoint(
    threshold.latDeg,
    threshold.lonDeg,
    assignment.runwayHeadingDeg,
    Math.max(0, threshold.displacedThresholdFt ?? 0) / FEET_PER_NM,
  );
  const end = destinationPoint(
    threshold.latDeg,
    threshold.lonDeg,
    assignment.runwayHeadingDeg,
    assignment.runwayLengthFt / FEET_PER_NM,
  );
  const halfWidthNm = assignment.runwayWidthFt / 2 / FEET_PER_NM;
  const left = assignment.runwayHeadingDeg - 90;
  const right = assignment.runwayHeadingDeg + 90;
  const startLeft = destinationPoint(start.latDeg, start.lonDeg, left, halfWidthNm);
  const startRight = destinationPoint(start.latDeg, start.lonDeg, right, halfWidthNm);
  const endLeft = destinationPoint(end.latDeg, end.lonDeg, left, halfWidthNm);
  const endRight = destinationPoint(end.latDeg, end.lonDeg, right, halfWidthNm);
  return [startLeft, endLeft, endRight, startRight, startLeft];
}
