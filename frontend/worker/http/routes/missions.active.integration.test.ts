import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeSession, encodeOpaqueToken } from "../../auth/sessions";
import { hashSessionToken } from "../../crypto";
import { createLockedMission } from "../../db/missions";
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
const MISSION_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(9));

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

function dependencies(
  admitRequest: RouterDependencies<Env>["admitRequest"],
): RouterDependencies<Env> {
  return {
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    wallClock: () => new Date(NOW),
    monotonicNow: () => 1,
    digest: async () => "network-digest",
    authorize: (_boundary, request, context, runtimeEnv) =>
      authorizeSession(request, runtimeEnv.DB, NOW, context.actor),
    verifyCsrf: async () => true,
    resolveLimiter: () => allowEndpointLimiter,
    admitRequest,
    observe: vi.fn(),
  };
}

beforeEach(async () => {
  const testEnv = env as TestEnvironment;
  await reset();
  await applyD1Migrations(testEnv.TEST_DB, testEnv.TEST_MIGRATIONS);
  await createUser(testEnv.TEST_DB, {
    id: USER_ID,
    emailKey: "c".repeat(64),
    handle: "ActivePilot",
    createdAt: NOW - 10,
    updatedAt: NOW - 10,
  });
  await createSession(testEnv.TEST_DB, {
    id: SESSION_ID,
    userId: USER_ID,
    sessionDigest: await hashSessionToken(SESSION_TOKEN),
    csrfDigest: "d".repeat(64),
    expiresAt: NOW + 60_000,
    lastSeenAt: NOW - 5,
    deviceLabel: null,
    rotatedFromId: null,
    createdAt: NOW - 10,
  });
  await createLockedMission(testEnv.TEST_DB, {
    id: MISSION_ID,
    userId: USER_ID,
    aircraftHex: "abc123",
    aircraftClass: "c172s",
    adsbSnapshot: { schemaVersion: 2, idempotencyKey: "active-route-fixture" },
    airportIcao: "KMOB",
    runwayIdent: "15",
    scoringVersion: "score-v1",
    physicsVersion: "physics-v1",
    assists: { schemaVersion: 1 },
    createdAt: NOW - 1_000,
    lockedAt: NOW - 500,
  });
});

function cookie(): string {
  return `__Host-adsb_session=${SESSION_TOKEN}`;
}

describe("active mission routes", () => {
  it("admits against the exact lease and requests priority ghost plus ambient traffic", async () => {
    const admit = vi.fn(async ({ forceMode }: Parameters<RouterDependencies<Env>["admitRequest"]>[0]) => ({
      allowed: true,
      mode: forceMode,
    }));
    const broker = vi.fn(async () => ({
      type: "traffic" as const,
      traffic: {
        contacts: [],
        source: "fixture.test",
        sourceTime: 1,
        fetchedAt: NOW,
        cacheAgeSeconds: 0,
        freshness: "FRESH" as const,
        providerAvailable: true,
        regionKey: "r1:31:-87:100",
        nextRefreshSeconds: 12,
        cacheStatus: "HIT" as const,
        radiusNm: 80,
      },
    } as never));
    const router = createRouter(createMissionRoutes({ broker }), dependencies(admit));
    const response = await router.fetch(new Request(
      `https://fly.voygent.app/api/missions/${MISSION_ID}/traffic?lat=31&lon=-87&radius_nm=80`,
      { headers: { cookie: cookie() } },
    ), runtime());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "MISSION_TRAFFIC_UPDATED",
      data: { nextRefreshSeconds: 12 },
    });
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "active-flight",
      params: { missionId: MISSION_ID },
    }), expect.anything());
    expect(broker).toHaveBeenCalledWith(undefined, expect.objectContaining({
      type: "traffic",
      request: expect.objectContaining({
        latitude: 31,
        longitude: -87,
        radiusNm: 80,
        audience: {
          kind: "active-ghost",
          userId: USER_ID,
          missionId: MISSION_ID,
          selectedHex: "abc123",
        },
      }),
    }));
  });

  it("releases explicitly and treats an already-expired lease as idempotent success", async () => {
    const admit = vi.fn(async ({ forceMode }: Parameters<RouterDependencies<Env>["admitRequest"]>[0]) => ({
      allowed: true,
      mode: forceMode,
    }));
    const broker = vi.fn(async () => ({
      type: "lease" as const,
      allowed: false,
      reason: "not-found" as const,
    } as never));
    const router = createRouter(createMissionRoutes({ broker }), dependencies(admit));
    const response = await router.fetch(new Request(
      `https://fly.voygent.app/api/missions/${MISSION_ID}/release`,
      {
        method: "POST",
        headers: {
          cookie: cookie(),
          origin: "https://fly.voygent.app",
          "content-type": "application/json",
          "x-csrf-token": "fixture",
          "idempotency-key": "active-release-fixture",
        },
        body: "{}",
      },
    ), runtime());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "MISSION_LEASE_RELEASED",
      data: { released: true },
    });
    expect(admit).not.toHaveBeenCalled();
    expect(broker).toHaveBeenCalledWith(undefined, {
      type: "lease-release",
      userId: USER_ID,
      missionId: MISSION_ID,
    });
  });
});
