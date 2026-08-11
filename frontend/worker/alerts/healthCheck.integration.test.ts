import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepareSystemEventInsert } from "../db/events";
import type { Env } from "../env";
import type { BrokerCommandResult } from "../durable/protocol";
import { readPendingAdminAlerts, runHealthCheck } from "./healthCheck";

const NOW = Date.parse("2026-08-10T21:00:00.000Z");
const AUDIT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

function testEnvironment(): TestEnvironment {
  return env as TestEnvironment;
}

beforeEach(async () => {
  await reset();
  const { TEST_DB, TEST_MIGRATIONS } = testEnvironment();
  await applyD1Migrations(TEST_DB, TEST_MIGRATIONS);
});

describe("scheduled alert health check", () => {
  it("replays recent audited admin events before the broker health observation", async () => {
    const { TEST_DB } = testEnvironment();
    await prepareSystemEventInsert(TEST_DB, {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      level: "transition",
      category: "admin-alert",
      eventKey: "mode.set",
      requestId: REQUEST_ID,
      context: { schemaVersion: 1, auditId: AUDIT_ID },
      tracePointer: null,
      traceExpiresAt: null,
      createdAt: NOW - 1_000,
    }).run();

    await expect(readPendingAdminAlerts(TEST_DB, NOW)).resolves.toEqual([{
      action: "mode.set",
      auditId: AUDIT_ID,
      requestId: REQUEST_ID,
      atMs: NOW - 1_000,
    }]);

    const commands: unknown[] = [];
    const broker = vi.fn(async (_namespace, command) => {
      commands.push(command);
      return {} as BrokerCommandResult;
    });
    const runtime = {
      DB: TEST_DB,
      ADSB_BROKER: testEnvironment().ADSB_BROKER,
      FORCE_MODE: "NORMAL",
    } as unknown as Env;

    await runHealthCheck(runtime, NOW, { broker });

    expect(commands).toEqual([
      { type: "health-record", component: "d1", outcome: "success" },
      {
        type: "alert-admin",
        action: "mode.set",
        auditId: AUDIT_ID,
        requestId: REQUEST_ID,
        atMs: NOW - 1_000,
        forceMode: "NORMAL",
      },
      { type: "health-check", scheduledAtMs: NOW, forceMode: "NORMAL" },
    ]);
  });

  it("records a D1 binding failure without treating a missed Cron as healthy", async () => {
    const commands: unknown[] = [];
    const broker = vi.fn(async (_namespace, command) => {
      commands.push(command);
      return {} as BrokerCommandResult;
    });
    const runtime = {
      DB: { prepare: () => { throw new Error("D1 unavailable"); } },
      ADSB_BROKER: testEnvironment().ADSB_BROKER,
      FORCE_MODE: "NORMAL",
    } as unknown as Env;

    await runHealthCheck(runtime, NOW, { broker });

    expect(commands).toEqual([
      { type: "health-record", component: "d1", outcome: "failure" },
      { type: "health-check", scheduledAtMs: NOW, forceMode: "NORMAL" },
    ]);
  });
});
