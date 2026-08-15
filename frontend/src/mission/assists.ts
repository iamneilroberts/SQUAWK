import type { MissionAssistLevel } from "./contract";
import { greatCircleDistanceNm, headingDeltaDeg, initialBearingDeg } from "./geo";
import { finalApproachFix } from "./guidanceGeometry";
import type { MissionProfile, RunwayAssignment } from "./types";

/** Heading delta beyond which the aircraft is crossing the runway, not tracking inbound on it —
 *  matches the compact HUD's own alignment threshold (hud/approachAlerts.ts). */
const MAX_HEADING_ERROR_DEG = 20;

export type AssistMode = "FULL" | "NAV" | "OFF";

export type AssistFeatures = {
  destinationCue: boolean;
  route: boolean;
  runwayHighlight: boolean;
  approachCorridor: boolean;
  glideGates: boolean;
  flareCue: boolean;
};

const RANK: Record<AssistMode, number> = { OFF: 0, NAV: 1, FULL: 2 };

export function assistModeFromPreference(level: MissionAssistLevel): AssistMode {
  if (level === "none") return "OFF";
  if (level === "low") return "NAV";
  // Existing accounts may contain the legacy medium/high values. Both retain the approved
  // FULL-default behavior instead of silently reducing guidance during the migration.
  return "FULL";
}

export function highestAssist(left: AssistMode, right: AssistMode): AssistMode {
  return RANK[left] >= RANK[right] ? left : right;
}

export function assistFeatures(mode: AssistMode): AssistFeatures {
  const navigation = mode !== "OFF";
  const full = mode === "FULL";
  return {
    destinationCue: navigation,
    route: navigation,
    runwayHighlight: navigation,
    approachCorridor: full,
    glideGates: full,
    flareCue: full,
  };
}

export function nextAssistMode(mode: AssistMode): AssistMode {
  if (mode === "FULL") return "NAV";
  if (mode === "NAV") return "OFF";
  return "FULL";
}

export function missionNavigationCue(
  own: { latDeg: number; lonDeg: number },
  assignment: RunwayAssignment,
): { bearingDeg: number; distanceNm: number } {
  return {
    bearingDeg: initialBearingDeg(
      own.latDeg,
      own.lonDeg,
      assignment.assignedEnd.latDeg,
      assignment.assignedEnd.lonDeg,
    ),
    distanceNm: greatCircleDistanceNm(
      own.latDeg,
      own.lonDeg,
      assignment.assignedEnd.latDeg,
      assignment.assignedEnd.lonDeg,
    ),
  };
}

export function finalTurnCue(
  own: { latDeg: number; lonDeg: number; headingDeg: number },
  assignment: RunwayAssignment,
  profile: MissionProfile,
): { bearingDeg: number; distanceNm: number; targetAltFt: number; targetSpeedKt: number } | null {
  const distanceToThresholdNm = greatCircleDistanceNm(
    own.latDeg, own.lonDeg, assignment.assignedEnd.latDeg, assignment.assignedEnd.lonDeg,
  );
  const headingErrorDeg = headingDeltaDeg(own.headingDeg, assignment.runwayHeadingDeg);
  // Established (hand off to the threshold cue + approach band) only once BOTH inside the FAF
  // distance AND tracking within the runway heading — otherwise a plane crossing the corridor at
  // an angle would read as "on final" the instant it nears the centerline distance-wise, even
  // though it still needs to turn to line up.
  if (distanceToThresholdNm <= profile.guidance.finalApproachFixNm && headingErrorDeg <= MAX_HEADING_ERROR_DEG) {
    return null;
  }
  const faf = finalApproachFix(assignment, profile.guidance);
  return {
    bearingDeg: initialBearingDeg(own.latDeg, own.lonDeg, faf.point.latDeg, faf.point.lonDeg),
    distanceNm: greatCircleDistanceNm(own.latDeg, own.lonDeg, faf.point.latDeg, faf.point.lonDeg),
    targetAltFt: faf.altitudeFt,
    targetSpeedKt: profile.approach.targetSpeedKt,
  };
}
