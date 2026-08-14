/*
 * At-range descent advisory: while still outside the approach (beyond approachLengthNm) but within
 * useful range of the destination, advise the altitude to be at by the approach entry (the top of
 * the glide slope) and the descent rate to get there at the current groundspeed. Hands off to the
 * approach band (mission/approachBand.ts) once inside the approach length. Pure and data-driven.
 */
import { assistFeatures, missionNavigationCue, type AssistMode } from "./assists";
import { glideSlopeAltitudeFt } from "./guidanceGeometry";
import type { MissionProfile, RunwayAssignment } from "./types";

/** Beyond this, the destination is too far for a descent to be actionable — stay silent. */
const MAX_GUIDANCE_NM = 40;
/** Altitude margin (ft) above target within which we call it "on profile" rather than nag a descent. */
const ON_PROFILE_MARGIN_FT = 100;

export type DescentGuidance = {
  distanceNm: number;
  targetAltitudeFt: number;
  descentRateFpm: number;
  onProfile: boolean;
  targetSpeedKt: number;
};

export function descentGuidanceFor(
  own: { latDeg: number; lonDeg: number; altitudeFt: number; groundSpeedKt: number },
  assignment: RunwayAssignment,
  profile: MissionProfile,
  assist: AssistMode,
): DescentGuidance | null {
  if (!assistFeatures(assist).destinationCue) return null;

  const distanceNm = missionNavigationCue(own, assignment).distanceNm;
  const approachLengthNm = profile.guidance.approachLengthNm;
  // Inside the approach the band owns speed/altitude; beyond MAX it is not yet actionable.
  if (distanceNm <= approachLengthNm || distanceNm > MAX_GUIDANCE_NM) return null;

  // Be at the top of the glide slope (the approach entry) by the time you reach the approach.
  const targetAltitudeFt = glideSlopeAltitudeFt(assignment, profile.guidance, approachLengthNm);
  const toDescendFt = own.altitudeFt - targetAltitudeFt;
  if (toDescendFt <= ON_PROFILE_MARGIN_FT) {
    return {
      distanceNm,
      targetAltitudeFt,
      descentRateFpm: 0,
      onProfile: true,
      targetSpeedKt: profile.reachability.defaultPlanningSpeedKt,
    };
  }

  const distanceToEntryNm = distanceNm - approachLengthNm;
  // Guard a stopped/near-stopped groundspeed so the rate stays finite.
  const minutesToEntry = Math.max(0.1, (distanceToEntryNm / Math.max(1, own.groundSpeedKt)) * 60);
  const descentRateFpm = Math.round(toDescendFt / minutesToEntry);

  return {
    distanceNm,
    targetAltitudeFt,
    descentRateFpm,
    onProfile: false,
    targetSpeedKt: profile.reachability.defaultPlanningSpeedKt,
  };
}
