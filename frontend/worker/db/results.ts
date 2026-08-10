import {
  JSON_BYTE_LIMITS,
  changed,
  requireInteger,
  requireOneOf,
  requireStored,
  requireTimestamp,
  requireUuid,
  serializeVersionedJson,
} from "./client";
import type {
  AssistLevel,
  EvidenceStatus,
  FinalizeResultInput,
  FlightOutcome,
  FlightResult,
} from "./types";

const OUTCOMES: readonly FlightOutcome[] = [
  "landed",
  "crashed",
  "aborted",
  "invalid",
];
const ASSIST_LEVELS: readonly AssistLevel[] = ["none", "low", "medium", "high"];
const EVIDENCE_STATUSES: readonly EvidenceStatus[] = [
  "verified",
  "partial",
  "rejected",
];

type ResultRow = {
  id: string;
  mission_id: string;
  outcome: FlightOutcome;
  measurements_json: string;
  score: number;
  highest_assist: AssistLevel;
  evidence_status: EvidenceStatus;
  evidence_summary_json: string;
  created_at: number;
};

const SELECT_RESULT = `SELECT id, mission_id, outcome, measurements_json, score,
                              highest_assist, evidence_status, evidence_summary_json,
                              created_at
                         FROM flight_results`;

function mapResult(row: ResultRow): FlightResult {
  return {
    id: row.id,
    missionId: row.mission_id,
    outcome: row.outcome,
    measurementsJson: row.measurements_json,
    score: row.score,
    highestAssist: row.highest_assist,
    evidenceStatus: row.evidence_status,
    evidenceSummaryJson: row.evidence_summary_json,
    createdAt: row.created_at,
  };
}

export async function finalizeResult(
  db: D1Database,
  input: FinalizeResultInput,
): Promise<FlightResult | null> {
  const id = requireUuid("result id", input.id);
  const missionId = requireUuid("mission id", input.missionId);
  const outcome = requireOneOf("flight outcome", input.outcome, OUTCOMES);
  const measurements = serializeVersionedJson(
    "measurements",
    input.measurements,
    JSON_BYTE_LIMITS.measurements,
  );
  const score = requireInteger("score", input.score, 0, 1_000_000);
  const highestAssist = requireOneOf(
    "highest assist",
    input.highestAssist,
    ASSIST_LEVELS,
  );
  const evidenceStatus = requireOneOf(
    "evidence status",
    input.evidenceStatus,
    EVIDENCE_STATUSES,
  );
  const evidenceSummary = serializeVersionedJson(
    "evidence summary",
    input.evidenceSummary,
    JSON_BYTE_LIMITS.evidence,
  );
  const createdAt = requireTimestamp("created at", input.createdAt);

  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO flight_results
           (id, mission_id, outcome, measurements_json, score, highest_assist,
            evidence_status, evidence_summary_json, created_at)
         SELECT ?, id, ?, ?, ?, ?, ?, ?, ?
           FROM missions
          WHERE id = ? AND status = 'locked' AND locked_at <= ?`,
      )
      .bind(
        id,
        outcome,
        measurements,
        score,
        highestAssist,
        evidenceStatus,
        evidenceSummary,
        createdAt,
        missionId,
        createdAt,
      ),
    db
      .prepare(
        `UPDATE missions
            SET status = 'finalized', finalized_at = ?
          WHERE id = ? AND status = 'locked'
            AND EXISTS (SELECT 1 FROM flight_results WHERE id = ? AND mission_id = ?)`,
      )
      .bind(createdAt, missionId, id, missionId),
  ]);

  if (!changed(insert)) return null;
  return requireStored(
    "finalized result",
    await getResultByMissionId(db, missionId),
  );
}

export async function getResultByMissionId(
  db: D1Database,
  missionId: string,
): Promise<FlightResult | null> {
  const row = await db
    .prepare(`${SELECT_RESULT} WHERE mission_id = ?`)
    .bind(requireUuid("mission id", missionId))
    .first<ResultRow>();
  return row === null ? null : mapResult(row);
}
