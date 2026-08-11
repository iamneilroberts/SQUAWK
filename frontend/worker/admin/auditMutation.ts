import { getAdminAuditById, prepareAuditInsert } from "../db/audit";
import { prepareSystemEventInsert } from "../db/events";
import type { VersionedDocument } from "../db/types";
import { ApiHttpError } from "../http/response";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type AdminMutationRecord = {
  actor: string;
  idempotencyKey: string;
  action: string;
  targetType: string;
  targetId: string;
  request: unknown;
  before: VersionedDocument | null;
  after: VersionedDocument | null;
  reason: string;
  requestId: string;
  createdAt: number;
};

export type AdminMutationResult = {
  auditId: string;
  replayed: boolean;
  state: VersionedDocument | null;
};

type StoredMutationState = VersionedDocument & {
  requestDigest: string;
  request?: unknown;
  state: VersionedDocument | null;
};

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Admin mutation request is invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Admin mutation request is invalid");
    seen.add(value);
    const result = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Admin mutation request is invalid");
    seen.add(value);
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.some((key) => record[key] === undefined)) {
      throw new TypeError("Admin mutation request is invalid");
    }
    const result = `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], seen)}`)
      .join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new TypeError("Admin mutation request is invalid");
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function uuidFromDigest(value: string): string {
  const characters = [...value.slice(0, 32)];
  characters[12] = "4";
  characters[16] = ["8", "9", "a", "b"][Number.parseInt(characters[16] ?? "0", 16) % 4];
  const compact = characters.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

async function identities(input: AdminMutationRecord): Promise<{
  auditId: string;
  eventId: string;
  requestDigest: string;
}> {
  if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    throw new ApiHttpError(400, "IDEMPOTENCY_KEY_INVALID", "The Idempotency-Key header is invalid");
  }
  const keyDigest = await digest(`${input.actor}\n${input.idempotencyKey}`);
  return {
    auditId: uuidFromDigest(keyDigest),
    eventId: uuidFromDigest(await digest(`event\n${keyDigest}`)),
    requestDigest: await digest(canonicalJson({
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      request: input.request,
    })),
  };
}

function parseStoredState(value: string | null): StoredMutationState {
  if (value === null) throw new Error("Admin mutation audit is incomplete");
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schemaVersion !== 1 ||
    typeof (parsed as Record<string, unknown>).requestDigest !== "string" ||
    !("state" in parsed)
  ) {
    throw new Error("Admin mutation audit is invalid");
  }
  return parsed as StoredMutationState;
}

export async function replayAdminMutation(
  db: D1Database,
  input: AdminMutationRecord,
): Promise<AdminMutationResult | null> {
  const identity = await identities(input);
  const audit = await getAdminAuditById(db, identity.auditId);
  if (audit === null) return null;
  const stored = parseStoredState(audit.newStateJson);
  if (stored.requestDigest !== identity.requestDigest) {
    throw new ApiHttpError(
      409,
      "IDEMPOTENCY_KEY_INVALID",
      "The Idempotency-Key was already used for a different admin request",
    );
  }
  return { auditId: identity.auditId, replayed: true, state: stored.state };
}

export async function recordAdminMutation(
  db: D1Database,
  input: AdminMutationRecord,
  statements: readonly D1PreparedStatement[] = [],
): Promise<AdminMutationResult> {
  const replay = await replayAdminMutation(db, input);
  if (replay !== null) return replay;
  const identity = await identities(input);
  const oldState: StoredMutationState = {
    schemaVersion: 1,
    requestDigest: identity.requestDigest,
    state: input.before,
  };
  const newState: StoredMutationState = {
    schemaVersion: 1,
    requestDigest: identity.requestDigest,
    request: input.request,
    state: input.after,
  };

  try {
    await db.batch([
      ...statements,
      prepareAuditInsert(db, {
        id: identity.auditId,
        action: input.action,
        actor: input.actor,
        targetType: input.targetType,
        targetId: input.targetId,
        oldState,
        newState,
        reason: input.reason,
        requestId: input.requestId,
        createdAt: input.createdAt,
      }),
      prepareSystemEventInsert(db, {
        id: identity.eventId,
        level: "transition",
        category: "admin-alert",
        eventKey: input.action,
        requestId: input.requestId,
        context: {
          schemaVersion: 1,
          action: input.action,
          actor: input.actor,
          targetType: input.targetType,
          targetId: input.targetId,
          auditId: identity.auditId,
        },
        tracePointer: null,
        traceExpiresAt: null,
        createdAt: input.createdAt,
      }),
    ]);
  } catch (error) {
    const concurrentReplay = await replayAdminMutation(db, input);
    if (concurrentReplay !== null) return concurrentReplay;
    throw error;
  }
  return { auditId: identity.auditId, replayed: false, state: input.after };
}
