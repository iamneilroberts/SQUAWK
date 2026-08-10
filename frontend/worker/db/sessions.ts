import {
  changed,
  optionalText,
  requireDigest,
  requireInteger,
  requireStored,
  requireTimestamp,
  requireUuid,
} from "./client";
import type {
  CreateSessionInput,
  RotateSessionInput,
  Session,
} from "./types";

type SessionRow = {
  id: string;
  user_id: string;
  session_digest: string;
  csrf_digest: string | null;
  expires_at: number;
  revoked_at: number | null;
  last_seen_at: number;
  device_label: string | null;
  rotated_from_id: string | null;
  created_at: number;
};

const SELECT_SESSION = `SELECT id, user_id, session_digest, expires_at, revoked_at,
                               last_seen_at, device_label, rotated_from_id, created_at,
                               csrf_digest
                          FROM sessions`;

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    sessionDigest: row.session_digest,
    csrfDigest: row.csrf_digest,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastSeenAt: row.last_seen_at,
    deviceLabel: row.device_label,
    rotatedFromId: row.rotated_from_id,
    createdAt: row.created_at,
  };
}

function validateSession(input: CreateSessionInput): CreateSessionInput {
  const validated = {
    id: requireUuid("session id", input.id),
    userId: requireUuid("user id", input.userId),
    sessionDigest: requireDigest("session digest", input.sessionDigest),
    csrfDigest:
      input.csrfDigest === null
        ? null
        : requireDigest("CSRF digest", input.csrfDigest),
    expiresAt: requireTimestamp("expires at", input.expiresAt),
    lastSeenAt: requireTimestamp("last seen at", input.lastSeenAt),
    deviceLabel: optionalText("device label", input.deviceLabel, 128),
    rotatedFromId:
      input.rotatedFromId === null
        ? null
        : requireUuid("rotated session id", input.rotatedFromId),
    createdAt: requireTimestamp("created at", input.createdAt),
  };
  if (validated.expiresAt <= validated.createdAt) {
    throw new RangeError("session expiry is invalid");
  }
  if (
    validated.lastSeenAt < validated.createdAt ||
    validated.lastSeenAt >= validated.expiresAt
  ) {
    throw new RangeError("session last-seen time is invalid");
  }
  return validated;
}

export async function createSession(
  db: D1Database,
  input: CreateSessionInput,
): Promise<Session> {
  const value = validateSession(input);
  await db
    .prepare(
      `INSERT INTO sessions
         (id, user_id, session_digest, expires_at, revoked_at, last_seen_at,
          device_label, rotated_from_id, created_at, csrf_digest)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(
      value.id,
      value.userId,
      value.sessionDigest,
      value.expiresAt,
      value.lastSeenAt,
      value.deviceLabel,
      value.rotatedFromId,
      value.createdAt,
      value.csrfDigest,
    )
    .run();
  return requireStored("session", await getSessionById(db, value.id));
}

export async function getSessionById(
  db: D1Database,
  id: string,
): Promise<Session | null> {
  const row = await db
    .prepare(`${SELECT_SESSION} WHERE id = ?`)
    .bind(requireUuid("session id", id))
    .first<SessionRow>();
  return row === null ? null : mapSession(row);
}

export async function getActiveSessionByDigest(
  db: D1Database,
  digest: string,
  now: number,
): Promise<Session | null> {
  const row = await db
    .prepare(
      `${SELECT_SESSION}
        WHERE session_digest = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(
      requireDigest("session digest", digest),
      requireTimestamp("current time", now),
    )
    .first<SessionRow>();
  return row === null ? null : mapSession(row);
}

export async function revokeSessionById(
  db: D1Database,
  sessionId: string,
  userId: string,
  revokedAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE sessions SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(
      requireTimestamp("revoked at", revokedAt),
      requireUuid("session id", sessionId),
      requireUuid("user id", userId),
    )
    .run();
  return changed(result);
}

export async function rotateSession(
  db: D1Database,
  currentDigest: string,
  replacement: RotateSessionInput,
  rotatedAt: number,
): Promise<Session | null> {
  const digest = requireDigest("current session digest", currentDigest);
  const timestamp = requireTimestamp("rotated at", rotatedAt);
  const next = validateSession({ ...replacement, rotatedFromId: null });
  if (next.createdAt !== timestamp || next.lastSeenAt !== timestamp) {
    throw new RangeError("session rotation time is invalid");
  }
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO sessions
           (id, user_id, session_digest, expires_at, revoked_at, last_seen_at,
            device_label, rotated_from_id, created_at, csrf_digest)
         SELECT ?, user_id, ?, ?, NULL, ?, ?, id, ?, ?
           FROM sessions
          WHERE session_digest = ?
            AND user_id = ?
            AND revoked_at IS NULL
            AND expires_at > ?`,
      )
      .bind(
        next.id,
        next.sessionDigest,
        next.expiresAt,
        next.lastSeenAt,
        next.deviceLabel,
        next.createdAt,
        next.csrfDigest,
        digest,
        next.userId,
        timestamp,
      ),
    db
      .prepare(
        `UPDATE sessions
            SET revoked_at = ?
          WHERE session_digest = ?
            AND user_id = ?
            AND revoked_at IS NULL
            AND expires_at > ?`,
      )
      .bind(timestamp, digest, next.userId, timestamp),
  ]);

  if (!changed(insert)) return null;
  return requireStored("rotated session", await getSessionById(db, next.id));
}

export async function deleteExpiredSessions(
  db: D1Database,
  before: number,
  limit = 500,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM sessions
        WHERE id IN (
          SELECT id FROM sessions
           WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)
           ORDER BY expires_at
           LIMIT ?
        )`,
    )
    .bind(
      requireTimestamp("retention cutoff", before),
      before,
      requireInteger("retention limit", limit, 1, 5_000),
    )
    .run();
  return result.meta.changes;
}
