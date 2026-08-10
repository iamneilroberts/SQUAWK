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

export async function consumeMagicLinkSession(
  db: D1Database,
  input: ConsumeMagicLinkSessionInput,
): Promise<Session | null> {
  const value = {
    tokenDigest: requireDigest("token digest", input.tokenDigest),
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

  const results = await db.batch([
    db
      .prepare(
        `UPDATE magic_links
            SET consumed_at = ?, consume_nonce = ?
          WHERE token_digest = ?
            AND consumed_at IS NULL
            AND expires_at > ?`,
      )
      .bind(
        value.consumedAt,
        value.consumeNonce,
        value.tokenDigest,
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
