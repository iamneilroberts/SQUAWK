import type { SystemEventLevel } from "../db/types";

export type AdminEventFilters = {
  level: SystemEventLevel | null;
  category: string | null;
  afterMs: number | null;
  beforeMs: number | null;
  limit: number;
};

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

function eventQuery(filters: AdminEventFilters) {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  if (filters.level !== null) {
    clauses.push("level = ?");
    bindings.push(filters.level);
  }
  if (filters.category !== null) {
    clauses.push("category = ?");
    bindings.push(filters.category);
  }
  if (filters.afterMs !== null) {
    clauses.push("created_at >= ?");
    bindings.push(filters.afterMs);
  }
  if (filters.beforeMs !== null) {
    clauses.push("created_at <= ?");
    bindings.push(filters.beforeMs);
  }
  bindings.push(filters.limit);
  return {
    sql: `SELECT id, level, category, event_key, request_id, context_json,
                 trace_pointer, trace_expires_at, created_at
            FROM system_events
            ${clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`}
           ORDER BY created_at DESC LIMIT ?`,
    bindings,
  };
}

function parseContext(serialized: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { schemaVersion: 1, unavailable: true };
  } catch {
    return { schemaVersion: 1, unavailable: true };
  }
}

export async function listAdminEvents(db: D1Database, filters: AdminEventFilters) {
  const query = eventQuery(filters);
  const result = await db.prepare(query.sql).bind(...query.bindings).all<EventRow>();
  return result.results.map((row) => ({
    id: row.id,
    level: row.level,
    category: row.category,
    eventKey: row.event_key,
    requestId: row.request_id,
    context: parseContext(row.context_json),
    hasTrace: row.trace_pointer !== null,
    traceExpiresAt: row.trace_expires_at,
    createdAt: row.created_at,
  }));
}

function csvCell(value: unknown): string {
  let serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@]/.test(serialized)) serialized = `'${serialized}`;
  return `"${serialized.replaceAll('"', '""')}"`;
}

export async function exportAdminEvents(
  db: D1Database,
  filters: AdminEventFilters,
  format: "json" | "csv",
) {
  const events = await listAdminEvents(db, { ...filters, limit: Math.min(filters.limit, 250) });
  if (format === "json") {
    return {
      format,
      filename: "squawk-system-events.json",
      contentType: "application/json",
      content: JSON.stringify({ schemaVersion: 1, events }),
      count: events.length,
    };
  }
  const header = ["id", "level", "category", "eventKey", "requestId", "context", "hasTrace", "traceExpiresAt", "createdAt"];
  const lines = events.map((event) => [
    event.id,
    event.level,
    event.category,
    event.eventKey,
    event.requestId,
    event.context,
    event.hasTrace,
    event.traceExpiresAt,
    event.createdAt,
  ].map(csvCell).join(","));
  return {
    format,
    filename: "squawk-system-events.csv",
    contentType: "text/csv",
    content: `${header.join(",")}\n${lines.join("\n")}`,
    count: events.length,
  };
}
