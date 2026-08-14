/*
 * Advisory approach targets for the HUD: the per-class suggested airspeed and the glide-slope
 * altitude band for the current distance-to-threshold. Pure and data-driven — the speed band
 * comes from the mission profile, the altitude band from the shared glide-slope geometry, so it
 * agrees with the HIGH/LOW approach calls. Silent unless the aircraft is on the approach side of
 * the assigned runway and inside the guidance length.
 */
import { assistFeatures, missionNavigationCue, type AssistMode } from "./assists";
import { glidepathToleranceFt, glideSlopeAltitudeFt } from "./guidanceGeometry";
import { projectToRunwayFrame } from "./runwayGeometry";
import type { MissionProfile, RunwayAssignment } from "./types";

const MIN_BAND_DISTANCE_NM = 0.2;

export type ApproachBand = {
  distanceNm: number;
  speed: { targetKt: number; loKt: number; hiKt: number };
  altitude: { targetFt: number; loFt: number; hiFt: number };
};

export function approachBandFor(
  own: { latDeg: number; lonDeg: number },
  assignment: RunwayAssignment,
  profile: MissionProfile,
  assist: AssistMode,
): ApproachBand | null {
  if (!assistFeatures(assist).destinationCue) return null;

  const cue = missionNavigationCue(own, assignment);
  if (cue.distanceNm < MIN_BAND_DISTANCE_NM || cue.distanceNm > profile.guidance.approachLengthNm) {
    return null;
  }

  // Positive along-track is over/past the threshold in the landing direction — no approach band there.
  if (projectToRunwayFrame(assignment, own).alongTrackFt >= 0) return null;

  const { targetSpeedKt, bandKt } = profile.approach;
  const targetFt = glideSlopeAltitudeFt(assignment, profile.guidance, cue.distanceNm);
  const toleranceFt = glidepathToleranceFt(profile.guidance, cue.distanceNm);

  return {
    distanceNm: cue.distanceNm,
    speed: { targetKt: targetSpeedKt, loKt: targetSpeedKt - bandKt, hiKt: targetSpeedKt + bandKt },
    altitude: { targetFt, loFt: targetFt - toleranceFt, hiFt: targetFt + toleranceFt },
  };
}
