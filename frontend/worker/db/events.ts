import { redactSensitive } from "../telemetry/redact";

import {
  JSON_BYTE_LIMITS,
  optionalText,
  requireInteger,
  requireOneOf,
  requireStored,
  requireText,
  requireTimestamp,
  requireUuid,
  serializeVersionedJson,
  totalChanges,
} from "./client";
import type {
  CreateSystemEventInput,
  SystemEvent,
  SystemEventLevel,
} from "./types";

const EVENT_LEVELS: readonly SystemEventLevel[] = [
  "warning",
  "error",
  "transition",
];

type EventRow = {
  id: string;
  level: SystemEventLevel;
  category: string;
  event_key: string;
  request_id: string | null;
  context_json: string;
  trace_pointer: string | null;
  trace_expires_at: number | null;
  created_at: number;
};

const SELECT_EVENT = `SELECT id, level, category, event_key, request_id,
                             context_json, trace_pointer, trace_expires_at, created_at
                        FROM system_events`;

function mapEvent(row: EventRow): SystemEvent {
  return {
    id: row.id,
    level: row.level,
    category: row.category,
    eventKey: row.event_key,
    requestId: row.request_id,
    contextJson: row.context_json,
    tracePointer: row.trace_pointer,
    traceExpiresAt: row.trace_expires_at,
    createdAt: row.created_at,
  };
}

export async function appendSystemEvent(
  db: D1Database,
  input: CreateSystemEventInput,
): Promise<SystemEvent> {
  const id = requireUuid("event id", input.id);
  const level = requireOneOf("event level", input.level, EVENT_LEVELS);
  const category = requireText("event category", input.category, 1, 64);
  const eventKey = requireText("event key", input.eventKey, 1, 96);
  const requestId = optionalText("request id", input.requestId, 128);
  if (requestId !== null && requestId.length < 8) {
    throw new RangeError("request id is invalid");
  }
  const context = serializeVersionedJson(
    "event context",
    redactSensitive(input.context),
    JSON_BYTE_LIMITS.eventContext,
  );
  const tracePointer = optionalText("trace pointer", input.tracePointer, 256);
  const traceExpiresAt =
    input.traceExpiresAt === null
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
      `INSERT INTO system_events
         (id, level, category, event_key, request_id, context_json,
          trace_pointer, trace_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      level,
      category,
      eventKey,
      requestId,
      context,
      tracePointer,
      traceExpiresAt,
      createdAt,
    )
    .run();
  return requireStored("system event", await getSystemEventById(db, id));
}

export async function getSystemEventById(
  db: D1Database,
  id: string,
): Promise<SystemEvent | null> {
  const row = await db
    .prepare(`${SELECT_EVENT} WHERE id = ?`)
    .bind(requireUuid("event id", id))
    .first<EventRow>();
  return row === null ? null : mapEvent(row);
}

export async function pruneSystemEvents(
  db: D1Database,
  before: number,
  retainLatest: number,
  deleteLimit = 1_000,
): Promise<number> {
  const cutoff = requireTimestamp("event retention cutoff", before);
  const retained = requireInteger("retained event count", retainLatest, 0, 100_000);
  const limit = requireInteger(
    "event deletion limit",
    deleteLimit,
    1,
    5_000,
  );
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM system_events
          WHERE id IN (
            SELECT id FROM system_events
             WHERE created_at < ?
             ORDER BY created_at
             LIMIT ?
          )`,
      )
      .bind(cutoff, limit),
    db
      .prepare(
        `DELETE FROM system_events
          WHERE id IN (
            SELECT id FROM system_events
             ORDER BY created_at DESC
             LIMIT -1 OFFSET ?
          )`,
      )
      .bind(retained),
  ]);
  return totalChanges(results);
}

export async function clearExpiredEventTracePointers(
  db: D1Database,
  before: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE system_events
          SET trace_pointer = NULL, trace_expires_at = NULL
        WHERE trace_pointer IS NOT NULL AND trace_expires_at <= ?`,
    )
    .bind(requireTimestamp("trace retention cutoff", before))
    .run();
  return result.meta.changes;
}
