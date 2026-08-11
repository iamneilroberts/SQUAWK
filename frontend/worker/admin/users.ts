import { deriveEmailKey } from "../crypto";
import { getActiveBansForUser, getBanById } from "../db/bans";
import { requireTimestamp, requireUuid } from "../db/client";
import type { BanScope, VersionedDocument } from "../db/types";
import { getUserByEmailKey, getUserById } from "../db/users";
import type { Env } from "../env";
import { ApiHttpError } from "../http/response";
import {
  recordAdminMutation,
  replayAdminMutation,
  type AdminMutationRecord,
} from "./auditMutation";
import type { AdminBroker } from "./mode";

export async function lookupUserByExactEmail(
  db: D1Database,
  email: string,
  emailKeySecret: string,
) {
  const user = await getUserByEmailKey(db, await deriveEmailKey(email, emailKeySecret));
  if (user === null) return null;
  return { id: user.id, handle: user.handle, status: user.status };
}

export type BanAdminUserInput = Omit<
  AdminMutationRecord,
  "action" | "targetType" | "targetId" | "before" | "after"
> & {
  userId: string;
  banId: string;
  scope: BanScope;
  expiresAt: number | null;
};

export async function banUser(
  db: D1Database,
  namespace: Env["ADSB_BROKER"],
  input: BanAdminUserInput,
  broker: AdminBroker,
) {
  const userId = requireUuid("user id", input.userId);
  const banId = requireUuid("ban id", input.banId);
  const base = {
    ...input,
    action: "user.ban",
    targetType: "user",
    targetId: userId,
  };
  const replay = await replayAdminMutation(db, { ...base, before: null, after: null });
  if (replay !== null) {
    try {
      await broker(namespace, { type: "lease-release-user", userId });
    } catch (error) {
      throw new ApiHttpError(
        503,
        "BROKER_UNAVAILABLE",
        "User remains banned but active leases could not be released immediately",
        { cause: error, data: { mutationApplied: true, auditId: replay.auditId } },
      );
    }
    return replay;
  }
  const user = await getUserById(db, userId);
  if (user === null) throw new ApiHttpError(404, "NOT_FOUND", "User not found");
  if ((await getActiveBansForUser(db, userId, input.createdAt)).length > 0) {
    throw new ApiHttpError(409, "INVALID_REQUEST", "User already has an active ban");
  }
  const createdAt = requireTimestamp("created at", input.createdAt);
  if (
    (input.scope === "temporary" &&
      (input.expiresAt === null || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= createdAt)) ||
    (input.scope === "permanent" && input.expiresAt !== null)
  ) {
    throw new ApiHttpError(400, "INVALID_REQUEST", "Ban expiry is invalid");
  }
  const activeSessions = await db.prepare(
    "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?",
  ).bind(userId, createdAt).first<number>("count") ?? 0;
  const before: VersionedDocument = {
    schemaVersion: 1,
    userId,
    status: user.status,
    activeSessions,
    activeBan: null,
  };
  const after: VersionedDocument = {
    schemaVersion: 1,
    userId,
    status: "banned",
    activeSessions: 0,
    activeBan: { id: banId, scope: input.scope, expiresAt: input.expiresAt },
  };
  const recorded = await recordAdminMutation(db, { ...base, before, after }, [
    db.prepare(
      `INSERT INTO user_bans
         (id, user_id, email_key, scope, reason, actor, expires_at,
          revoked_at, revoked_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    ).bind(
      banId,
      userId,
      user.emailKey,
      input.scope,
      input.reason,
      input.actor,
      input.expiresAt,
      createdAt,
    ),
    db.prepare(
      "UPDATE users SET status = 'banned', updated_at = MAX(updated_at, ?) WHERE id = ?",
    ).bind(createdAt, userId),
    db.prepare(
      `UPDATE sessions SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    ).bind(createdAt, userId, createdAt),
  ]);
  if (!recorded.replayed) {
    try {
      await broker(namespace, { type: "lease-release-user", userId });
    } catch (error) {
      throw new ApiHttpError(
        503,
        "BROKER_UNAVAILABLE",
        "User was banned but active leases could not be released immediately",
        { cause: error, data: { mutationApplied: true, auditId: recorded.auditId } },
      );
    }
  }
  return recorded;
}

export type UnbanAdminUserInput = Omit<
  AdminMutationRecord,
  "action" | "targetType" | "targetId" | "before" | "after"
> & { banId: string };

export async function unbanUser(
  db: D1Database,
  input: UnbanAdminUserInput,
) {
  const banId = requireUuid("ban id", input.banId);
  const base = {
    ...input,
    action: "user.unban",
    targetType: "ban",
    targetId: banId,
  };
  const replay = await replayAdminMutation(db, { ...base, before: null, after: null });
  if (replay !== null) return replay;
  const ban = await getBanById(db, banId);
  if (ban === null || ban.revokedAt !== null) {
    throw new ApiHttpError(404, "NOT_FOUND", "Active ban not found");
  }
  const revokedAt = requireTimestamp("revoked at", input.createdAt);
  let nextStatus: "active" | "banned" = "active";
  if (ban.userId !== null) {
    const other = await db.prepare(
      `SELECT 1 AS active FROM user_bans
        WHERE id <> ? AND revoked_at IS NULL
          AND (user_id = ? OR email_key = ?)
          AND (scope = 'permanent' OR expires_at > ?)
        LIMIT 1`,
    ).bind(banId, ban.userId, ban.emailKey, revokedAt).first<number>("active");
    if (other === 1) nextStatus = "banned";
  }
  const before: VersionedDocument = {
    schemaVersion: 1,
    banId,
    userId: ban.userId,
    revokedAt: null,
    userStatus: "banned",
  };
  const after: VersionedDocument = {
    ...before,
    revokedAt,
    revokedBy: input.actor,
    userStatus: nextStatus,
  };
  const statements: D1PreparedStatement[] = [
    db.prepare(
      "UPDATE user_bans SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL",
    ).bind(revokedAt, input.actor, banId),
  ];
  if (ban.userId !== null) {
    statements.push(db.prepare(
      "UPDATE users SET status = ?, updated_at = MAX(updated_at, ?) WHERE id = ?",
    ).bind(nextStatus, revokedAt, ban.userId));
  }
  return recordAdminMutation(db, { ...base, before, after }, statements);
}
