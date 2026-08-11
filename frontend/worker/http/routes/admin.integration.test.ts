import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeOpaqueToken } from "../../auth/sessions";
import { deriveEmailKey, hashSessionToken } from "../../crypto";
import { getActiveBansForUser } from "../../db/bans";
import { createLockedMission, getMissionById } from "../../db/missions";
import { appendSystemEvent } from "../../db/events";
import { createSession, getSessionById } from "../../db/sessions";
import { createUser, getUserById } from "../../db/users";
import type { Env } from "../../env";
import type { BrokerCommand, BrokerCommandResult, BrokerStatus } from "../../durable/protocol";
import {
  allowEndpointLimiter,
  createRouter,
  type RouterDependencies,
} from "../router";
import { createAdminRoutes } from "./admin";

const NOW = 1_700_000_000_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_CSRF_ID = "33333333-3333-4333-8333-333333333333";
const BAN_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(7));
const EMAIL = "target@example.com";
const EMAIL_KEY_SECRET = "email-key-secret-that-is-long-enough-for-tests";
const MISSION_ID = "55555555-5555-4555-8555-555555555555";

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

function testEnvironment(): TestEnvironment {
  return env as TestEnvironment;
}

function runtime(): Env {
  return {
    APP_ENV: "local",
    FORCE_MODE: "NORMAL",
    ADSB_BROKER: {} as DurableObjectNamespace,
    DB: testEnvironment().TEST_DB,
    CSRF_SECRET: "csrf-secret-that-is-long-enough-for-tests",
    EMAIL_KEY_SECRET,
  } as unknown as Env;
}

function initialStatus(): BrokerStatus {
  return {
    utcDay: "2026-08-10",
    admittedRequests: 10,
    providerRequests: 2,
    automaticMode: "NORMAL",
    requestedMode: "NORMAL",
    effectiveMode: "NORMAL",
    budgetBand: "normal",
    activeFlights: 1,
    flightCapacityBand: "normal",
    protectedReserveRemaining: 0,
    health: {
      admitted: 10,
      admissionRejected: 0,
      leaseRejected: 0,
      providerCalls: 2,
      providerFailures: 0,
      componentFailures: 0,
    },
    lastAlertTransition: null,
    registrationEnabled: true,
    providerCacheOnly: false,
  };
}

function brokerHarness() {
  let status = initialStatus();
  const broker = vi.fn(async (_namespace: Env["ADSB_BROKER"], command: BrokerCommand) => {
    if (command.type === "status") return { type: "status", status };
    if (command.type === "admin-snapshot") return {
      type: "admin-snapshot",
      status,
      snapshot: {
        capturedAtMs: NOW,
        status,
        leases: [{ userId: USER_ID, missionId: MISSION_ID, expiresAtMs: NOW + 45_000, reserveRemaining: 0 }],
        cacheRegions: [],
        presence: [{
          userId: USER_ID,
          missionId: MISSION_ID,
          regionKey: "r1:30.75:-88:100",
          lastSeenAtMs: NOW,
          audience: "active-ghost",
        }],
        providerWork: { queuedByPriority: [0, 0, 0, 0], inFlightRegions: 0, runningPriority: null },
      },
    };
    if (command.type === "mode-set") {
      status = { ...status, requestedMode: command.requestedMode, effectiveMode: command.requestedMode };
      return { type: "status", status };
    }
    if (command.type === "settings-set") {
      status = {
        ...status,
        registrationEnabled: command.registrationEnabled,
        providerCacheOnly: command.providerCacheOnly,
      };
      return { type: "status", status };
    }
    if (command.type === "lease-release-user" || command.type === "lease-release") {
      status = { ...status, activeFlights: 0 };
      return { type: "lease", allowed: true, status };
    }
    if (command.type === "cache-clear-region") {
      return { type: "cache-cleared", regionKey: command.regionKey, cleared: true, status };
    }
    if (command.type === "alert-admin" || command.type === "alert-test") {
      return { type: "recorded", status };
    }
    throw new Error("unexpected test broker command");
  });
  return { broker: broker as typeof broker & ((namespace: Env["ADSB_BROKER"], command: BrokerCommand) => Promise<BrokerCommandResult>) };
}

function dependencies(kind: "admin" | "authenticated" = "admin"): RouterDependencies<Env> {
  return {
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    wallClock: () => new Date(NOW),
    monotonicNow: (() => {
      let value = 1;
      return () => value++;
    })(),
    digest: async () => "network-digest",
    authorize: async () => kind === "admin"
      ? {
          kind: "admin",
          userId: "access:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sessionId: ADMIN_CSRF_ID,
          samplingKey: "admin:owner",
        }
      : { kind: "authenticated", userId: USER_ID, samplingKey: `user:${USER_ID}` },
    verifyCsrf: async (request) => request.headers.get("x-csrf-token") === "admin-csrf",
    resolveLimiter: () => allowEndpointLimiter,
    admitRequest: async ({ forceMode }) => ({ allowed: true, mode: forceMode }),
    observe: vi.fn(),
    resolveMode: () => "NORMAL",
  };
}

function adminRequest(path: string, body: unknown, idempotencyKey: string, csrf = true): Request {
  return new Request(`https://fly.voygent.app${path}`, {
    method: "POST",
    headers: {
      origin: "https://fly.voygent.app",
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...(csrf ? { "x-csrf-token": "admin-csrf" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(testEnvironment().TEST_DB, testEnvironment().TEST_MIGRATIONS);
  await createUser(testEnvironment().TEST_DB, {
    id: USER_ID,
    emailKey: await deriveEmailKey(EMAIL, EMAIL_KEY_SECRET),
    handle: "AdminTarget",
    createdAt: NOW - 10,
    updatedAt: NOW - 10,
  });
  await createSession(testEnvironment().TEST_DB, {
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
});

describe("admin control routes", () => {
  it("keeps ordinary sessions outside the admin boundary", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies("authenticated"));
    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/admin/status", {
        headers: { cookie: `__Host-adsb_session=${SESSION_TOKEN}` },
      }),
      runtime(),
    );
    expect(response.status).toBe(403);
    expect(broker).not.toHaveBeenCalled();
  });

  it("returns bootstrap status and an admin CSRF token without caching", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/admin/status"),
      runtime(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: { effectiveMode: "NORMAL", registrationEnabled: true },
        csrfToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
  });

  it("serves bounded overview, session, event, and exact user reads without sensitive digests", async () => {
    await appendSystemEvent(testEnvironment().TEST_DB, {
      id: "66666666-6666-4666-8666-666666666666",
      level: "warning",
      category: "provider",
      eventKey: "provider.degraded",
      requestId: "request-safe-pointer",
      context: { schemaVersion: 1, state: "degraded" },
      tracePointer: null,
      traceExpiresAt: null,
      createdAt: NOW,
    });
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const app = runtime();

    const responses = await Promise.all([
      router.fetch(new Request("https://fly.voygent.app/api/admin/overview"), app),
      router.fetch(new Request("https://fly.voygent.app/api/admin/sessions?limit=10"), app),
      router.fetch(new Request("https://fly.voygent.app/api/admin/events?level=warning&limit=10"), app),
      router.fetch(new Request("https://fly.voygent.app/api/admin/users?kind=handle&query=AdminTarget"), app),
      router.fetch(new Request(`https://fly.voygent.app/api/admin/users/${USER_ID}`), app),
    ]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const body = (await Promise.all(responses.map((response) => response.text()))).join("\n");
    expect(body).toContain("provider.degraded");
    expect(body).toContain("r1:30.75:-88:100");
    expect(body).toContain("AdminTarget");
    expect(body).not.toContain(EMAIL);
    expect(body).not.toContain(await hashSessionToken(SESSION_TOKEN));
    expect(body).not.toContain("email_key");
    expect(body).not.toContain("session_digest");
  });

  it("keeps empty log reads and bounded exports explicit", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const app = runtime();
    const empty = await router.fetch(
      new Request("https://fly.voygent.app/api/admin/events?limit=10"),
      app,
    );
    const exported = await router.fetch(
      new Request("https://fly.voygent.app/api/admin/events/export?format=csv&limit=10"),
      app,
    );
    const invalid = await router.fetch(
      new Request("https://fly.voygent.app/api/admin/events?limit=10&limit=20"),
      app,
    );

    await expect(empty.json()).resolves.toMatchObject({
      data: { events: [], fullLogStream: false },
    });
    await expect(exported.json()).resolves.toMatchObject({
      data: { format: "csv", count: 0, content: expect.stringContaining("id,level,category") },
    });
    expect(invalid.status).toBe(400);
  });

  it("requires CSRF and KILL_SWITCH typed confirmation", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const missingCsrf = await router.fetch(
      adminRequest("/api/admin/mode", {
        mode: "READ_ONLY",
        reason: "Operational safety drill",
      }, "admin-mode-no-csrf", false),
      runtime(),
    );
    expect(missingCsrf.status).toBe(403);

    const badConfirmation = await router.fetch(
      adminRequest("/api/admin/mode", {
        mode: "KILL_SWITCH",
        reason: "Operational safety drill",
        confirmation: "kill",
      }, "admin-mode-bad-confirmation"),
      runtime(),
    );
    expect(badConfirmation.status).toBe(400);
    expect(broker).not.toHaveBeenCalled();
  });

  it("makes mode changes idempotent and rejects key reuse with changed input", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const body = { mode: "READ_ONLY", reason: "Prepare for provider maintenance" };
    const first = await router.fetch(adminRequest("/api/admin/mode", body, "admin-mode-change-0001"), runtime());
    const replay = await router.fetch(adminRequest("/api/admin/mode", body, "admin-mode-change-0001"), runtime());
    const conflict = await router.fetch(adminRequest("/api/admin/mode", {
      mode: "NORMAL",
      reason: body.reason,
    }, "admin-mode-change-0001"), runtime());

    expect(first.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ data: { replayed: true } });
    expect(conflict.status).toBe(409);
    expect(broker.mock.calls.filter(([, command]) => command.type === "mode-set")).toHaveLength(1);
    await expect(
      testEnvironment().TEST_DB.prepare("SELECT COUNT(*) AS count FROM admin_audit").first<number>("count"),
    ).resolves.toBe(1);
  });

  it("persists registration and provider cache-only controls through the broker", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const response = await router.fetch(adminRequest("/api/admin/settings", {
      registrationEnabled: false,
      providerCacheOnly: true,
      reason: "Pause onboarding and upstream refresh during maintenance",
    }, "admin-settings-change-0001"), runtime());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: { registrationEnabled: false, providerCacheOnly: true },
      },
    });
    expect(broker.mock.calls.filter(([, command]) => command.type === "settings-set")).toHaveLength(1);
  });

  it("audits and queues a recipient-bounded TEST alert", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const response = await router.fetch(adminRequest("/api/admin/alerts/test", {
      reason: "Owner requested alert delivery drill",
    }, "admin-test-alert-0001"), runtime());

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { auditId: string; queued: boolean } };
    expect(body.data.queued).toBe(true);
    expect(broker).toHaveBeenCalledWith(expect.anything(), {
      type: "alert-test",
      auditId: body.data.auditId,
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      atMs: NOW,
      forceMode: "NORMAL",
    });
    await expect(
      testEnvironment().TEST_DB.prepare("SELECT COUNT(*) AS count FROM admin_audit").first<number>("count"),
    ).resolves.toBe(1);
  });

  it("atomically bans a user, revokes every session, releases leases, and records an alert", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(
      createAdminRoutes({ broker, now: () => NOW, uuid: () => BAN_ID }),
      dependencies(),
    );
    const response = await router.fetch(
      adminRequest(`/api/admin/users/${USER_ID}/ban`, {
        scope: "permanent",
        expiresAt: null,
        reason: "Confirmed abuse of ranked submissions",
        confirmation: `BAN ${USER_ID}`,
      }, "admin-ban-user-0001"),
      runtime(),
    );

    expect(response.status).toBe(200);
    await expect(getSessionById(testEnvironment().TEST_DB, SESSION_ID)).resolves.toMatchObject({
      revokedAt: NOW,
    });
    await expect(getActiveBansForUser(testEnvironment().TEST_DB, USER_ID, NOW)).resolves.toHaveLength(1);
    expect(broker).toHaveBeenCalledWith(expect.anything(), {
      type: "lease-release-user",
      userId: USER_ID,
    });
    await expect(
      testEnvironment().TEST_DB.prepare("SELECT COUNT(*) AS count FROM system_events").first<number>("count"),
    ).resolves.toBe(1);
  });

  it("looks up an exact email without returning or persisting the address", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const response = await router.fetch(
      adminRequest("/api/admin/users/lookup", { email: EMAIL }, "admin-user-lookup-0001"),
      runtime(),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(EMAIL);
    expect(JSON.parse(body)).toMatchObject({ data: { user: { id: USER_ID, handle: "AdminTarget" } } });
    await expect(
      testEnvironment().TEST_DB.prepare("SELECT COUNT(*) AS count FROM admin_audit").first<number>("count"),
    ).resolves.toBe(0);
  });

  it("replays a normalized region clear without clearing or auditing twice", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const input = {
      latitude: 30.6944,
      longitude: -88.0399,
      radiusNm: 80,
      reason: "Discard one suspect traffic snapshot",
    };
    const first = await router.fetch(
      adminRequest("/api/admin/cache/region", input, "admin-cache-clear-0001"),
      runtime(),
    );
    const replay = await router.fetch(
      adminRequest("/api/admin/cache/region", input, "admin-cache-clear-0001"),
      runtime(),
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ data: { replayed: true } });
    expect(broker.mock.calls.filter(([, command]) => command.type === "cache-clear-region")).toHaveLength(1);
    await expect(
      testEnvironment().TEST_DB.prepare("SELECT COUNT(*) AS count FROM admin_audit").first<number>("count"),
    ).resolves.toBe(1);
  });

  it("surfaces a partial ban failure, keeps enforcement atomic, and retries lease release", async () => {
    const { broker: workingBroker } = brokerHarness();
    const broker = vi.fn(async (
      namespace: Env["ADSB_BROKER"],
      command: BrokerCommand,
    ): Promise<BrokerCommandResult> => {
      if (command.type === "lease-release-user") throw new Error("broker unavailable");
      return await workingBroker(namespace, command) as BrokerCommandResult;
    });
    const router = createRouter(
      createAdminRoutes({ broker, now: () => NOW, uuid: () => BAN_ID }),
      dependencies(),
    );
    const request = () => adminRequest(`/api/admin/users/${USER_ID}/ban`, {
      scope: "temporary",
      expiresAt: NOW + 60_000,
      reason: "Suspend ranked access during investigation",
      confirmation: `BAN ${USER_ID}`,
    }, "admin-ban-partial-0001");
    const first = await router.fetch(request(), runtime());
    const replay = await router.fetch(request(), runtime());

    expect(first.status).toBe(503);
    expect(replay.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({
      code: "BROKER_UNAVAILABLE",
      data: { mutationApplied: true },
    });
    await expect(getSessionById(testEnvironment().TEST_DB, SESSION_ID)).resolves.toMatchObject({ revokedAt: NOW });
    await expect(getActiveBansForUser(testEnvironment().TEST_DB, USER_ID, NOW)).resolves.toHaveLength(1);
    expect(broker.mock.calls.filter(([, command]) => command.type === "lease-release-user")).toHaveLength(2);
    await expect(
      testEnvironment().TEST_DB.prepare("SELECT COUNT(*) AS count FROM admin_audit").first<number>("count"),
    ).resolves.toBe(1);
  });

  it("terminates a locked flight and makes a queued result ineligible", async () => {
    await createLockedMission(testEnvironment().TEST_DB, {
      id: MISSION_ID,
      userId: USER_ID,
      aircraftHex: "abc123",
      aircraftClass: "f16c",
      adsbSnapshot: { schemaVersion: 1 },
      airportIcao: "KBIX",
      runwayIdent: "04",
      scoringVersion: "score-v1",
      physicsVersion: "physics-v1",
      assists: { schemaVersion: 1 },
      createdAt: NOW - 1_000,
      lockedAt: NOW - 500,
    });
    const { broker } = brokerHarness();
    const router = createRouter(createAdminRoutes({ broker, now: () => NOW }), dependencies());
    const response = await router.fetch(
      adminRequest(`/api/admin/flights/${MISSION_ID}/terminate`, {
        reason: "End the active flight during incident response",
        confirmation: `TERMINATE ${MISSION_ID}`,
      }, "admin-flight-terminate-0001"),
      runtime(),
    );

    expect(response.status).toBe(200);
    await expect(getMissionById(testEnvironment().TEST_DB, MISSION_ID)).resolves.toMatchObject({ status: "abandoned" });
    expect(broker).toHaveBeenCalledWith(expect.anything(), {
      type: "lease-release",
      userId: USER_ID,
      missionId: MISSION_ID,
    });
  });

  it("unbans the target and restores an active user when no other ban remains", async () => {
    const { broker } = brokerHarness();
    const router = createRouter(
      createAdminRoutes({ broker, now: () => NOW, uuid: () => BAN_ID }),
      dependencies(),
    );
    await router.fetch(adminRequest(`/api/admin/users/${USER_ID}/ban`, {
      scope: "permanent",
      expiresAt: null,
      reason: "Confirmed abuse of ranked submissions",
      confirmation: `BAN ${USER_ID}`,
    }, "admin-ban-for-unban-0001"), runtime());
    const response = await router.fetch(
      adminRequest(`/api/admin/bans/${BAN_ID}/unban`, {
        reason: "Investigation completed and access restored",
      }, "admin-unban-user-0001"),
      runtime(),
    );

    expect(response.status).toBe(200);
    await expect(getActiveBansForUser(testEnvironment().TEST_DB, USER_ID, NOW)).resolves.toHaveLength(0);
    await expect(getUserById(testEnvironment().TEST_DB, USER_ID)).resolves.toMatchObject({ status: "active" });
  });
});
