import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveEmailKey, hashOpaqueToken } from "../../crypto";
import { banUser } from "../../db/bans";
import { createSession, getActiveSessionByDigest } from "../../db/sessions";
import { createUser } from "../../db/users";
import { authorizeSession, encodeOpaqueToken, sessionCookie } from "../../auth/sessions";
import {
  allowEndpointLimiter,
  createRouter,
  type RouterDependencies,
} from "../router";
import { createAuthRoutes, type AuthRouteEnvironment } from "./auth";

const NOW = 1_700_000_000_000;
const SERVER_TIME = new Date(NOW).toISOString();
const HMAC_SECRET = "test-only-email-key-secret-with-at-least-32-bytes";
const EMAIL = "pilot@example.com";
const MAGIC_TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(1));
const SESSION_TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(2));
const CSRF_TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(3));
const UUIDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];
let routerSequence = 0;

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

function runtimeEnv(): AuthRouteEnvironment {
  return {
    APP_ENV: "local",
    DB: (env as TestEnvironment).TEST_DB,
    EMAIL_KEY_SECRET: HMAC_SECRET,
    TURNSTILE_SECRET: "turnstile-secret",
    AUTH_FROM_EMAIL: "sign-in@fly.voygent.app",
    AUTH_EMAIL: { send: vi.fn() } as unknown as SendEmail,
    HOME_LAT: "30.6944",
    HOME_LON: "-88.0399",
  };
}

function request(path: string, body: unknown, cookie?: string): Request {
  return new Request(`https://fly.voygent.app${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://fly.voygent.app",
      "idempotency-key": "request-test-123",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

function authRouter(options: {
  challenge?: boolean;
  ipAllowed?: boolean;
  send?: (to: string, link: string) => Promise<void>;
} = {}) {
  let uuidIndex = 0;
  const sequence = routerSequence++;
  let tokenIndex = 0;
  const tokens = [MAGIC_TOKEN, SESSION_TOKEN, CSRF_TOKEN];
  const routes = createAuthRoutes({
    now: () => NOW,
    uuid: () =>
      `10000000-0000-4000-8000-${String(sequence * 10 + uuidIndex++).padStart(12, "0")}`,
    opaqueToken: () => tokens[tokenIndex++] ?? encodeOpaqueToken(crypto.getRandomValues(new Uint8Array(32))),
    verifyChallenge: async () => options.challenge ?? true,
    limitIp: async () => options.ipAllowed ?? true,
    sendEmail: options.send ?? (async () => undefined),
  });
  const dependencies: RouterDependencies<AuthRouteEnvironment> = {
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    wallClock: () => new Date(NOW),
    monotonicNow: () => 1,
    digest: async () => "network-digest",
    authorize: async (_boundary, incoming, context, runtime) =>
      authorizeSession(incoming, runtime.DB, NOW, context.actor),
    verifyCsrf: async () => true,
    resolveLimiter: () => allowEndpointLimiter,
    admitRequest: async ({ forceMode }) => ({ allowed: true, mode: forceMode }),
    observe: vi.fn(),
  };
  return createRouter(routes, dependencies);
}

beforeEach(async () => {
  const runtime = env as TestEnvironment;
  await reset();
  await applyD1Migrations(runtime.TEST_DB, runtime.TEST_MIGRATIONS);
});

describe("auth HTTP routes", () => {
  it("returns one constant public response for challenge, IP, ban, and email failures", async () => {
    const expected = {
      ok: true,
      code: "AUTH_LINK_REQUESTED",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      serverTime: SERVER_TIME,
      mode: "NORMAL",
      data: { message: "If the address can sign in, a link will arrive shortly." },
    };

    const challengeFailure = await authRouter({ challenge: false }).fetch(
      request("/api/auth/request", { email: EMAIL, turnstileToken: "challenge" }),
      runtimeEnv(),
    );
    const ipFailure = await authRouter({ ipAllowed: false }).fetch(
      request("/api/auth/request", { email: EMAIL, turnstileToken: "challenge" }),
      runtimeEnv(),
    );
    const emailFailure = await authRouter({
      send: async () => {
        throw new Error("email unavailable");
      },
    }).fetch(
      request("/api/auth/request", { email: EMAIL, turnstileToken: "challenge" }),
      runtimeEnv(),
    );

    const emailKey = await deriveEmailKey(EMAIL, HMAC_SECRET);
    await createUser((env as TestEnvironment).TEST_DB, {
      id: "88888888-8888-4888-8888-888888888888",
      emailKey,
      handle: "BannedPilot",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await banUser((env as TestEnvironment).TEST_DB, {
      id: "99999999-9999-4999-8999-999999999999",
      userId: "88888888-8888-4888-8888-888888888888",
      emailKey: null,
      scope: "permanent",
      reason: "Identity ban",
      actor: "access:admin",
      expiresAt: null,
      createdAt: NOW,
    });
    const banned = await authRouter().fetch(
      request("/api/auth/request", { email: EMAIL, turnstileToken: "challenge" }),
      runtimeEnv(),
    );

    for (const response of [challengeFailure, ipFailure, emailFailure, banned]) {
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual(expected);
    }
  });

  it("sends a fragment link, stores only digests, and cannot consume on GET", async () => {
    const sent = vi.fn(async () => undefined);
    const router = authRouter({ send: sent });
    const runtime = runtimeEnv();

    const requested = await router.fetch(
      request("/api/auth/request", { email: ` ${EMAIL.toUpperCase()} `, turnstileToken: "challenge" }),
      runtime,
    );
    expect(requested.status).toBe(202);
    expect(sent).toHaveBeenCalledWith(
      EMAIL,
      `https://fly.voygent.app/#auth_token=${MAGIC_TOKEN}`,
      runtime,
    );

    const stored = JSON.stringify(
      await runtime.DB.prepare("SELECT * FROM magic_links").all(),
    );
    expect(stored).not.toContain(EMAIL);
    expect(stored).not.toContain(MAGIC_TOKEN);

    const preview = await router.fetch(
      new Request("https://fly.voygent.app/api/auth/consume"),
      runtime,
    );
    expect(preview.status).toBe(405);

    const consumed = await router.fetch(
      request("/api/auth/consume", { token: MAGIC_TOKEN }),
      runtime,
    );
    expect(consumed.status).toBe(200);
    expect(consumed.headers.get("set-cookie")).toContain("__Host-adsb_session=");
    expect(consumed.headers.get("set-cookie")).not.toContain(MAGIC_TOKEN);
    await expect(consumed.json()).resolves.toMatchObject({
      ok: true,
      code: "SIGNED_IN",
      data: { csrfToken: CSRF_TOKEN },
    });

    const replay = await router.fetch(
      request("/api/auth/consume", { token: MAGIC_TOKEN }),
      runtime,
    );
    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toMatchObject({ code: "AUTH_LINK_INVALID" });
  });

  it("rejects malformed and extra-field request bodies before challenge or persistence", async () => {
    const router = authRouter();
    const runtime = runtimeEnv();
    for (const body of [
      { email: "not-an-email", turnstileToken: "challenge" },
      { email: EMAIL, turnstileToken: "challenge", redirect: "https://evil.example" },
    ]) {
      const response = await router.fetch(request("/api/auth/request", body), runtime);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_REQUEST" });
    }
    await expect(
      runtime.DB.prepare("SELECT COUNT(*) AS count FROM magic_links").first<number>("count"),
    ).resolves.toBe(0);
  });

  it("does not revoke a valid session when outbound auth email is unavailable", async () => {
    const runtime = runtimeEnv();
    const userId = UUIDS[0] ?? "";
    const sessionId = UUIDS[1] ?? "";
    await createUser(runtime.DB, {
      id: userId,
      emailKey: await deriveEmailKey(EMAIL, HMAC_SECRET),
      handle: "ExistingPilot",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await createSession(runtime.DB, {
      id: sessionId,
      userId,
      sessionDigest: await hashOpaqueToken(SESSION_TOKEN),
      csrfDigest: await hashOpaqueToken(CSRF_TOKEN),
      expiresAt: NOW + 60_000,
      lastSeenAt: NOW,
      deviceLabel: null,
      rotatedFromId: null,
      createdAt: NOW,
    });

    const response = await authRouter({
      send: async () => {
        throw new Error("email unavailable");
      },
    }).fetch(
      request(
        "/api/auth/request",
        { email: EMAIL, turnstileToken: "challenge" },
        sessionCookie(SESSION_TOKEN, 60),
      ),
      runtime,
    );

    expect(response.status).toBe(202);
    await expect(
      getActiveSessionByDigest(runtime.DB, await hashOpaqueToken(SESSION_TOKEN), NOW + 1),
    ).resolves.toMatchObject({ id: sessionId });
  });
});
