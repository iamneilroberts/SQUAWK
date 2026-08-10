import { redactSensitive } from "../telemetry/redact";

import {
  JSON_BYTE_LIMITS,
  requireStored,
  requireText,
  requireTimestamp,
  requireUuid,
  serializeVersionedJson,
} from "./client";
import type { AdminAudit, CreateAdminAuditInput } from "./types";

type AuditRow = {
  id: string;
  action: string;
  actor: string;
  target_type: string;
  target_id: string;
  old_state_json: string | null;
  new_state_json: string | null;
  reason: string;
  request_id: string;
  created_at: number;
};

const SELECT_AUDIT = `SELECT id, action, actor, target_type, target_id,
                             old_state_json, new_state_json, reason, request_id,
                             created_at
                        FROM admin_audit`;

function mapAudit(row: AuditRow): AdminAudit {
  return {
    id: row.id,
    action: row.action,
    actor: row.actor,
    targetType: row.target_type,
    targetId: row.target_id,
    oldStateJson: row.old_state_json,
    newStateJson: row.new_state_json,
    reason: row.reason,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}

function prepareAuditInsert(
  db: D1Database,
  input: CreateAdminAuditInput,
): D1PreparedStatement {
  const id = requireUuid("audit id", input.id);
  const action = requireText("audit action", input.action, 1, 96);
  const actor = requireText("audit actor", input.actor, 1, 128);
  const targetType = requireText("audit target type", input.targetType, 1, 64);
  const targetId = requireText("audit target id", input.targetId, 1, 128);
  const oldState =
    input.oldState === null
      ? null
      : serializeVersionedJson(
          "old audit state",
          redactSensitive(input.oldState),
          JSON_BYTE_LIMITS.auditState,
        );
  const newState =
    input.newState === null
      ? null
      : serializeVersionedJson(
          "new audit state",
          redactSensitive(input.newState),
          JSON_BYTE_LIMITS.auditState,
        );
  const reason = requireText("audit reason", input.reason, 1, 512);
  const requestId = requireText("request id", input.requestId, 8, 128);
  const createdAt = requireTimestamp("created at", input.createdAt);

  return db
    .prepare(
      `INSERT INTO admin_audit
         (id, action, actor, target_type, target_id, old_state_json,
          new_state_json, reason, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      action,
      actor,
      targetType,
      targetId,
      oldState,
      newState,
      reason,
      requestId,
      createdAt,
    );
}

export async function appendAdminAudit(
  db: D1Database,
  input: CreateAdminAuditInput,
): Promise<AdminAudit> {
  await prepareAuditInsert(db, input).run();
  return requireStored("admin audit", await getAdminAuditById(db, input.id));
}

export async function executeAuditedMutation(
  db: D1Database,
  mutation: D1PreparedStatement,
  audit: CreateAdminAuditInput,
): Promise<D1Result> {
  const [mutationResult] = await db.batch([
    mutation,
    prepareAuditInsert(db, audit),
  ]);
  return mutationResult;
}

export async function getAdminAuditById(
  db: D1Database,
  id: string,
): Promise<AdminAudit | null> {
  const row = await db
    .prepare(`${SELECT_AUDIT} WHERE id = ?`)
    .bind(requireUuid("audit id", id))
    .first<AuditRow>();
  return row === null ? null : mapAudit(row);
}
