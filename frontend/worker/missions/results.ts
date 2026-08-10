import {
  missionChoiceKey,
  type LockedMissionDocument,
} from "../../src/mission/contract";
import {
  evaluateLandingEvidence,
  inspectLandingEvidence,
  type LandingEvaluation,
  type MissionResultRequest,
  type MissionResultView,
} from "../../src/mission/resultPackage";
import type { AssistMode } from "../../src/mission/assists";
import { MISSION_TRACE_TTL_MS } from "../../src/shared/limits";
import { attachMissionTrace, getMissionById } from "../db/missions";
import { finalizeResult, getResultByMissionId } from "../db/results";
import type { AssistLevel, EvidenceStatus, FlightResult, Mission } from "../db/types";
import { ApiHttpError } from "../http/response";
import { verifyMissionReceipt } from "./authorization";

export type FinalizeMissionResultOptions = {
  db: D1Database;
  userId: string;
  missionId: string;
  idempotencyKey: string;
  signingSecret: string;
  now: number;
  uuid: () => string;
  request: MissionResultRequest;
  releaseLease(userId: string, missionId: string): Promise<void>;
  traces?: R2Bucket;
};

type StoredSummary = {
  schemaVersion: 1;
  idempotencyKey: string;
  requestDigest: string;
  failure: MissionResultView["failure"];
  ranked: boolean;
  sampleCount: number;
  scoringVersion: string;
};

function parseLockedDocument(mission: Mission): LockedMissionDocument {
  let document: LockedMissionDocument;
  try {
    document = JSON.parse(mission.adsbSnapshotJson) as LockedMissionDocument;
  } catch (error) {
    throw new ApiHttpError(409, "MISSION_RESULT_INVALID", "Locked mission data is invalid", { cause: error });
  }
  if (
    document.schemaVersion !== 2 || document.preparationId !== mission.id ||
    document.classId !== mission.aircraftClass || !document.assignment || !document.missionProfile ||
    !document.versions || document.versions.scoring !== mission.scoringVersion ||
    document.versions.physics !== mission.physicsVersion ||
    missionChoiceKey(document.assignment) !== `${mission.airportIcao}:${document.assignment.runwayId}:${mission.runwayIdent}`
  ) {
    throw new ApiHttpError(409, "MISSION_RESULT_INVALID", "Locked mission data is inconsistent");
  }
  return document;
}

function sameVersions(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left).sort();
  return keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key]);
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function digestRequest(request: MissionResultRequest): Promise<string> {
  const versionOrder = [
    "airportDataset", "aircraftProfile", "missionProfile", "assignment", "scoring",
    "physics", "assistDefinition",
  ] as const;
  const sampleOrder = [
    "timeMs", "latDeg", "lonDeg", "altitudeFt", "iasKt", "sinkRateFpm", "headingDeg",
    "pitchDeg", "bankDeg", "loadFactor", "gearPosition", "surfaceContact",
  ] as const;
  const canonical = [
    request.schemaVersion,
    request.missionId,
    request.receipt,
    request.choiceKey,
    versionOrder.map((key) => request.versions[key]),
    request.highestAssist,
    request.evidence.schemaVersion,
    request.evidence.sampleIntervalMs,
    request.evidence.samples.map((sample) => sampleOrder.map((key) => sample[key])),
  ];
  const digest = await crypto.subtle.digest("SHA-256", bytes(JSON.stringify(canonical)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function storedAssist(mode: AssistMode): AssistLevel {
  if (mode === "OFF") return "none";
  if (mode === "NAV") return "low";
  return "medium";
}

function publicAssist(level: AssistLevel): AssistMode {
  if (level === "none") return "OFF";
  if (level === "low") return "NAV";
  return "FULL";
}

function summaryFrom(result: FlightResult): StoredSummary {
  try {
    const summary = JSON.parse(result.evidenceSummaryJson) as StoredSummary;
    if (
      summary.schemaVersion !== 1 || typeof summary.idempotencyKey !== "string" ||
      typeof summary.requestDigest !== "string" || typeof summary.ranked !== "boolean"
    ) throw new TypeError("Invalid result summary");
    return summary;
  } catch (error) {
    throw new ApiHttpError(409, "MISSION_RESULT_INVALID", "Stored result summary is invalid", { cause: error });
  }
}

function storedView(result: FlightResult): MissionResultView {
  const summary = summaryFrom(result);
  let measurements: MissionResultView["measurements"] = null;
  try {
    const document = JSON.parse(result.measurementsJson) as { measurements?: MissionResultView["measurements"] };
    measurements = document.measurements ?? null;
  } catch {
    measurements = null;
  }
  return {
    schemaVersion: 1,
    missionId: result.missionId,
    outcome: result.outcome === "landed" || result.outcome === "crashed" ? result.outcome : "invalid",
    failure: summary.failure,
    score: summary.ranked ? result.score / 1_000 : null,
    measurements,
    highestAssist: publicAssist(result.highestAssist),
    evidenceStatus: result.evidenceStatus,
    ranked: summary.ranked,
  };
}

function evaluationFor(
  inspection: ReturnType<typeof inspectLandingEvidence>,
  document: LockedMissionDocument,
  request: MissionResultRequest,
): { evaluation: LandingEvaluation; evidenceStatus: EvidenceStatus } {
  if (inspection === "incomplete") {
    return {
      evaluation: { outcome: "invalid", failure: "EVIDENCE_INCOMPLETE", measurements: null, score: null },
      evidenceStatus: "partial",
    };
  }
  if (inspection === "suspicious") {
    return {
      evaluation: { outcome: "invalid", failure: "EVIDENCE_IMPLAUSIBLE", measurements: null, score: null },
      evidenceStatus: "rejected",
    };
  }
  return {
    evaluation: evaluateLandingEvidence(request.evidence, document.assignment, document.missionProfile),
    evidenceStatus: "verified",
  };
}

async function writeOptionalTrace(
  options: FinalizeMissionResultOptions,
  result: FlightResult,
): Promise<void> {
  if (options.traces === undefined) return;
  const pointer = `landing-traces/${options.missionId}/${result.id}.json`;
  try {
    await options.traces.put(pointer, JSON.stringify(options.request.evidence), {
      httpMetadata: { contentType: "application/json" },
    });
    await attachMissionTrace(
      options.db,
      options.missionId,
      pointer,
      options.now + MISSION_TRACE_TTL_MS,
    );
  } catch {
    // The trace is optional. The bounded D1 result summary remains the durable truth.
  }
}

export async function finalizeAuthoritativeResult(
  options: FinalizeMissionResultOptions,
): Promise<MissionResultView> {
  const mission = await getMissionById(options.db, options.missionId);
  if (mission === null || mission.userId !== options.userId) {
    throw new ApiHttpError(404, "NOT_FOUND", "Mission not found");
  }
  const document = parseLockedDocument(mission);
  const receipt = await verifyMissionReceipt({
    token: options.request.receipt,
    secret: options.signingSecret,
    now: options.now,
  }).catch((error) => {
    throw new ApiHttpError(409, "MISSION_RESULT_INVALID", "Mission receipt is invalid", { cause: error });
  });
  if (
    options.request.missionId !== options.missionId || receipt.missionId !== options.missionId ||
    receipt.aircraftHex !== mission.aircraftHex ||
    receipt.choiceKey !== missionChoiceKey(document.assignment) ||
    options.request.choiceKey !== receipt.choiceKey ||
    !sameVersions(options.request.versions, document.versions) ||
    !sameVersions(receipt.versions, document.versions)
  ) {
    throw new ApiHttpError(409, "MISSION_RESULT_INVALID", "Mission result does not match the lock");
  }

  const requestDigest = await digestRequest(options.request);
  const replay = await getResultByMissionId(options.db, options.missionId);
  if (replay !== null) {
    const summary = summaryFrom(replay);
    if (summary.idempotencyKey !== options.idempotencyKey || summary.requestDigest !== requestDigest) {
      throw new ApiHttpError(409, "MISSION_IDEMPOTENCY_CONFLICT", "Mission already has a different result");
    }
    await options.releaseLease(options.userId, options.missionId).catch(() => undefined);
    return storedView(replay);
  }
  if (mission.status !== "locked" || mission.lockedAt === null) {
    throw new ApiHttpError(409, "MISSION_RESULT_INVALID", "Mission is not open for a result");
  }

  const inspection = inspectLandingEvidence(
    options.request.evidence,
    Math.max(0, options.now - mission.lockedAt),
  );
  const { evaluation, evidenceStatus } = evaluationFor(inspection, document, options.request);
  const ranked = evaluation.outcome === "landed" && evidenceStatus === "verified";
  const summary: StoredSummary = {
    schemaVersion: 1,
    idempotencyKey: options.idempotencyKey,
    requestDigest,
    failure: evaluation.failure,
    ranked,
    sampleCount: options.request.evidence.samples.length,
    scoringVersion: document.versions.scoring,
  };
  const result = await finalizeResult(options.db, {
    id: options.uuid(),
    missionId: options.missionId,
    outcome: evaluation.outcome,
    measurements: {
      schemaVersion: 1,
      measurements: evaluation.measurements,
      components: evaluation.score?.components ?? null,
    },
    score: evaluation.score === null ? 0 : Math.round(evaluation.score.total * 1_000),
    highestAssist: storedAssist(options.request.highestAssist),
    evidenceStatus,
    evidenceSummary: summary,
    createdAt: options.now,
  });
  if (result === null) {
    const raced = await getResultByMissionId(options.db, options.missionId);
    if (raced === null) {
      throw new ApiHttpError(503, "MISSION_COMMIT_FAILED", "Mission result could not be committed");
    }
    const racedSummary = summaryFrom(raced);
    if (racedSummary.idempotencyKey !== options.idempotencyKey || racedSummary.requestDigest !== requestDigest) {
      throw new ApiHttpError(409, "MISSION_IDEMPOTENCY_CONFLICT", "Mission already has a different result");
    }
    await options.releaseLease(options.userId, options.missionId).catch(() => undefined);
    return storedView(raced);
  }

  // Durable finalization is the ordering boundary: only now may capacity be released.
  await options.releaseLease(options.userId, options.missionId).catch(() => undefined);
  await writeOptionalTrace(options, result);
  return storedView(result);
}
