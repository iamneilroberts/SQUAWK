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

/** The final approach fix (FAF): the centerline point on the glide slope at
 *  `guidance.finalApproachFixNm` back from the threshold. */
export function finalApproachFix(
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
): { point: GuidancePoint; headingDeg: number; altitudeFt: number } {
  const { point, approachHeadingDeg } = positionAlongApproach(assignment, guidance, guidance.finalApproachFixNm);
  return { point, headingDeg: approachHeadingDeg, altitudeFt: point.altitudeFt };
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

/**
 * Fixed, world-anchored ribbon (Feature 2): a single continuous tapering strip along the
 * curved 3-point approach path base-leg entry -> FAF -> threshold — the same fixed points
 * spawnPlacement.baseLegPlacement/onFinalPlacement use, never the live aircraft position, so
 * the ribbon never swings frame to frame. Two straight tapering segments (mirroring
 * approachSurface's sampling) share one cross-section at the FAF, which is the dogleg bend:
 * - threshold -> FAF: on the glide slope (glideSlopeAltitudeFt), perpendicular to the runway
 *   heading — identical math to approachSurface, just to finalApproachFixNm instead of
 *   approachLengthNm (the FAF is normally beyond the old surface's far edge).
 * - FAF -> base-leg entry: level at the FAF's altitude (matches baseLegPlacement's level base
 *   leg, verticalRateFpm 0), perpendicular to the base-leg bearing (outbound + baseLegOffsetDeg).
 * Width tapers linearly across the FULL path length (threshold..base-entry) from the runway
 * width (0 at threshold) to guidance.corridorWidthFt (1 at the base-entry far end), so the FAF
 * sits at an intermediate width — the taper doesn't reset at the bend.
 */
export function approachRibbon(
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
): GuidanceSegment[] {
  const threshold = assignment.assignedEnd;
  const outbound = assignment.runwayHeadingDeg + 180;
  const thresholdWidthFt =
    assignment.runwayWidthFt > 0 ? assignment.runwayWidthFt : guidance.corridorWidthFt;
  const faf = finalApproachFix(assignment, guidance);
  const legHeadingDeg = faf.headingDeg + 180 + guidance.baseLegOffsetDeg;
  const totalLengthNm = guidance.finalApproachFixNm + guidance.baseLegOffsetNm;

  const crossSection = (
    center: { latDeg: number; lonDeg: number },
    headingDeg: number,
    alongTrackNm: number,
    altitudeFt: number,
  ): GuidanceSegment => {
    const t = totalLengthNm > 0 ? alongTrackNm / totalLengthNm : 0;
    const widthFt = thresholdWidthFt + (guidance.corridorWidthFt - thresholdWidthFt) * t;
    const halfWidthNm = widthFt / 2 / FEET_PER_NM;
    return {
      left: point(center, headingDeg - 90, halfWidthNm, altitudeFt),
      right: point(center, headingDeg + 90, halfWidthNm, altitudeFt),
    };
  };

  // Segment 1: threshold (0) -> FAF (finalApproachFixNm), on the glide slope.
  const finalDistances: number[] = [];
  for (let d = 0; d < guidance.finalApproachFixNm - 1e-9; d += guidance.gateSpacingNm) {
    finalDistances.push(d);
  }
  finalDistances.push(guidance.finalApproachFixNm);
  const finalSections = finalDistances.map((distanceNm) =>
    crossSection(
      destinationPoint(threshold.latDeg, threshold.lonDeg, outbound, distanceNm),
      assignment.runwayHeadingDeg,
      distanceNm,
      glideSlopeAltitudeFt(assignment, guidance, distanceNm),
    ),
  );

  // Segment 2: FAF -> base-leg entry (baseLegOffsetNm beyond it), level at FAF altitude —
  // the last finalDistances entry (exactly at the FAF) is the shared bend vertex, so this
  // segment starts just past it and never duplicates that cross-section.
  const baseDistances: number[] = [];
  for (let d = guidance.gateSpacingNm; d < guidance.baseLegOffsetNm - 1e-9; d += guidance.gateSpacingNm) {
    baseDistances.push(d);
  }
  if (guidance.baseLegOffsetNm > 1e-9) baseDistances.push(guidance.baseLegOffsetNm);
  const baseSections = baseDistances.map((distanceFromFafNm) =>
    crossSection(
      destinationPoint(faf.point.latDeg, faf.point.lonDeg, legHeadingDeg, distanceFromFafNm),
      legHeadingDeg,
      guidance.finalApproachFixNm + distanceFromFafNm,
      faf.altitudeFt,
    ),
  );

  return [...finalSections, ...baseSections];
}

/**
 * Edge rails + gates (owner decision 2026-08-15, replaces the flat translucent corridor
 * surface — edge-on from the cockpit it read as a faint fan, unusable). Reuses approachRibbon's
 * curved, tapering cross-sections (base-leg entry -> FAF -> threshold, the dogleg the player
 * turns onto) so the rails, gates, and the ribbon fill (kept as a pure function, no longer
 * rendered) all agree exactly on where the corridor sits. `leftRail`/`rightRail` are the full
 * dense point lists (smooth through the FAF bend); `gates` is an evenly-spaced subset — a few
 * fly-through cross-sections, not one at every ribbon sample — skipping the threshold itself
 * (index 0), since a gate at touchdown is redundant with landing.
 */
export function approachRails(
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
  gateCount = 5,
): { leftRail: GuidancePoint[]; rightRail: GuidancePoint[]; gates: GuidanceSegment[] } {
  const sections = approachRibbon(assignment, guidance);
  const usable = sections.length - 1;
  const gates: GuidanceSegment[] = [];
  for (let i = 1; i <= gateCount && usable > 0; i += 1) {
    gates.push(sections[Math.round((i * usable) / gateCount)]);
  }
  return {
    leftRail: sections.map((section) => section.left),
    rightRail: sections.map((section) => section.right),
    gates,
  };
}

/** 4-corner rings between consecutive cross-sections — the renderer draws one polygon each. */
export function surfaceQuads(sections: GuidanceSegment[]): GuidancePoint[][] {
  const quads: GuidancePoint[][] = [];
  for (let i = 0; i + 1 < sections.length; i += 1) {
    quads.push([sections[i].left, sections[i + 1].left, sections[i + 1].right, sections[i].right]);
  }
  return quads;
}
