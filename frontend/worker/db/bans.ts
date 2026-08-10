import {
  changed,
  requireDigest,
  requireOneOf,
  requireStored,
  requireText,
  requireTimestamp,
  requireUuid,
} from "./client";
import type { BanScope, CreateBanInput, UserBan } from "./types";

const BAN_SCOPES: readonly BanScope[] = ["temporary", "permanent"];

type BanRow = {
  id: string;
  user_id: string | null;
  email_key: string | null;
  scope: BanScope;
  reason: string;
  actor: string;
  expires_at: number | null;
  revoked_at: number | null;
  revoked_by: string | null;
  created_at: number;
};

const SELECT_BAN = `SELECT id, user_id, email_key, scope, reason, actor,
                           expires_at, revoked_at, revoked_by, created_at
                      FROM user_bans`;

function mapBan(row: BanRow): UserBan {
  return {
    id: row.id,
    userId: row.user_id,
    emailKey: row.email_key,
    scope: row.scope,
    reason: row.reason,
    actor: row.actor,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    createdAt: row.created_at,
  };
}

export async function banUser(
  db: D1Database,
  input: CreateBanInput,
): Promise<UserBan> {
  const id = requireUuid("ban id", input.id);
  const userId =
    input.userId === null ? null : requireUuid("user id", input.userId);
  const emailKey =
    input.emailKey === null
      ? null
      : requireDigest("email key", input.emailKey);
  if (userId === null && emailKey === null) {
    throw new RangeError("ban target is required");
  }
  const scope = requireOneOf("ban scope", input.scope, BAN_SCOPES);
  const reason = requireText("ban reason", input.reason, 1, 512);
  const actor = requireText("ban actor", input.actor, 1, 128);
  const createdAt = requireTimestamp("created at", input.createdAt);
  const expiresAt =
    input.expiresAt === null
      ? null
      : requireTimestamp("ban expiry", input.expiresAt);
  if (
    (scope === "temporary" && (expiresAt === null || expiresAt <= createdAt)) ||
    (scope === "permanent" && expiresAt !== null)
  ) {
    throw new RangeError("ban expiry is invalid");
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO user_bans
           (id, user_id, email_key, scope, reason, actor, expires_at,
            revoked_at, revoked_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .bind(id, userId, emailKey, scope, reason, actor, expiresAt, createdAt),
  ];
  if (userId !== null) {
    statements.push(
      db
        .prepare(
          "UPDATE users SET status = 'banned', updated_at = MAX(updated_at, ?) WHERE id = ?",
        )
        .bind(createdAt, userId),
    );
  }
  await db.batch(statements);
  return requireStored("ban", await getBanById(db, id));
}

export async function getBanById(
  db: D1Database,
  id: string,
): Promise<UserBan | null> {
  const row = await db
    .prepare(`${SELECT_BAN} WHERE id = ?`)
    .bind(requireUuid("ban id", id))
    .first<BanRow>();
  return row === null ? null : mapBan(row);
}

export async function getActiveBansForUser(
  db: D1Database,
  userId: string,
  now: number,
): Promise<UserBan[]> {
  const result = await db
    .prepare(
      `${SELECT_BAN}
        WHERE user_id = ? AND revoked_at IS NULL
          AND (scope = 'permanent' OR expires_at > ?)
        ORDER BY created_at DESC`,
    )
    .bind(
      requireUuid("user id", userId),
      requireTimestamp("current time", now),
    )
    .all<BanRow>();
  return result.results.map(mapBan);
}

export async function revokeBan(
  db: D1Database,
  banId: string,
  revokedAt: number,
  revokedBy: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE user_bans
          SET revoked_at = ?, revoked_by = ?
        WHERE id = ? AND revoked_at IS NULL`,
    )
    .bind(
      requireTimestamp("revoked at", revokedAt),
      requireText("revoking actor", revokedBy, 1, 128),
      requireUuid("ban id", banId),
    )
    .run();
  return changed(result);
}
