import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readCsrfToken, verifyCsrfToken } from "../../auth/csrf";
import { authorizeSession, encodeOpaqueToken } from "../../auth/sessions";
import { hashOpaqueToken } from "../../crypto";
import { createSession } from "../../db/sessions";
import { createUser, upsertUserPreferences } from "../../db/users";
import {
  allowEndpointLimiter,
  createRouter,
  type RouterDependencies,
} from "../router";
import type { AuthRouteEnvironment } from "./auth";
import { createMeRoutes } from "./me";

const NOW = 1_700_000_000_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(4));
const ORIGINAL_CSRF = encodeOpaqueToken(new Uint8Array(32).fill(5));
const GET_CSRF = encodeOpaqueToken(new Uint8Array(32).fill(6));
const PATCH_CSRF = encodeOpaqueToken(new Uint8Array(32).fill(7));

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

function runtimeEnv(): AuthRouteEnvironment {
  return {
    APP_ENV: "local",
    DB: (env as TestEnvironment).TEST_DB,
    EMAIL_KEY_SECRET: "unused-test-secret-with-at-least-32-bytes",
    TURNSTILE_SECRET: "unused",
    AUTH_FROM_EMAIL: "sign-in@fly.voygent.app",
    AUTH_EMAIL: { send: vi.fn() } as unknown as SendEmail,
  };
}

function dependencies(): RouterDependencies<AuthRouteEnvironment> {
  return {
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    wallClock: () => new Date(NOW),
    monotonicNow: () => 1,
    digest: async () => "network-digest",
    authorize: (_boundary, request, context, runtime) =>
      authorizeSession(request, runtime.DB, NOW, context.actor),
    verifyCsrf: (request, context) =>
      verifyCsrfToken(
        readCsrfToken(request),
        context.actor.kind === "anonymous" ? null : context.actor.csrfDigest ?? null,
      ),
    resolveLimiter: () => allowEndpointLimiter,
    admitRequest: async ({ forceMode }) => ({ allowed: true, mode: forceMode }),
    observe: vi.fn(),
  };
}

beforeEach(async () => {
  const runtime = env as TestEnvironment;
  await reset();
  await applyD1Migrations(runtime.TEST_DB, runtime.TEST_MIGRATIONS);
  await createUser(runtime.TEST_DB, {
    id: USER_ID,
    emailKey: "a".repeat(64),
    handle: "SkyPilot",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await upsertUserPreferences(runtime.TEST_DB, {
    userId: USER_ID,
    centerLat: 30.69,
    centerLon: -88.04,
    regionKey: "r1:30.75:-88:100",
    defaultAssist: "medium",
    tutorialState: "new",
    coachingEnabled: true,
    updatedAt: NOW,
  });
  await createSession(runtime.TEST_DB, {
    id: SESSION_ID,
    userId: USER_ID,
    sessionDigest: await hashOpaqueToken(SESSION_TOKEN),
    csrfDigest: await hashOpaqueToken(ORIGINAL_CSRF),
    expiresAt: NOW + 60_000,
    lastSeenAt: NOW,
    deviceLabel: null,
    rotatedFromId: null,
    createdAt: NOW,
  });
});

describe("profile routes", () => {
  it("issues a fresh CSRF token and atomically saves clamped center and derived region", async () => {
    let tokenIndex = 0;
    const tokens = [GET_CSRF, PATCH_CSRF];
    const router = createRouter(
      createMeRoutes({
        now: () => NOW + 1,
        opaqueToken: () => tokens[tokenIndex++] ?? PATCH_CSRF,
      }),
      dependencies(),
    );
    const runtime = runtimeEnv();
    const cookie = `__Host-adsb_session=${SESSION_TOKEN}`;

    const read = await router.fetch(
      new Request("https://fly.voygent.app/api/me", { headers: { cookie } }),
      runtime,
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      data: {
        userId: USER_ID,
        handle: "SkyPilot",
        center: { lat: 30.69, lon: -88.04 },
        csrfToken: GET_CSRF,
      },
    });

    const staleCsrf = await router.fetch(
      new Request("https://fly.voygent.app/api/me", {
        method: "PATCH",
        headers: {
          cookie,
          origin: "https://fly.voygent.app",
          "content-type": "application/json",
          "idempotency-key": "profile-update-1",
          "x-csrf-token": ORIGINAL_CSRF,
        },
        body: JSON.stringify({ handle: "GroundPilot" }),
      }),
      runtime,
    );
    expect(staleCsrf.status).toBe(403);

    const updated = await router.fetch(
      new Request("https://fly.voygent.app/api/me", {
        method: "PATCH",
        headers: {
          cookie,
          origin: "https://fly.voygent.app",
          "content-type": "application/json",
          "idempotency-key": "profile-update-2",
          "x-csrf-token": GET_CSRF,
        },
        body: JSON.stringify({
          handle: "GroundPilot",
          center: { lat: 110, lon: -220 },
          defaultAssist: "low",
          tutorialState: "started",
          coachingEnabled: false,
        }),
      }),
      runtime,
    );
    expect(updated.status).toBe(200);
    const payload = await updated.json() as {
      data: { center: { lat: number; lon: number }; regionKey: string; csrfToken: string };
    };
    expect(payload.data).toMatchObject({
      center: { lat: 90, lon: -180 },
      csrfToken: PATCH_CSRF,
    });
    expect(payload.data.regionKey).toMatch(/^r1:90:0:/);

    const oldAgain = await router.fetch(
      new Request("https://fly.voygent.app/api/me", {
        method: "PATCH",
        headers: {
          cookie,
          origin: "https://fly.voygent.app",
          "content-type": "application/json",
          "idempotency-key": "profile-update-3",
          "x-csrf-token": GET_CSRF,
        },
        body: "{}",
      }),
      runtime,
    );
    expect(oldAgain.status).toBe(403);
  });
});
