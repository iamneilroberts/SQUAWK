import { getSessionById } from "../db/sessions";
import { requireTimestamp, requireUuid } from "../db/client";
import type { VersionedDocument } from "../db/types";
import { ApiHttpError } from "../http/response";
import {
  recordAdminMutation,
  replayAdminMutation,
  type AdminMutationRecord,
} from "./auditMutation";

export type RevokeAdminSessionInput = Omit<
  AdminMutationRecord,
  "action" | "targetType" | "targetId" | "before" | "after"
> & { sessionId: string };

export async function revokeSession(
  db: D1Database,
  input: RevokeAdminSessionInput,
) {
  const sessionId = requireUuid("session id", input.sessionId);
  const base = {
    ...input,
    action: "session.revoke",
    targetType: "session",
    targetId: sessionId,
  };
  const replay = await replayAdminMutation(db, {
    ...base,
    before: null,
    after: null,
  });
  if (replay !== null) return replay;
  const session = await getSessionById(db, sessionId);
  if (session === null) throw new ApiHttpError(404, "NOT_FOUND", "Session not found");
  if (session.revokedAt !== null) {
    throw new ApiHttpError(409, "INVALID_REQUEST", "Session is already revoked");
  }
  const revokedAt = requireTimestamp("revoked at", input.createdAt);
  const before: VersionedDocument = {
    schemaVersion: 1,
    sessionId,
    userId: session.userId,
    revokedAt: null,
  };
  const after: VersionedDocument = { ...before, revokedAt };
  return recordAdminMutation(db, { ...base, before, after }, [
    db.prepare(
      "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).bind(revokedAt, sessionId),
  ]);
}
