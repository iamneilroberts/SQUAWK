import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createUser, getUserById } from "../db/users";
import {
  recordAdminMutation,
  replayAdminMutation,
  type AdminMutationRecord,
} from "./auditMutation";

const NOW = 1_700_000_000_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

function testEnvironment(): TestEnvironment {
  return env as TestEnvironment;
}

function mutation(overrides: Partial<AdminMutationRecord> = {}): AdminMutationRecord {
  return {
    actor: "access:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    idempotencyKey: "admin-user-disable-0001",
    action: "user.disable",
    targetType: "user",
    targetId: USER_ID,
    request: { disabled: true },
    before: { schemaVersion: 1, status: "active" },
    after: { schemaVersion: 1, status: "disabled" },
    reason: "Owner-requested enforcement test",
    requestId: "request-admin-0001",
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(async () => {
  const { TEST_DB, TEST_MIGRATIONS } = testEnvironment();
  await reset();
  await applyD1Migrations(TEST_DB, TEST_MIGRATIONS);
  await createUser(TEST_DB, {
    id: USER_ID,
    emailKey: "a".repeat(64),
    handle: "AuditPilot",
    createdAt: NOW - 10,
    updatedAt: NOW - 10,
  });
});

describe("admin mutation audit ledger", () => {
  it("batches the mutation, before/after audit, and alert event", async () => {
    const { TEST_DB } = testEnvironment();
    const input = mutation();
    await expect(replayAdminMutation(TEST_DB, input)).resolves.toBeNull();

    const result = await recordAdminMutation(TEST_DB, input, [
      TEST_DB.prepare("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?")
        .bind(NOW, USER_ID),
    ]);

    expect(result).toMatchObject({ replayed: false, state: { status: "disabled" } });
    await expect(getUserById(TEST_DB, USER_ID)).resolves.toMatchObject({ status: "disabled" });
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM admin_audit").first<number>("count"),
    ).resolves.toBe(1);
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM system_events").first<number>("count"),
    ).resolves.toBe(1);
    const audit = await TEST_DB.prepare(
      "SELECT old_state_json, new_state_json, actor, reason, request_id FROM admin_audit",
    ).first<Record<string, string>>();
    expect(audit).toMatchObject({
      actor: input.actor,
      reason: input.reason,
      request_id: input.requestId,
    });
    expect(audit?.old_state_json).toContain('"status":"active"');
    expect(audit?.new_state_json).toContain('"status":"disabled"');
    expect(audit?.new_state_json).toContain('"request":{"disabled":true}');
  });

  it("replays the same key without executing another statement", async () => {
    const { TEST_DB } = testEnvironment();
    const input = mutation();
    await recordAdminMutation(TEST_DB, input);
    const replay = await recordAdminMutation(TEST_DB, input, [
      TEST_DB.prepare("UPDATE users SET handle = 'ShouldNotRun' WHERE id = ?").bind(USER_ID),
    ]);

    expect(replay).toMatchObject({ replayed: true, state: { status: "disabled" } });
    await expect(getUserById(TEST_DB, USER_ID)).resolves.toMatchObject({ handle: "AuditPilot" });
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM admin_audit").first<number>("count"),
    ).resolves.toBe(1);
  });

  it("rejects reuse of a key for a different request", async () => {
    const { TEST_DB } = testEnvironment();
    await recordAdminMutation(TEST_DB, mutation());
    await expect(
      recordAdminMutation(TEST_DB, mutation({ request: { disabled: false } })),
    ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_INVALID" });
  });

  it("rolls back audit and event when the D1 mutation fails", async () => {
    const { TEST_DB } = testEnvironment();
    await expect(
      recordAdminMutation(TEST_DB, mutation(), [
        TEST_DB.prepare("UPDATE users SET handle = '' WHERE id = ?").bind(USER_ID),
      ]),
    ).rejects.toThrow();
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM admin_audit").first<number>("count"),
    ).resolves.toBe(0);
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM system_events").first<number>("count"),
    ).resolves.toBe(0);
  });
});
