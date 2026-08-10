import { headingDeltaDeg } from "./geo";
import type { LandingEvidence } from "./landingEvidence";
import {
  isInRolloutEnvironment,
  isOnAssignedSurface,
  isPermittedDirection,
  permittedRunwayLimits,
  projectToRunwayFrame,
} from "./runwayGeometry";
import type { MissionProfile, RunwayAssignment } from "./types";

export type LandingFailure =
  | "OUTSIDE_ASSIGNED_SURFACE"
  | "WRONG_LANDING_DIRECTION"
  | "GEAR_NOT_DOWN"
  | "SINK_RATE_EXCEEDED"
  | "BANK_EXCEEDED"
  | "ATTITUDE_EXCEEDED"
  | "SPEED_OUT_OF_RANGE"
  | "STRUCTURAL_LOAD_EXCEEDED"
  | "ROLLOUT_UNCONTROLLED";

export type LandingMeasurements = {
  sinkRateFpm: number;
  centerlineErrorFt: number;
  touchdownDistanceFt: number;
  headingErrorDeg: number;
  speedErrorKt: number;
  bankDeg: number;
  pitchDeg: number;
  touchdownSpeedKt: number;
  maxAbsLoadFactor: number;
  gearPosition: number;
  rolloutCrossTrackFt: number;
};

export type PassedLandingSafety = {
  passed: true;
  failure: null;
  measurements: LandingMeasurements;
};

export type FailedLandingSafety = {
  passed: false;
  failure: LandingFailure;
  measurements: LandingMeasurements;
};

export type LandingSafetyResult = PassedLandingSafety | FailedLandingSafety;

export function landingMeasurements(
  evidence: LandingEvidence,
  assignment: RunwayAssignment,
  profile: MissionProfile,
): LandingMeasurements | null {
  const touchdown = evidence.samples.at(-1);
  if (touchdown === undefined) return null;
  const touchdownFrame = projectToRunwayFrame(assignment, touchdown);
  const limits = permittedRunwayLimits(assignment);
  const runwayElevationFt = assignment.assignedEnd.elevationFt ?? assignment.airportElevationFt ?? 0;
  const rolloutFrames = evidence.samples
    .filter((sample) => sample.altitudeFt <= runwayElevationFt + 100)
    .map((sample) => projectToRunwayFrame(assignment, sample))
    .filter((frame) => isInRolloutEnvironment(assignment, frame));
  const rolloutCrossTrackFt = Math.max(
    Math.abs(touchdownFrame.crossTrackFt),
    ...rolloutFrames.map((frame) => Math.abs(frame.crossTrackFt)),
  );
  const targetSpeedKt = (
    profile.landing.minTouchdownSpeedKt + profile.landing.maxTouchdownSpeedKt
  ) / 2;
  return {
    sinkRateFpm: touchdown.sinkRateFpm,
    centerlineErrorFt: Math.abs(touchdownFrame.crossTrackFt),
    touchdownDistanceFt: Math.max(0, touchdownFrame.alongTrackFt - limits.startFt),
    headingErrorDeg: headingDeltaDeg(touchdown.headingDeg, assignment.runwayHeadingDeg),
    speedErrorKt: Math.abs(touchdown.iasKt - targetSpeedKt),
    bankDeg: Math.abs(touchdown.bankDeg),
    pitchDeg: touchdown.pitchDeg,
    touchdownSpeedKt: touchdown.iasKt,
    maxAbsLoadFactor: Math.max(...evidence.samples.map((sample) => Math.abs(sample.loadFactor))),
    gearPosition: touchdown.gearPosition,
    rolloutCrossTrackFt,
  };
}

export function checkLandingSafety(
  evidence: LandingEvidence,
  assignment: RunwayAssignment,
  profile: MissionProfile,
): LandingSafetyResult | null {
  const measurements = landingMeasurements(evidence, assignment, profile);
  const touchdown = evidence.samples.at(-1);
  if (measurements === null || touchdown === undefined) return null;
  const frame = projectToRunwayFrame(assignment, touchdown);

  let failure: LandingFailure | null = null;
  if (!isOnAssignedSurface(assignment, frame)) failure = "OUTSIDE_ASSIGNED_SURFACE";
  else if (!isPermittedDirection(assignment, measurements.headingErrorDeg)) {
    failure = "WRONG_LANDING_DIRECTION";
  } else if (profile.landing.requireGearDown && measurements.gearPosition < 0.95) {
    failure = "GEAR_NOT_DOWN";
  } else if (measurements.sinkRateFpm > profile.landing.maxSinkRateFpm) {
    failure = "SINK_RATE_EXCEEDED";
  } else if (measurements.bankDeg > profile.landing.maxAbsBankDeg) {
    failure = "BANK_EXCEEDED";
  } else if (
    measurements.pitchDeg < profile.landing.minPitchDeg ||
    measurements.pitchDeg > profile.landing.maxPitchDeg
  ) {
    failure = "ATTITUDE_EXCEEDED";
  } else if (
    measurements.touchdownSpeedKt < profile.landing.minTouchdownSpeedKt ||
    measurements.touchdownSpeedKt > profile.landing.maxTouchdownSpeedKt
  ) {
    failure = "SPEED_OUT_OF_RANGE";
  } else if (measurements.maxAbsLoadFactor > profile.landing.maxLoadFactor) {
    failure = "STRUCTURAL_LOAD_EXCEEDED";
  } else if (measurements.rolloutCrossTrackFt > profile.landing.maxRolloutCrossTrackFt) {
    failure = "ROLLOUT_UNCONTROLLED";
  }

  return failure === null
    ? { passed: true, failure: null, measurements }
    : { passed: false, failure, measurements };
}
