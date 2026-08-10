import type { LockedMissionView, MissionVersionSet } from "./contract";
import { greatCircleDistanceNm, headingDeltaDeg } from "./geo";
import {
  encodedEvidenceBytes,
  LANDING_EVIDENCE_MAX_BYTES,
  LANDING_EVIDENCE_MAX_SAMPLES,
  LANDING_EVIDENCE_SAMPLE_INTERVAL_MS,
  type LandingEvidence,
  type LandingEvidenceSample,
} from "./landingEvidence";
import { checkLandingSafety, type LandingFailure, type LandingMeasurements } from "./landingSafety";
import { scoreLanding, type LandingScore } from "./landingScore";
import type { AssistMode } from "./assists";
import type { MissionProfile, RunwayAssignment } from "./types";
import { MISSION_RESULT_BODY_MAX_BYTES } from "../shared/limits";

export type EvidenceFailure = "EVIDENCE_INCOMPLETE" | "EVIDENCE_IMPLAUSIBLE";

export type LandingEvaluation =
  | {
      outcome: "landed";
      failure: null;
      measurements: LandingMeasurements;
      score: LandingScore;
    }
  | {
      outcome: "crashed";
      failure: LandingFailure;
      measurements: LandingMeasurements;
      score: null;
    }
  | {
      outcome: "invalid";
      failure: EvidenceFailure;
      measurements: null;
      score: null;
    };

export type MissionResultRequest = {
  schemaVersion: 1;
  missionId: string;
  receipt: string;
  choiceKey: string;
  versions: MissionVersionSet;
  highestAssist: AssistMode;
  evidence: LandingEvidence;
};

export type MissionResultView = {
  schemaVersion: 1;
  missionId: string;
  outcome: LandingEvaluation["outcome"];
  failure: LandingFailure | EvidenceFailure | null;
  score: number | null;
  measurements: LandingMeasurements | null;
  highestAssist: AssistMode;
  evidenceStatus: "verified" | "partial" | "rejected";
  ranked: boolean;
};

export function evaluateLandingEvidence(
  evidence: LandingEvidence,
  assignment: RunwayAssignment,
  profile: MissionProfile,
): LandingEvaluation {
  if (evidence.samples.length === 0 || !evidence.samples.at(-1)?.surfaceContact) {
    return { outcome: "invalid", failure: "EVIDENCE_INCOMPLETE", measurements: null, score: null };
  }
  const safety = checkLandingSafety(evidence, assignment, profile);
  if (safety === null) {
    return { outcome: "invalid", failure: "EVIDENCE_INCOMPLETE", measurements: null, score: null };
  }
  if (!safety.passed) {
    return {
      outcome: "crashed",
      failure: safety.failure,
      measurements: safety.measurements,
      score: null,
    };
  }
  return {
    outcome: "landed",
    failure: null,
    measurements: safety.measurements,
    score: scoreLanding(safety, profile),
  };
}

export function buildMissionResultPackage(options: {
  mission: LockedMissionView;
  evidence: LandingEvidence;
  highestAssist: AssistMode;
}): { request: MissionResultRequest; preview: LandingEvaluation } {
  const request: MissionResultRequest = {
    schemaVersion: 1,
    missionId: options.mission.missionId,
    receipt: options.mission.receipt,
    choiceKey: `${options.mission.assignment.airportIdent}:${options.mission.assignment.runwayId}:${options.mission.assignment.runwayEndIdent}`,
    versions: options.mission.versions,
    highestAssist: options.highestAssist,
    evidence: options.evidence,
  };
  if (encodedResultRequestBytes(request) > MISSION_RESULT_BODY_MAX_BYTES) {
    throw new RangeError("Mission result exceeds the encoded request limit");
  }
  return {
    request,
    preview: evaluateLandingEvidence(
      options.evidence,
      options.mission.assignment,
      options.mission.missionProfile,
    ),
  };
}

export function encodedResultRequestBytes(request: MissionResultRequest): number {
  return new TextEncoder().encode(JSON.stringify(request)).byteLength;
}

const SAMPLE_KEYS = [
  "timeMs", "latDeg", "lonDeg", "altitudeFt", "iasKt", "sinkRateFpm", "headingDeg",
  "pitchDeg", "bankDeg", "loadFactor", "gearPosition", "surfaceContact",
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validSample(value: unknown): value is LandingEvidenceSample {
  if (!record(value) || !exactKeys(value, SAMPLE_KEYS)) return false;
  return Number.isSafeInteger(value.timeMs) && boundedNumber(value.timeMs, 0, 24 * 60 * 60 * 1_000) &&
    boundedNumber(value.latDeg, -90, 90) && boundedNumber(value.lonDeg, -180, 180) &&
    boundedNumber(value.altitudeFt, -2_000, 100_000) && boundedNumber(value.iasKt, 0, 1_500) &&
    boundedNumber(value.sinkRateFpm, -20_000, 20_000) && boundedNumber(value.headingDeg, 0, 360) &&
    boundedNumber(value.pitchDeg, -90, 90) && boundedNumber(value.bankDeg, -180, 180) &&
    boundedNumber(value.loadFactor, -10, 20) && boundedNumber(value.gearPosition, 0, 1) &&
    typeof value.surfaceContact === "boolean";
}

export function isLandingEvidence(value: unknown): value is LandingEvidence {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "sampleIntervalMs", "samples"])) return false;
  if (
    value.schemaVersion !== 1 || value.sampleIntervalMs !== LANDING_EVIDENCE_SAMPLE_INTERVAL_MS ||
    !Array.isArray(value.samples) || value.samples.length > LANDING_EVIDENCE_MAX_SAMPLES ||
    !value.samples.every(validSample)
  ) return false;
  return encodedEvidenceBytes(value as LandingEvidence) <= LANDING_EVIDENCE_MAX_BYTES;
}

export type EvidenceInspection = "complete" | "incomplete" | "suspicious";

export function inspectLandingEvidence(
  evidence: LandingEvidence,
  maxElapsedMs: number,
): EvidenceInspection {
  const samples = evidence.samples;
  if (samples.length < 2 || !samples.at(-1)?.surfaceContact) return "incomplete";
  if (samples.slice(0, -1).some((sample) => sample.surfaceContact)) return "suspicious";
  if (samples.at(-1)!.timeMs > maxElapsedMs + 5_000) return "suspicious";
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const elapsedMs = current.timeMs - previous.timeMs;
    const terminalInterval = index === samples.length - 1;
    if (
      terminalInterval
        ? elapsedMs < 10 || elapsedMs > 110
        : elapsedMs < 95 || elapsedMs > 105
    ) return "suspicious";
    const distanceNm = greatCircleDistanceNm(
      previous.latDeg, previous.lonDeg, current.latDeg, current.lonDeg,
    );
    const speedKt = distanceNm / (elapsedMs / 3_600_000);
    if (speedKt > 1_500) return "suspicious";
    if (headingDeltaDeg(previous.headingDeg, current.headingDeg) > 90) return "suspicious";
  }
  return "complete";
}
