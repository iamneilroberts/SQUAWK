/*
 * Actionable approach calls for the compact mobile HUD. These are deliberately not a continuous
 * flight-director score: they stay silent until the aircraft is on the approach side of the
 * assigned runway and inside the configured guidance length. Alignment takes precedence over
 * glidepath so the rail never shouts HIGH + NOT LINED UP at the same time.
 */
import type { HudSnapshot } from "./snapshot";
import { assistFeatures, missionNavigationCue, type AssistMode } from "../mission/assists";
import { headingDeltaDeg } from "../mission/geo";
import { glidepathToleranceFt, glideSlopeAltitudeFt } from "../mission/guidanceGeometry";
import { projectToRunwayFrame } from "../mission/runwayGeometry";
import type { MissionProfile, RunwayAssignment } from "../mission/types";
import { mToFt, radToDeg } from "../sim/units";

const MIN_ALERT_DISTANCE_NM = 0.2;
const ALIGNMENT_ALERT_DISTANCE_NM = 3;
const MAX_HEADING_ERROR_DEG = 20;

export function approachWarningsFor(
  snapshot: HudSnapshot,
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
  assist: AssistMode,
): string[] {
  const features = assistFeatures(assist);
  if (!features.destinationCue) return [];

  const cue = missionNavigationCue(snapshot, assignment);
  if (cue.distanceNm < MIN_ALERT_DISTANCE_NM || cue.distanceNm > guidance.approachLengthNm) {
    return [];
  }

  const frame = projectToRunwayFrame(assignment, snapshot);
  // Approach traffic sits behind the assigned threshold. Positive along-track is over/past it.
  if (frame.alongTrackFt >= 0) return [];

  const headingErrorDeg = headingDeltaDeg(
    radToDeg(snapshot.headingRad),
    assignment.runwayHeadingDeg,
  );
  const crossTrackErrorFt = Math.abs(frame.crossTrackFt);
  const outsideCorridor = crossTrackErrorFt > guidance.corridorWidthFt / 2;
  const badlyAligned = headingErrorDeg > MAX_HEADING_ERROR_DEG;

  if (cue.distanceNm <= ALIGNMENT_ALERT_DISTANCE_NM && (outsideCorridor || badlyAligned)) {
    return ["NOT LINED UP"];
  }

  // A vertical call is useful only with FULL gates and while at least roughly established.
  if (!features.approachCorridor ||
      crossTrackErrorFt > guidance.corridorWidthFt ||
      headingErrorDeg > MAX_HEADING_ERROR_DEG * 2) {
    return [];
  }

  const glidepathErrorFt =
    mToFt(snapshot.altitudeM) - glideSlopeAltitudeFt(assignment, guidance, cue.distanceNm);
  const toleranceFt = glidepathToleranceFt(guidance, cue.distanceNm);

  if (glidepathErrorFt > toleranceFt) return ["HIGH"];
  if (glidepathErrorFt < -toleranceFt) return ["LOW"];
  return [];
}
