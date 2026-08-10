import { describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { ApiHttpError } from "./response";
import {
  allowEndpointLimiter,
  createCloudflareEndpointLimiter,
  createRouter,
  defineRoute,
  type PipelineStage,
  type RouterDependencies,
} from "./router";

const FIXED_ID = "00000000-0000-4000-8000-000000000003";
const FIXED_TIME = "2026-08-10T15:00:00.000Z";

function fakeEnv(appEnv = "staging") {
  const writeDataPoint = vi.fn();
  return {
    env: {
      APP_ENV: appEnv,
      REQUEST_ANALYTICS: { writeDataPoint },
      ASSETS: { fetch: vi.fn() },
    } as unknown as Env,
    writeDataPoint,
  };
}

function testDependencies(
  overrides: Partial<RouterDependencies<Env>> = {},
): RouterDependencies<Env> {
  return {
    uuid: () => FIXED_ID,
    wallClock: () => new Date(FIXED_TIME),
    monotonicNow: (() => {
      let value = 100;
      return () => value++;
    })(),
    digest: async () => "network-digest",
    verifyCsrf: async () => true,
    authorize: async (_boundary, _request, context) => context.actor,
    resolveLimiter: () => allowEndpointLimiter,
    admitRequest: async ({ forceMode }) => ({ allowed: true, mode: forceMode }),
    observe: vi.fn(),
    ...overrides,
  };
}

const statusRoute = defineRoute({
  method: "GET",
  path: "/api/status",
  family: "status",
  boundary: "public",
  admission: "public-read",
  security: {
    sameOrigin: "not-required",
    csrf: "not-required",
    idempotency: "not-required",
    body: { kind: "none" },
  },
  limiter: { name: "status", retryAfterSeconds: 1 },
  handler: async () => ({ data: { status: "ok" } }),
});

describe("explicit dynamic router", () => {
  it("returns stable JSON 404 and 405 envelopes with Allow and security headers", async () => {
    const { env } = fakeEnv();
    const router = createRouter([statusRoute], testDependencies());

    const missing = await router.fetch(
      new Request("https://fly.voygent.app/api/missing"),
      env,
    );
    const wrongMethod = await router.fetch(
      new Request("https://fly.voygent.app/api/status", { method: "POST" }),
      env,
    );

    await expect(missing.json()).resolves.toMatchObject({
      ok: false,
      code: "NOT_FOUND",
      requestId: FIXED_ID,
      serverTime: FIXED_TIME,
      mode: "NORMAL",
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
    expect(wrongMethod.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(wrongMethod.json()).resolves.toMatchObject({
      code: "METHOD_NOT_ALLOWED",
      requestId: FIXED_ID,
    });
  });

  it("matches conservative dynamic parameters and rejects encoded or punctuation paths", async () => {
    const route = defineRoute({
      ...statusRoute,
      path: "/api/missions/:missionId",
      family: "missions",
      handler: async ({ params }) => ({ data: { missionId: params.missionId } }),
    });
    const { env } = fakeEnv();
    const router = createRouter([route], testDependencies());

    const matched = await router.fetch(
      new Request("https://fly.voygent.app/api/missions/mission_123-ABC"),
      env,
    );
    const rejected = await router.fetch(
      new Request("https://fly.voygent.app/api/missions/a%2Fb"),
      env,
    );

    await expect(matched.json()).resolves.toMatchObject({
      data: { missionId: "mission_123-ABC" },
    });
    expect(rejected.status).toBe(404);
  });

  it("requires boundary, security, and limiter declarations at registration", () => {
    expect(() =>
      defineRoute({
        method: "GET",
        path: "/api/unsafe",
        family: "unsafe",
        handler: async () => ({ data: null }),
      } as never),
    ).toThrow(/boundary/i);
  });

  it("rejects casted, malformed, or under-protected route declarations", () => {
    const invalidRoutes = [
      { ...statusRoute, family: " " },
      { ...statusRoute, admission: undefined },
      { ...statusRoute, limiter: { name: "", retryAfterSeconds: 1 } },
      {
        ...statusRoute,
        security: { ...statusRoute.security, sameOrigin: undefined },
      },
      {
        ...statusRoute,
        security: { ...statusRoute.security, body: { kind: "json", maxBytes: 0 } },
      },
      {
        ...statusRoute,
        method: "POST",
        security: {
          sameOrigin: "not-required",
          csrf: "not-required",
          idempotency: "not-required",
          body: { kind: "none" },
        },
      },
    ];

    for (const route of invalidRoutes) {
      expect(() => defineRoute(route as never)).toThrow();
    }
  });

  it("prefers a static protected route and rejects equally specific overlaps", async () => {
    const publicHandler = vi.fn(async () => ({ data: { source: "public" } }));
    const adminHandler = vi.fn(async () => ({ data: { source: "admin" } }));
    const publicDynamic = defineRoute({
      ...statusRoute,
      path: "/api/items/:itemId",
      family: "items",
      handler: publicHandler,
    });
    const adminStatic = defineRoute({
      ...statusRoute,
      path: "/api/items/config",
      family: "admin-items",
      boundary: "admin",
      handler: adminHandler,
    });
    const { env } = fakeEnv();
    const router = createRouter(
      [publicDynamic, adminStatic],
      testDependencies({
        authorize: async () => ({
          kind: "authenticated",
          userId: "user-1",
          samplingKey: "user:user-1",
        }),
      }),
    );

    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/items/config"),
      env,
    );

    expect(response.status).toBe(403);
    expect(publicHandler).not.toHaveBeenCalled();
    expect(adminHandler).not.toHaveBeenCalled();

    const ambiguous = defineRoute({
      ...publicDynamic,
      path: "/api/items/:name",
    });
    expect(() =>
      createRouter([publicDynamic, ambiguous], testDependencies()),
    ).toThrow(/ambiguous/i);
  });

  it("executes the common mutation pipeline in order", async () => {
    const stages: PipelineStage[] = [];
    const { env } = fakeEnv();
    const route = defineRoute({
      method: "POST",
      path: "/api/missions/:missionId/result",
      family: "mission-result",
      boundary: "authenticated",
      admission: "public-write",
      security: {
        sameOrigin: "required",
        csrf: "required",
        idempotency: "required",
        body: { kind: "json", maxBytes: 128 },
      },
      limiter: { name: "mission-result", retryAfterSeconds: 60 },
      validate: ({ body }) => ({ body }),
      handler: async ({ idempotencyKey }) => ({
        code: "RESULT_ACCEPTED",
        status: 202,
        data: { idempotencyKey },
      }),
    });
    const router = createRouter(
      [route],
      testDependencies({
        onStage: (stage) => stages.push(stage),
        authorize: async () => ({
          kind: "authenticated",
          userId: "user-1",
          samplingKey: "user:user-1",
        }),
      }),
    );

    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/missions/mission-1/result", {
        method: "POST",
        headers: {
          origin: "https://fly.voygent.app",
          "content-type": "application/json",
          "idempotency-key": "mission-result-1",
        },
        body: JSON.stringify({ score: 80 }),
      }),
      env,
    );

    expect(response.status).toBe(202);
    expect(stages).toEqual([
      "context",
      "same-origin",
      "authorization",
      "csrf",
      "idempotency",
      "limiter",
      "broker",
      "body",
      "validation",
      "handler",
      "response",
      "telemetry",
    ]);
  });

  it("fails before the CSRF hook when Origin is absent", async () => {
    const verifyCsrf = vi.fn(async () => true);
    const { env } = fakeEnv();
    const route = defineRoute({
      method: "POST",
      path: "/api/test",
      family: "test",
      boundary: "authenticated",
      admission: "public-write",
      security: {
        sameOrigin: "required",
        csrf: "required",
        idempotency: "required",
        body: { kind: "json" },
      },
      limiter: { name: "test", retryAfterSeconds: 10 },
      validate: ({ body }) => body,
      handler: async () => ({ data: null }),
    });
    const router = createRouter([route], testDependencies({ verifyCsrf }));
    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/test", { method: "POST" }),
      env,
    );

    expect(response.status).toBe(403);
    expect(verifyCsrf).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ code: "ORIGIN_REQUIRED" });
  });

  it("denies an authenticated non-admin actor at an explicit admin boundary", async () => {
    const handler = vi.fn(async () => ({ data: { status: "ok" } }));
    const { env, writeDataPoint } = fakeEnv();
    const route = defineRoute({
      ...statusRoute,
      path: "/api/admin/status",
      family: "admin-status",
      boundary: "admin",
      handler,
    });
    const router = createRouter(
      [route],
      testDependencies({
        authorize: async () => ({
          kind: "authenticated",
          userId: "user-1",
          samplingKey: "user:user-1",
        }),
      }),
    );

    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/admin/status"),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
    expect(handler).not.toHaveBeenCalled();
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("does not consume bodies or emit admitted telemetry before authorization or admission", async () => {
    const handler = vi.fn(async () => ({ data: null }));
    const mutationRoute = defineRoute({
      method: "POST",
      path: "/api/test",
      family: "test",
      boundary: "authenticated",
      admission: "public-write",
      security: {
        sameOrigin: "required",
        csrf: "required",
        idempotency: "required",
        body: { kind: "json" },
      },
      limiter: { name: "test", retryAfterSeconds: 10 },
      validate: ({ body }) => body,
      handler,
    });
    const requestInit = {
      method: "POST",
      headers: {
        origin: "https://fly.voygent.app",
        "content-type": "application/json",
        "idempotency-key": "test-request-1",
      },
      body: JSON.stringify({ secret: "body-must-stay-unread" }),
    } satisfies RequestInit;

    const unauthorized = fakeEnv();
    const unauthorizedRequest = new Request(
      "https://fly.voygent.app/api/test",
      requestInit,
    );
    const unauthorizedResponse = await createRouter(
      [mutationRoute],
      testDependencies(),
    ).fetch(unauthorizedRequest, unauthorized.env);

    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedRequest.bodyUsed).toBe(false);
    expect(unauthorized.writeDataPoint).not.toHaveBeenCalled();

    const rateLimited = fakeEnv();
    const rateLimitedRequest = new Request(
      "https://fly.voygent.app/api/test",
      requestInit,
    );
    const rateLimitedResponse = await createRouter(
      [defineRoute({ ...mutationRoute, boundary: "public" })],
      testDependencies({
        resolveLimiter: () => ({ limit: async () => ({ allowed: false }) }),
      }),
    ).fetch(rateLimitedRequest, rateLimited.env);

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedRequest.bodyUsed).toBe(false);
    expect(rateLimited.writeDataPoint).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns Retry-After when a deterministic endpoint limiter rejects", async () => {
    const { env } = fakeEnv();
    const router = createRouter(
      [statusRoute],
      testDependencies({
        resolveLimiter: () => ({ limit: async () => ({ allowed: false }) }),
      }),
    );
    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/status"),
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
      error: { retryAfterSeconds: 1 },
    });
  });

  it("fails public admission closed while an Access recovery route stays independent", async () => {
    const admitRequest = vi.fn(async () => {
      throw new ApiHttpError(503, "BROKER_UNAVAILABLE", "Broker unavailable");
    });
    const publicHandler = vi.fn(async () => ({ data: { status: "public" } }));
    const recoveryHandler = vi.fn(async () => ({ data: { status: "recovery" } }));
    const recoveryRoute = defineRoute({
      ...statusRoute,
      path: "/api/admin/recovery/status",
      family: "admin-recovery",
      boundary: "admin",
      admission: "recovery",
      handler: recoveryHandler,
    });
    const { env } = fakeEnv();
    const router = createRouter(
      [defineRoute({ ...statusRoute, handler: publicHandler }), recoveryRoute],
      testDependencies({
        admitRequest,
        authorize: async (_boundary, _request, context) => ({
          kind: "admin",
          userId: "admin-1",
          samplingKey: context.actor.samplingKey,
        }),
      }),
    );

    const denied = await router.fetch(
      new Request("https://fly.voygent.app/api/status"),
      env,
    );
    expect(denied.status).toBe(503);
    await expect(denied.json()).resolves.toMatchObject({ code: "BROKER_UNAVAILABLE" });
    expect(publicHandler).not.toHaveBeenCalled();

    const recovery = await router.fetch(
      new Request("https://fly.voygent.app/api/admin/recovery/status"),
      env,
    );
    expect(recovery.status).toBe(200);
    await expect(recovery.json()).resolves.toMatchObject({
      mode: "NORMAL",
      data: { status: "recovery" },
    });
    expect(recoveryHandler).toHaveBeenCalledOnce();
    expect(admitRequest).toHaveBeenCalledOnce();
  });

  it("adapts Cloudflare RateLimit and fails closed on missing or failed bindings", async () => {
    const binding = { limit: vi.fn(async () => ({ success: true })) };
    const limiter = createCloudflareEndpointLimiter(binding, 30);

    await expect(limiter.limit("anon:digest")).resolves.toEqual({ allowed: true });
    expect(binding.limit).toHaveBeenCalledWith({ key: "anon:digest" });
    await expect(
      createCloudflareEndpointLimiter(undefined, 30).limit("anon:digest"),
    ).rejects.toMatchObject({ code: "LIMITER_UNAVAILABLE" });
    await expect(
      createCloudflareEndpointLimiter(
        { limit: async () => Promise.reject(new Error("binding secret")) },
        30,
      ).limit("anon:digest"),
    ).rejects.toMatchObject({ code: "LIMITER_UNAVAILABLE" });
  });

  it("writes one scrubbed non-blocking datapoint per admitted request", async () => {
    const { env, writeDataPoint } = fakeEnv();
    const router = createRouter([statusRoute], testDependencies());
    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/status", {
        headers: { "cf-connecting-ip": "203.0.113.42" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledOnce();
    const datapoint = writeDataPoint.mock.calls[0]?.[0];
    expect(datapoint).toMatchObject({
      blobs: ["status", "2xx", "NORMAL", "none", "none"],
      doubles: [expect.any(Number)],
      indexes: ["anon:network-digest"],
    });
    expect(JSON.stringify(datapoint)).not.toContain("203.0.113.42");
  });

  it("does not let telemetry failure alter a successful response", async () => {
    const { env, writeDataPoint } = fakeEnv();
    writeDataPoint.mockImplementation(() => {
      throw new Error("analytics failed");
    });
    const router = createRouter([statusRoute], testDependencies());
    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/status"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, code: "OK" });
  });

  it("turns unexpected exceptions into generic INTERNAL_ERROR and observes only redacted detail", async () => {
    const observe = vi.fn();
    const { env } = fakeEnv();
    const route = defineRoute({
      ...statusRoute,
      handler: async () => {
        const error = new Error("pilot@example.com Bearer raw-token from 203.0.113.42");
        error.name = "SessionToken-rawSecret123";
        throw error;
      },
    });
    const router = createRouter([route], testDependencies({ observe }));
    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/status"),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      requestId: FIXED_ID,
      serverTime: FIXED_TIME,
      mode: "NORMAL",
      error: { message: "An unexpected error occurred" },
    });
    expect(observe).toHaveBeenCalledOnce();
    const observed = JSON.stringify(observe.mock.calls[0]);
    expect(observed).not.toContain("pilot@example.com");
    expect(observed).not.toContain("raw-token");
    expect(observed).not.toContain("203.0.113.42");
    expect(observed).not.toContain("SessionToken-rawSecret123");
    expect(observed).toContain('"errorType":"Error"');
  });

  it.each([
    ["mode resolution", { resolveMode: () => { throw new Error("mode secret"); } }],
    ["actor digest", { digest: async () => Promise.reject(new Error("digest secret")) }],
  ])("secures a stable INTERNAL_ERROR when %s fails during context creation", async (_label, override) => {
    const observe = vi.fn();
    const { env, writeDataPoint } = fakeEnv();
    const router = createRouter(
      [statusRoute],
      testDependencies({ ...override, observe }),
    );

    const response = await router.fetch(
      new Request("https://fly.voygent.app/api/status"),
      env,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "INTERNAL_ERROR",
      mode: "NORMAL",
      requestId: expect.any(String),
    });
    expect(observe).toHaveBeenCalledOnce();
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it.each([
    ["an error status", { status: 500, code: "OK" }],
    ["an unregistered success code", { status: 200, code: "MADE_UP" }],
  ])("turns a handler result with %s into INTERNAL_ERROR", async (_label, result) => {
    const observe = vi.fn();
    const { env, writeDataPoint } = fakeEnv();
    const route = defineRoute({
      ...statusRoute,
      handler: async () => result as never,
    });
    const response = await createRouter(
      [route],
      testDependencies({ observe }),
    ).fetch(new Request("https://fly.voygent.app/api/status"), env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "INTERNAL_ERROR",
    });
    expect(observe).toHaveBeenCalledOnce();
    expect(writeDataPoint).toHaveBeenCalledOnce();
    expect(writeDataPoint.mock.calls[0]?.[0]?.blobs?.slice(0, 2)).toEqual(["status", "5xx"]);
  });
});
