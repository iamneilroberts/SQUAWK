import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeSession, encodeOpaqueToken } from "../../auth/sessions";
import { hashSessionToken } from "../../crypto";
import { banUser } from "../../db/bans";
import { createSession } from "../../db/sessions";
import { createUser } from "../../db/users";
import type { Env } from "../../env";
import {
  allowEndpointLimiter,
  createRouter,
  type RouterDependencies,
} from "../router";
import { createMissionRoutes } from "./missions";

const NOW = 1_700_000_000_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(8));

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

function runtime(): Env {
  return {
    APP_ENV: "local",
    DB: (env as TestEnvironment).TEST_DB,
  } as Env;
}

function dependencies(onBlockedUser: (userId: string) => Promise<void>): RouterDependencies<Env> {
  return {
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    wallClock: () => new Date(NOW),
    monotonicNow: () => 1,
    digest: async () => "network-digest",
    authorize: (_boundary, request, context, runtimeEnv) =>
      authorizeSession(request, runtimeEnv.DB, NOW, context.actor, onBlockedUser),
    verifyCsrf: async () => true,
    resolveLimiter: () => allowEndpointLimiter,
    admitRequest: async ({ forceMode }) => ({ allowed: true, mode: forceMode }),
    observe: vi.fn(),
  };
}

beforeEach(async () => {
  const testEnv = env as TestEnvironment;
  await reset();
  await applyD1Migrations(testEnv.TEST_DB, testEnv.TEST_MIGRATIONS);
  await createUser(testEnv.TEST_DB, {
    id: USER_ID,
    emailKey: "a".repeat(64),
    handle: "BannedPilot",
    createdAt: NOW - 10,
    updatedAt: NOW - 10,
  });
  await createSession(testEnv.TEST_DB, {
    id: SESSION_ID,
    userId: USER_ID,
    sessionDigest: await hashSessionToken(SESSION_TOKEN),
    csrfDigest: "b".repeat(64),
    expiresAt: NOW + 60_000,
    lastSeenAt: NOW - 5,
    deviceLabel: null,
    rotatedFromId: null,
    createdAt: NOW - 10,
  });
  await banUser(testEnv.TEST_DB, {
    id: "33333333-3333-4333-8333-333333333333",
    userId: USER_ID,
    emailKey: null,
    scope: "permanent",
    reason: "mission admission integration test",
    actor: "test",
    expiresAt: null,
    createdAt: NOW,
  });
});

describe("mission route bans", () => {
  it("rejects a valid stored session after its user is banned, before broker work", async () => {
    const broker = vi.fn();
    const releaseUser = vi.fn(async () => undefined);
    const router = createRouter(createMissionRoutes({ broker }), dependencies(releaseUser));
    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/missions/prepare", {
        method: "POST",
        headers: {
          cookie: `__Host-adsb_session=${SESSION_TOKEN}`,
          origin: "https://fly.voygent.app",
          "content-type": "application/json",
          "x-csrf-token": "fixture",
          "idempotency-key": "mission-ban-integration-test",
        },
        body: "{}",
      }),
      runtime(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(broker).not.toHaveBeenCalled();
    expect(releaseUser).toHaveBeenCalledWith(USER_ID);
  });
});
