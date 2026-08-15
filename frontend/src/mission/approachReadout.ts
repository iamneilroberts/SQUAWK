/*
 * The prominent approach-guidance readout (owner req 2026-08): one place that answers
 * "am I on course, on speed, on the right sink rate, and how long until I land" at a glance.
 * Pure and data-driven, like approachBand.ts/descentGuidance.ts alongside it — every target
 * and tolerance traces to the RunwayAssignment/MissionProfile or an existing shared geometry
 * helper, never a fabricated number. SI in (feet/knots/fpm are already the profile's units),
 * aviation units only — this module IS the display edge for these numbers, so no further
 * conversion happens in the HUD.
 */
import { greatCircleDistanceNm } from "./geo";
import { glidepathToleranceFt, glideSlopeAltitudeFt } from "./guidanceGeometry";
import { projectToRunwayFrame } from "./runwayGeometry";
import { finalTurnCue } from "./assists";
import type { MissionProfile, RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

/** Descent-rate tolerance either side of the geometric target before calling it STEEP/SHALLOW. */
const SINK_TOLERANCE_FPM = 150;
/** Below this groundspeed, "time to landing" and "target sink rate" are not meaningful. */
const MIN_GROUND_SPEED_KT = 1;

export type AltState = "HIGH" | "LOW" | "ON";
export type SpeedState = "FAST" | "SLOW" | "ON";
export type SinkState = "STEEP" | "SHALLOW" | "ON";
/** Aircraft's position relative to the extended runway centerline, not a steering command. */
export type CourseState = "LEFT" | "RIGHT" | "ON";

export type ApproachReadout = {
  distanceNm: number;
  targetAltFt: number;
  altState: AltState;
  targetSpeedKt: number;
  speedState: SpeedState;
  /** Seconds to the threshold at current groundspeed; null when groundspeed is ~0 (never Infinity). */
  timeToLandingSec: number | null;
  targetSinkRateFpm: number;
  sinkState: SinkState;
  courseState: CourseState;
  /** Heading/distance to the FAF (finalTurnCue passthrough), for the "turn to final" callout
   *  before the aircraft is established — null once inside the FAF distance, where courseState
   *  takes over as the on-course indicator. */
  turnToFinal: { bearingDeg: number; distanceNm: number } | null;
};

export type ApproachReadoutInput = {
  latDeg: number;
  lonDeg: number;
  altitudeFt: number;
  /** Indicated airspeed — approach target speeds are IAS-based, same as the tape-band cue. */
  iasKt: number;
  /** Groundspeed for the distance/time and sink-rate-needed math (still air: TAS === groundspeed). */
  groundSpeedKt: number;
  /** Signed, positive = climbing (matches HudSnapshot.verticalSpeedMs convention). */
  verticalSpeedFpm: number;
};

export function approachReadoutFor(
  own: ApproachReadoutInput,
  assignment: RunwayAssignment,
  profile: MissionProfile,
): ApproachReadout {
  const distanceNm = greatCircleDistanceNm(
    own.latDeg, own.lonDeg, assignment.assignedEnd.latDeg, assignment.assignedEnd.lonDeg,
  );

  const targetAltFt = glideSlopeAltitudeFt(assignment, profile.guidance, distanceNm);
  const altToleranceFt = glidepathToleranceFt(profile.guidance, distanceNm);
  const altDiffFt = own.altitudeFt - targetAltFt;
  const altState: AltState =
    altDiffFt > altToleranceFt ? "HIGH" : altDiffFt < -altToleranceFt ? "LOW" : "ON";

  const { targetSpeedKt, bandKt } = profile.approach;
  const speedDiffKt = own.iasKt - targetSpeedKt;
  const speedState: SpeedState =
    speedDiffKt > bandKt ? "FAST" : speedDiffKt < -bandKt ? "SLOW" : "ON";

  const timeToLandingSec =
    own.groundSpeedKt < MIN_GROUND_SPEED_KT ? null : (distanceNm / own.groundSpeedKt) * 3600;

  // Descent rate that rides the glide slope at the current groundspeed: horizontal speed (ft/min)
  // times the glide-slope angle's tangent. Same geometry glideSlopeAltitudeFt uses, just as a rate.
  const glideSlopeRad = (profile.guidance.glideSlopeDeg * Math.PI) / 180;
  const targetSinkRateFpm = ((own.groundSpeedKt * FEET_PER_NM) / 60) * Math.tan(glideSlopeRad);
  const actualSinkRateFpm = -own.verticalSpeedFpm; // positive = descending
  const sinkDiffFpm = actualSinkRateFpm - targetSinkRateFpm;
  const sinkState: SinkState =
    sinkDiffFpm > SINK_TOLERANCE_FPM ? "STEEP" : sinkDiffFpm < -SINK_TOLERANCE_FPM ? "SHALLOW" : "ON";

  // Tolerance matches the drawn approach corridor's half-width, so this indicator never disagrees
  // with the corridor rails the assist layers already paint.
  const crossTrackFt = projectToRunwayFrame(assignment, own).crossTrackFt;
  const courseToleranceFt = profile.guidance.corridorWidthFt / 2;
  const courseState: CourseState =
    crossTrackFt > courseToleranceFt ? "RIGHT" : crossTrackFt < -courseToleranceFt ? "LEFT" : "ON";

  const turn = finalTurnCue(own, assignment, profile);

  return {
    distanceNm,
    targetAltFt,
    altState,
    targetSpeedKt,
    speedState,
    timeToLandingSec,
    targetSinkRateFpm,
    sinkState,
    courseState,
    turnToFinal: turn ? { bearingDeg: turn.bearingDeg, distanceNm: turn.distanceNm } : null,
  };
}
