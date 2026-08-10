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
import type {
  LeaderboardAssist,
  LeaderboardEntry,
  LeaderboardPartition,
} from "../../src/leaderboards/types";
import type {
  ProfileClassStatistic,
  ProfileFlightHistoryEntry,
} from "../../src/profile/results";

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
  // Scores are stored as milli-points so the public 0–100 contract keeps three decimals.
  const score = requireInteger("score", input.score, 0, 100_000);
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

type ProfileHistoryRow = {
  result_id: string;
  mission_id: string;
  created_at: number;
  aircraft_class: ProfileFlightHistoryEntry["classId"];
  outcome: ProfileFlightHistoryEntry["outcome"];
  score: number;
  highest_assist: ProfileFlightHistoryEntry["highestAssist"];
  evidence_status: ProfileFlightHistoryEntry["evidenceStatus"];
  ranked: number;
  failure: string | null;
  scoring_version: string;
};

type ProfileStatisticRow = {
  aircraft_class: ProfileClassStatistic["classId"];
  completed_flights: number;
  successful_landings: number;
  ranked_flights: number;
  best_score: number | null;
  average_score: number | null;
};

export async function listUserResultHistory(
  db: D1Database,
  userId: string,
  limit = 20,
): Promise<ProfileFlightHistoryEntry[]> {
  const rows = await db.prepare(
    `SELECT fr.id AS result_id, fr.mission_id, fr.created_at, m.aircraft_class,
            fr.outcome, fr.score, fr.highest_assist, fr.evidence_status,
            json_extract(fr.evidence_summary_json, '$.ranked') AS ranked,
            json_extract(fr.evidence_summary_json, '$.failure') AS failure,
            m.scoring_version
       FROM flight_results fr
       JOIN missions m ON m.id = fr.mission_id
      WHERE m.user_id = ? AND m.status = 'finalized'
      ORDER BY fr.created_at DESC, fr.id DESC
      LIMIT ?`,
  ).bind(
    requireUuid("user id", userId),
    requireInteger("history limit", limit, 1, 100),
  ).all<ProfileHistoryRow>();
  return rows.results.map((row) => ({
    resultId: row.result_id,
    missionId: row.mission_id,
    completedAt: row.created_at,
    classId: row.aircraft_class,
    outcome: row.outcome,
    score: row.ranked === 1 ? row.score / 1_000 : null,
    highestAssist: row.highest_assist,
    evidenceStatus: row.evidence_status,
    ranked: row.ranked === 1,
    failure: row.failure,
    scoringVersion: row.scoring_version,
  }));
}

export async function getUserClassStatistics(
  db: D1Database,
  userId: string,
): Promise<ProfileClassStatistic[]> {
  const rows = await db.prepare(
    `SELECT m.aircraft_class,
            COUNT(*) AS completed_flights,
            SUM(CASE WHEN fr.outcome = 'landed' THEN 1 ELSE 0 END) AS successful_landings,
            SUM(CASE WHEN json_extract(fr.evidence_summary_json, '$.ranked') = 1 THEN 1 ELSE 0 END) AS ranked_flights,
            MAX(CASE WHEN json_extract(fr.evidence_summary_json, '$.ranked') = 1 THEN fr.score END) AS best_score,
            AVG(CASE WHEN json_extract(fr.evidence_summary_json, '$.ranked') = 1 THEN fr.score END) AS average_score
       FROM flight_results fr
       JOIN missions m ON m.id = fr.mission_id
      WHERE m.user_id = ? AND m.status = 'finalized'
      GROUP BY m.aircraft_class
      ORDER BY MAX(fr.created_at) DESC, m.aircraft_class ASC`,
  ).bind(requireUuid("user id", userId)).all<ProfileStatisticRow>();
  return rows.results.map((row) => ({
    classId: row.aircraft_class,
    completedFlights: row.completed_flights,
    successfulLandings: row.successful_landings,
    rankedFlights: row.ranked_flights,
    bestScore: row.best_score === null ? null : row.best_score / 1_000,
    averageScore: row.average_score === null
      ? null
      : Math.round(row.average_score) / 1_000,
  }));
}

type LeaderboardRow = {
  result_id: string;
  user_id: string;
  handle: string;
  score: number;
  created_at: number;
};

export type LeaderboardDatabaseCursor = {
  score: number;
  completedAt: number;
  resultId: string;
  offset: number;
};

export type LeaderboardDatabaseQuery = {
  partition: LeaderboardPartition;
  cursor: LeaderboardDatabaseCursor | null;
  limit: number;
  now: number;
};

export async function listLeaderboardResults(
  db: D1Database,
  query: LeaderboardDatabaseQuery,
): Promise<{ entries: Omit<LeaderboardEntry, "rank">[]; hasMore: boolean }> {
  const cursorClause = query.cursor === null
    ? ""
    : `AND (
         fr.score < ? OR
         (fr.score = ? AND fr.created_at > ?) OR
         (fr.score = ? AND fr.created_at = ? AND fr.id > ?)
       )`;
  const statement = db.prepare(
    `SELECT fr.id AS result_id, u.id AS user_id, u.handle, fr.score, fr.created_at
       FROM flight_results fr
       JOIN missions m ON m.id = fr.mission_id
       JOIN users u ON u.id = m.user_id
      WHERE m.status = 'finalized'
        AND m.aircraft_class = ?
        AND fr.highest_assist = ?
        AND m.scoring_version = ?
        AND fr.outcome = 'landed'
        AND fr.evidence_status = 'verified'
        AND json_extract(fr.evidence_summary_json, '$.ranked') = 1
        AND u.status = 'active'
        AND NOT EXISTS (
          SELECT 1
            FROM user_bans b
           WHERE (b.user_id = u.id OR b.email_key = u.email_key)
             AND b.revoked_at IS NULL
             AND (b.scope = 'permanent' OR b.expires_at > ?)
        )
        ${cursorClause}
      ORDER BY fr.score DESC, fr.created_at ASC, fr.id ASC
      LIMIT ?`,
  );
  const partitionBindings: unknown[] = [
    query.partition.classId,
    query.partition.highestAssist satisfies LeaderboardAssist,
    query.partition.scoringVersion,
    query.now,
  ];
  const cursorBindings = query.cursor === null
    ? []
    : [
        query.cursor.score,
        query.cursor.score,
        query.cursor.completedAt,
        query.cursor.score,
        query.cursor.completedAt,
        query.cursor.resultId,
      ];
  const rows = await statement
    .bind(...partitionBindings, ...cursorBindings, query.limit + 1)
    .all<LeaderboardRow>();
  const selected = rows.results.slice(0, query.limit);
  return {
    entries: selected.map((row) => ({
      resultId: row.result_id,
      userId: row.user_id,
      handle: row.handle,
      score: row.score / 1_000,
      completedAt: row.created_at,
    })),
    hasMore: rows.results.length > query.limit,
  };
}
