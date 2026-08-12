import { codeDigest, constantTimeEqual } from "../crypto";
import {
  changed,
  optionalText,
  requireDigest,
  requireFiniteNumber,
  requireText,
  requireTimestamp,
  requireUuid,
} from "../db/client";
import { getSessionById } from "../db/sessions";
import type { Session } from "../db/types";

const HANDLE = /^[A-Za-z][A-Za-z0-9_-]{2,31}$/;
const SIGN_IN_CODE = /^\d{6}$/;
const MAX_CODE_ATTEMPTS = 5;

export type ConsumeMagicLinkSessionInput = {
  tokenDigest: string;
  consumedAt: number;
  consumeNonce: string;
  userId: string;
  handle: string;
  centerLat: number;
  centerLon: number;
  regionKey: string;
  sessionId: string;
  sessionDigest: string;
  csrfDigest: string;
  sessionExpiresAt: number;
  deviceLabel: string | null;
};

export type ConsumeAuthCodeSessionInput = {
  emailKey: string;
  code: string;
  now: number;
  consumeNonce: string;
  userId: string;
  handle: string;
  centerLat: number;
  centerLon: number;
  regionKey: string;
  sessionId: string;
  sessionDigest: string;
  csrfDigest: string;
  sessionExpiresAt: number;
  deviceLabel: string | null;
};

// Shared, validated inputs for the 5-statement consume batch. The row is
// selected differently per entry point (token digest for the link path, row id
// for the code path); every statement after the first keys off consume_nonce.
type ConsumeBatchValue = {
  consumedAt: number;
  consumeNonce: string;
  userId: string;
  handle: string;
  centerLat: number;
  centerLon: number;
  regionKey: string;
  sessionId: string;
  sessionDigest: string;
  csrfDigest: string;
  sessionExpiresAt: number;
  deviceLabel: string | null;
};

type ConsumeSelector =
  | { column: "token_digest"; value: string }
  | { column: "id"; value: string };

function validateConsumeBatchValue(
  input: Omit<ConsumeMagicLinkSessionInput, "tokenDigest">,
): ConsumeBatchValue {
  const value: ConsumeBatchValue = {
    consumedAt: requireTimestamp("consumed at", input.consumedAt),
    consumeNonce: requireUuid("consume nonce", input.consumeNonce),
    userId: requireUuid("user id", input.userId),
    handle: requireText("handle", input.handle, 3, 32, HANDLE),
    centerLat: requireFiniteNumber("center latitude", input.centerLat, -90, 90),
    centerLon: requireFiniteNumber("center longitude", input.centerLon, -180, 180),
    regionKey: requireText("region key", input.regionKey, 1, 96),
    sessionId: requireUuid("session id", input.sessionId),
    sessionDigest: requireDigest("session digest", input.sessionDigest),
    csrfDigest: requireDigest("CSRF digest", input.csrfDigest),
    sessionExpiresAt: requireTimestamp("session expiry", input.sessionExpiresAt),
    deviceLabel: optionalText("device label", input.deviceLabel, 128),
  };
  if (value.sessionExpiresAt <= value.consumedAt) {
    throw new RangeError("session expiry is invalid");
  }
  return value;
}

async function runConsumeBatch(
  db: D1Database,
  selector: ConsumeSelector,
  value: ConsumeBatchValue,
): Promise<Session | null> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE magic_links
            SET consumed_at = ?, consume_nonce = ?
          WHERE ${selector.column} = ?
            AND consumed_at IS NULL
            AND expires_at > ?`,
      )
      .bind(
        value.consumedAt,
        value.consumeNonce,
        selector.value,
        value.consumedAt,
      ),
    db
      .prepare(
        `INSERT INTO users (id, email_key, handle, status, created_at, updated_at)
         SELECT ?, link.email_key, ?, 'active', ?, ?
           FROM magic_links AS link
          WHERE link.consume_nonce = ?
            AND link.consumed_at = ?
            AND NOT EXISTS (
              SELECT 1 FROM user_bans AS ban
               WHERE ban.email_key = link.email_key
                 AND ban.revoked_at IS NULL
                 AND (ban.scope = 'permanent' OR ban.expires_at > ?)
            )
         ON CONFLICT(email_key) DO NOTHING`,
      )
      .bind(
        value.userId,
        value.handle,
        value.consumedAt,
        value.consumedAt,
        value.consumeNonce,
        value.consumedAt,
        value.consumedAt,
      ),
    db
      .prepare(
        `INSERT INTO user_preferences
           (user_id, center_lat, center_lon, region_key, default_assist,
            tutorial_state, coaching_enabled, updated_at)
         SELECT user.id, ?, ?, ?, 'medium', 'new', 1, ?
           FROM users AS user
           JOIN magic_links AS link ON link.email_key = user.email_key
          WHERE link.consume_nonce = ?
            AND user.status <> 'disabled'
            AND NOT EXISTS (
              SELECT 1 FROM user_bans AS ban
               WHERE (ban.user_id = user.id OR ban.email_key = user.email_key)
                 AND ban.revoked_at IS NULL
                 AND (ban.scope = 'permanent' OR ban.expires_at > ?)
            )
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(
        value.centerLat,
        value.centerLon,
        value.regionKey,
        value.consumedAt,
        value.consumeNonce,
        value.consumedAt,
      ),
    db
      .prepare(
        `UPDATE sessions
            SET revoked_at = ?
          WHERE revoked_at IS NULL
            AND user_id = (
              SELECT user.id
                FROM users AS user
                JOIN magic_links AS link ON link.email_key = user.email_key
               WHERE link.consume_nonce = ?
            )`,
      )
      .bind(value.consumedAt, value.consumeNonce),
    db
      .prepare(
        `INSERT INTO sessions
           (id, user_id, session_digest, expires_at, revoked_at, last_seen_at,
            device_label, rotated_from_id, created_at, csrf_digest)
         SELECT ?, user.id, ?, ?, NULL, ?, ?, NULL, ?, ?
           FROM users AS user
           JOIN magic_links AS link ON link.email_key = user.email_key
          WHERE link.consume_nonce = ?
            AND user.status <> 'disabled'
            AND NOT EXISTS (
              SELECT 1 FROM user_bans AS ban
               WHERE (ban.user_id = user.id OR ban.email_key = user.email_key)
                 AND ban.revoked_at IS NULL
                 AND (ban.scope = 'permanent' OR ban.expires_at > ?)
            )`,
      )
      .bind(
        value.sessionId,
        value.sessionDigest,
        value.sessionExpiresAt,
        value.consumedAt,
        value.deviceLabel,
        value.consumedAt,
        value.csrfDigest,
        value.consumeNonce,
        value.consumedAt,
      ),
  ]);

  if (!changed(results[0]) || !changed(results[4])) return null;
  return getSessionById(db, value.sessionId);
}

export async function consumeMagicLinkSession(
  db: D1Database,
  input: ConsumeMagicLinkSessionInput,
): Promise<Session | null> {
  const tokenDigest = requireDigest("token digest", input.tokenDigest);
  const value = validateConsumeBatchValue(input);
  return runConsumeBatch(db, { column: "token_digest", value: tokenDigest }, value);
}

export async function consumeAuthCodeSession(
  db: D1Database,
  input: ConsumeAuthCodeSessionInput,
): Promise<Session | null> {
  const emailKey = requireDigest("email key", input.emailKey);
  // Bad code format is a caller failure, but must stay indistinguishable from a
  // wrong code, so it returns null rather than throwing.
  if (!SIGN_IN_CODE.test(input.code)) return null;
  const now = requireTimestamp("current time", input.now);
  const value = validateConsumeBatchValue({ ...input, consumedAt: now });

  // Newest eligible row for this identity that actually carries a code.
  const row = await db
    .prepare(
      `SELECT id, code_digest
         FROM magic_links
        WHERE email_key = ?
          AND code_digest IS NOT NULL
          AND consumed_at IS NULL
          AND expires_at > ?
        ORDER BY requested_at DESC, id DESC
        LIMIT 1`,
    )
    .bind(emailKey, now)
    .first<{ id: string; code_digest: string }>();
  if (row === null) return null;

  // Atomic attempt-cap: increment guarded in one statement; 0 rows changed means
  // the row is spent, expired, or over the attempt cap. Never read-then-write.
  const increment = await db
    .prepare(
      `UPDATE magic_links
          SET code_attempts = code_attempts + 1
        WHERE id = ?
          AND code_attempts < ?
          AND consumed_at IS NULL
          AND expires_at > ?`,
    )
    .bind(row.id, MAX_CODE_ATTEMPTS, now)
    .run();
  if (!changed(increment)) return null;

  const expected = await codeDigest(emailKey, input.code);
  if (!constantTimeEqual(expected, row.code_digest)) return null;

  return runConsumeBatch(db, { column: "id", value: row.id }, value);
}
