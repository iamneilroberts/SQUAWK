import { deriveEmailKey, normalizeEmail } from "../crypto";
import {
  changed,
  requireDigest,
  requireInteger,
  requireTimestamp,
  requireUuid,
} from "../db/client";

export { normalizeEmail };

export async function deriveEmailIdentity(
  email: string,
  hmacSecret: string,
): Promise<{ normalizedEmail: string; emailKey: string }> {
  const normalizedEmail = normalizeEmail(email);
  return {
    normalizedEmail,
    emailKey: await deriveEmailKey(normalizedEmail, hmacSecret),
  };
}

export async function reserveEmailRateLimit(
  db: D1Database,
  input: {
    id: string;
    emailKey: string;
    requestedAt: number;
    windowMs: number;
    maximum: number;
  },
): Promise<boolean> {
  const id = requireUuid("rate event id", input.id);
  const emailKey = requireDigest("email key", input.emailKey);
  const requestedAt = requireTimestamp("requested at", input.requestedAt);
  const windowMs = requireInteger("rate window", input.windowMs, 1, 86_400_000);
  const maximum = requireInteger("rate maximum", input.maximum, 1, 100);
  const result = await db
    .prepare(
      `INSERT INTO auth_email_rate_events (id, email_key, requested_at)
       SELECT ?, ?, ?
        WHERE (
          SELECT COUNT(*)
            FROM auth_email_rate_events
           WHERE email_key = ? AND requested_at > ?
        ) < ?`,
    )
    .bind(
      id,
      emailKey,
      requestedAt,
      emailKey,
      requestedAt - windowMs,
      maximum,
    )
    .run();
  return changed(result);
}

export async function pruneEmailRateEvents(
  db: D1Database,
  before: number,
  limit = 500,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM auth_email_rate_events
        WHERE id IN (
          SELECT id FROM auth_email_rate_events
           WHERE requested_at <= ?
           ORDER BY requested_at
           LIMIT ?
        )`,
    )
    .bind(
      requireTimestamp("rate retention cutoff", before),
      requireInteger("rate retention limit", limit, 1, 5_000),
    )
    .run();
  return result.meta.changes;
}
