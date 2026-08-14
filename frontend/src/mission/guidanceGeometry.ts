import { destinationPoint } from "./geo";
import type { MissionProfile, RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

// Half-width of the "on the glide slope" band: the larger of a fixed floor near the
// threshold and a fraction of the glide height far out. Shared by the approach warnings
// (HIGH/LOW) and the approach-band HUD readout so both agree on what "on path" means.
const GLIDEPATH_TOLERANCE_RATIO = 0.18;
const MIN_GLIDEPATH_TOLERANCE_FT = 120;

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

/** Height above the threshold, in feet, of a 3°-ish glide slope at a given distance. */
function glideHeightFt(guidance: MissionProfile["guidance"], distanceNm: number): number {
  return Math.tan((guidance.glideSlopeDeg * Math.PI) / 180) * distanceNm * FEET_PER_NM;
}

/** Absolute MSL altitude (feet) a nominal approach rides at `distanceNm` from the threshold. */
export function glideSlopeAltitudeFt(
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
  distanceNm: number,
): number {
  return runwayElevationFt(assignment) + glideHeightFt(guidance, distanceNm);
}

/** Half-width (feet) of the acceptable altitude band around the glide slope at a distance. */
export function glidepathToleranceFt(
  guidance: MissionProfile["guidance"],
  distanceNm: number,
): number {
  return Math.max(
    MIN_GLIDEPATH_TOLERANCE_FT,
    glideHeightFt(guidance, distanceNm) * GLIDEPATH_TOLERANCE_RATIO,
  );
}

/** Threshold-relative default: the approach flight director (#22) rides this far ahead of the
 *  player toward the threshold. Tunable policy constant — a fixed distance-ahead, not a look-ahead
 *  time — so the guide sits at a legible, speed-independent lead. */
export const DIRECTOR_LEAD_NM = 0.6;

/** The centerline point on the glide slope `distanceNm` back from the threshold, plus the approach
 *  heading (the runway heading — the direction a landing aircraft flies). This is the missing
 *  centerline path the edge/surface helpers above never exposed; altitude reuses the shared
 *  glide-slope helper so the point rides exactly on the gates and flyable surface. */
export function positionAlongApproach(
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
  distanceNm: number,
): { point: GuidancePoint; approachHeadingDeg: number } {
  const threshold = assignment.assignedEnd;
  const outbound = assignment.runwayHeadingDeg + 180;
  const center = destinationPoint(threshold.latDeg, threshold.lonDeg, outbound, distanceNm);
  return {
    point: { ...center, altitudeFt: glideSlopeAltitudeFt(assignment, guidance, distanceNm) },
    approachHeadingDeg: assignment.runwayHeadingDeg,
  };
}

/** Distance-to-threshold the director should sit at: `leadNm` ahead of own-ship (toward the
 *  threshold), clamped to `[0, approachLengthNm]`. Own-ship within the lead distance (at the flare /
 *  over the threshold) clamps to 0, parking the guide at the threshold. */
export function directorDistanceNm(
  ownDistanceNm: number,
  approachLengthNm: number,
  leadNm: number = DIRECTOR_LEAD_NM,
): number {
  return Math.max(0, Math.min(approachLengthNm, ownDistanceNm - leadNm));
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
  const crossSection = (distanceNm: number): GuidanceSegment => {
    const center = destinationPoint(threshold.latDeg, threshold.lonDeg, outbound, distanceNm);
    const altitudeFt = glideSlopeAltitudeFt(assignment, guidance, distanceNm);
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

/**
 * Cross-sections of the flyable glide-slope surface (#24): sampled every gateSpacingNm from
 * the threshold (d=0) out to approachLengthNm, altitude on the same slope the gates mark,
 * width tapering linearly from the assigned runway's width at the threshold to the corridor
 * width at the far end. A missing runway width (not > 0) falls back to the constant corridor
 * width — a real profile value, never a fabricated one.
 */
export function approachSurface(
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
): GuidanceSegment[] {
  const threshold = assignment.assignedEnd;
  const outbound = assignment.runwayHeadingDeg + 180;
  const leftBearing = assignment.runwayHeadingDeg - 90;
  const rightBearing = assignment.runwayHeadingDeg + 90;
  const thresholdWidthFt =
    assignment.runwayWidthFt > 0 ? assignment.runwayWidthFt : guidance.corridorWidthFt;
  const distances: number[] = [];
  for (let d = 0; d < guidance.approachLengthNm - 1e-9; d += guidance.gateSpacingNm) {
    distances.push(d);
  }
  distances.push(guidance.approachLengthNm);
  return distances.map((distanceNm) => {
    const t = distanceNm / guidance.approachLengthNm;
    const widthFt = thresholdWidthFt + (guidance.corridorWidthFt - thresholdWidthFt) * t;
    const halfWidthNm = widthFt / 2 / FEET_PER_NM;
    const altitudeFt = glideSlopeAltitudeFt(assignment, guidance, distanceNm);
    const center = destinationPoint(threshold.latDeg, threshold.lonDeg, outbound, distanceNm);
    return {
      left: point(center, leftBearing, halfWidthNm, altitudeFt),
      right: point(center, rightBearing, halfWidthNm, altitudeFt),
    };
  });
}

/** 4-corner rings between consecutive cross-sections — the renderer draws one polygon each. */
export function surfaceQuads(sections: GuidanceSegment[]): GuidancePoint[][] {
  const quads: GuidancePoint[][] = [];
  for (let i = 0; i + 1 < sections.length; i += 1) {
    quads.push([sections[i].left, sections[i + 1].left, sections[i + 1].right, sections[i].right]);
  }
  return quads;
}
