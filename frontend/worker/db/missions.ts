import {
  JSON_BYTE_LIMITS,
  changed,
  optionalText,
  requireOneOf,
  requireStored,
  requireText,
  requireTimestamp,
  requireUuid,
  serializeVersionedJson,
} from "./client";
import type {
  CreateMissionInput,
  LockMissionInput,
  Mission,
  MissionStatus,
} from "./types";

const MISSION_STATUSES: readonly MissionStatus[] = [
  "draft",
  "locked",
  "finalized",
  "abandoned",
];
const AIRCRAFT_HEX = /^[0-9a-f]{6}$/;
const AIRPORT_ICAO = /^[A-Z0-9]{4}$/;
const RUNWAY = /^[A-Z0-9]{1,8}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

type MissionRow = {
  id: string;
  user_id: string;
  aircraft_hex: string;
  aircraft_class: string;
  adsb_snapshot_json: string;
  airport_icao: string;
  runway_ident: string;
  scoring_version: string;
  physics_version: string;
  assists_json: string;
  status: MissionStatus;
  trace_pointer: string | null;
  trace_expires_at: number | null;
  created_at: number;
  locked_at: number | null;
  finalized_at: number | null;
};

const SELECT_MISSION = `SELECT id, user_id, aircraft_hex, aircraft_class,
                               adsb_snapshot_json, airport_icao, runway_ident,
                               scoring_version, physics_version, assists_json,
                               status, trace_pointer, trace_expires_at, created_at,
                               locked_at, finalized_at
                          FROM missions`;

function mapMission(row: MissionRow): Mission {
  return {
    id: row.id,
    userId: row.user_id,
    aircraftHex: row.aircraft_hex,
    aircraftClass: row.aircraft_class,
    adsbSnapshotJson: row.adsb_snapshot_json,
    airportIcao: row.airport_icao,
    runwayIdent: row.runway_ident,
    scoringVersion: row.scoring_version,
    physicsVersion: row.physics_version,
    assistsJson: row.assists_json,
    status: requireOneOf("mission status", row.status, MISSION_STATUSES),
    tracePointer: row.trace_pointer,
    traceExpiresAt: row.trace_expires_at,
    createdAt: row.created_at,
    lockedAt: row.locked_at,
    finalizedAt: row.finalized_at,
  };
}

export async function createMission(
  db: D1Database,
  input: CreateMissionInput,
): Promise<Mission> {
  const id = requireUuid("mission id", input.id);
  const userId = requireUuid("user id", input.userId);
  const aircraftHex = requireText(
    "aircraft hex",
    input.aircraftHex.toLowerCase(),
    6,
    6,
    AIRCRAFT_HEX,
  );
  const aircraftClass = requireText(
    "aircraft class",
    input.aircraftClass,
    1,
    48,
  );
  const snapshot = serializeVersionedJson(
    "ADS-B snapshot",
    input.adsbSnapshot,
    JSON_BYTE_LIMITS.adsbSnapshot,
  );
  const airportIcao = requireText(
    "airport ICAO",
    input.airportIcao.toUpperCase(),
    4,
    4,
    AIRPORT_ICAO,
  );
  const runwayIdent = requireText(
    "runway identifier",
    input.runwayIdent.toUpperCase(),
    1,
    8,
    RUNWAY,
  );
  const scoringVersion = requireText(
    "scoring version",
    input.scoringVersion,
    1,
    32,
    VERSION,
  );
  const physicsVersion = requireText(
    "physics version",
    input.physicsVersion,
    1,
    32,
    VERSION,
  );
  const assists = serializeVersionedJson(
    "assists",
    input.assists,
    JSON_BYTE_LIMITS.assists,
  );
  const tracePointer = optionalText("trace pointer", input.tracePointer, 256);
  const traceExpiresAt =
    input.traceExpiresAt === null || input.traceExpiresAt === undefined
      ? null
      : requireTimestamp("trace expiry", input.traceExpiresAt);
  if ((tracePointer === null) !== (traceExpiresAt === null)) {
    throw new RangeError("trace retention is invalid");
  }
  const createdAt = requireTimestamp("created at", input.createdAt);
  if (traceExpiresAt !== null && traceExpiresAt <= createdAt) {
    throw new RangeError("trace retention is invalid");
  }

  await db
    .prepare(
      `INSERT INTO missions
         (id, user_id, aircraft_hex, aircraft_class, adsb_snapshot_json,
          airport_icao, runway_ident, scoring_version, physics_version,
          assists_json, status, trace_pointer, trace_expires_at, created_at,
          locked_at, finalized_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, NULL)`,
    )
    .bind(
      id,
      userId,
      aircraftHex,
      aircraftClass,
      snapshot,
      airportIcao,
      runwayIdent,
      scoringVersion,
      physicsVersion,
      assists,
      tracePointer,
      traceExpiresAt,
      createdAt,
    )
    .run();
  return requireStored("mission", await getMissionById(db, id));
}

export async function getMissionById(
  db: D1Database,
  id: string,
): Promise<Mission | null> {
  const row = await db
    .prepare(`${SELECT_MISSION} WHERE id = ?`)
    .bind(requireUuid("mission id", id))
    .first<MissionRow>();
  return row === null ? null : mapMission(row);
}

export async function lockMission(
  db: D1Database,
  input: LockMissionInput,
): Promise<Mission | null> {
  const missionId = requireUuid("mission id", input.missionId);
  const lockedAt = requireTimestamp("locked at", input.lockedAt);
  const snapshot = serializeVersionedJson(
    "ADS-B snapshot",
    input.adsbSnapshot,
    JSON_BYTE_LIMITS.adsbSnapshot,
  );
  const assists = serializeVersionedJson(
    "assists",
    input.assists,
    JSON_BYTE_LIMITS.assists,
  );
  const [update, selected] = await db.batch<MissionRow>([
    db
      .prepare(
        `UPDATE missions
            SET adsb_snapshot_json = ?, assists_json = ?, status = 'locked', locked_at = ?
          WHERE id = ? AND status = 'draft' AND created_at <= ?`,
      )
      .bind(snapshot, assists, lockedAt, missionId, lockedAt),
    db.prepare(`${SELECT_MISSION} WHERE id = ?`).bind(missionId),
  ]);

  if (!changed(update)) return null;
  const row = selected.results[0] ?? null;
  return mapMission(requireStored("locked mission", row));
}

export async function clearExpiredMissionTracePointers(
  db: D1Database,
  before: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE missions
          SET trace_pointer = NULL, trace_expires_at = NULL
        WHERE trace_pointer IS NOT NULL AND trace_expires_at <= ?`,
    )
    .bind(requireTimestamp("trace retention cutoff", before))
    .run();
  return result.meta.changes;
}

export async function abandonMission(
  db: D1Database,
  missionId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE missions SET status = 'abandoned'
        WHERE id = ? AND status IN ('draft', 'locked')`,
    )
    .bind(requireUuid("mission id", missionId))
    .run();
  return changed(result);
}
