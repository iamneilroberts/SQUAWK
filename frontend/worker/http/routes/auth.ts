import {
  AUTH_CONSUME_BODY_MAX_BYTES,
  AUTH_EMAIL_RATE_MAXIMUM,
  AUTH_EMAIL_RATE_WINDOW_MS,
  AUTH_MAGIC_LINK_TTL_MS,
  AUTH_REQUEST_BODY_MAX_BYTES,
  AUTH_SESSION_TTL_SECONDS,
  DEFAULT_PROFILE_RADIUS_NM,
  TRAFFIC_MAX_RADIUS_NM,
  TRAFFIC_PROVIDER_RADIUS_STEP_NM,
  TRAFFIC_REGION_CELL_DEGREES,
} from "../../../src/shared/limits";
import { normalizeRegion } from "../../adsb/region";
import { deriveCsrfToken } from "../../auth/csrf";
import { hashOpaqueToken } from "../../crypto";
import {
  hasActiveBanForEmailKey,
  hasActiveBanForIdentity,
} from "../../db/bans";
import { revokeSessionById } from "../../db/sessions";
import {
  createMagicLink,
  deleteMagicLinkByDigest,
  getUserByEmailKey,
} from "../../db/users";
import {
  deriveEmailIdentity,
  normalizeEmail,
  reserveEmailRateLimit,
} from "../../auth/emailIdentity";
import { buildMagicLinkUrl, sendMagicLinkEmail } from "../../auth/email";
import { consumeMagicLinkSession } from "../../auth/magicLinks";
import {
  clearSessionCookie,
  generateOpaqueToken,
  sessionCookie,
} from "../../auth/sessions";
import { verifyTurnstile } from "../../auth/turnstile";
import { ApiHttpError } from "../response";
import { defineRoute, type RouteDefinition } from "../router";
import { ValidationError, validateCoordinates } from "../validation";
import { coarseIpNetwork, sha256Digest } from "../../telemetry/requestContext";

const MAGIC_LINK_ACTION = "magic-link";
const MAGIC_LINK_PUBLIC_MESSAGE =
  "If the address can sign in, a link will arrive shortly.";
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type AuthRouteEnvironment = {
  APP_ENV?: string;
  REQUEST_ANALYTICS?: AnalyticsEngineDataset;
  DB: D1Database;
  CSRF_SECRET: string;
  EMAIL_KEY_SECRET: string;
  TURNSTILE_SECRET: string;
  AUTH_FROM_EMAIL: string;
  AUTH_EMAIL: SendEmail;
  AUTH_REQUEST_RATE_LIMITER?: RateLimit;
  PUBLIC_ORIGIN?: string;
  HOME_LAT?: string;
  HOME_LON?: string;
};

export type AuthRouteDependencies = {
  now: () => number;
  uuid: () => string;
  opaqueToken: () => string;
  verifyChallenge: (input: {
    request: Request;
    response: string;
    requestId: string;
    env: AuthRouteEnvironment;
  }) => Promise<boolean>;
  limitIp: (key: string, env: AuthRouteEnvironment) => Promise<boolean>;
  sendEmail: (
    normalizedEmail: string,
    link: string,
    env: AuthRouteEnvironment,
  ) => Promise<void>;
};

const DEFAULT_DEPENDENCIES: AuthRouteDependencies = {
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
  opaqueToken: generateOpaqueToken,
  verifyChallenge: ({ request, response, requestId, env }) =>
    verifyTurnstile({
      secret: env.TURNSTILE_SECRET,
      response,
      remoteIp: request.headers.get("cf-connecting-ip"),
      idempotencyKey: requestId,
      expectedAction: MAGIC_LINK_ACTION,
      expectedHostname: new URL(request.url).hostname,
    }),
  limitIp: async (key, env) => {
    if (env.AUTH_REQUEST_RATE_LIMITER === undefined) return env.APP_ENV === "local";
    try {
      return (await env.AUTH_REQUEST_RATE_LIMITER.limit({ key })).success;
    } catch {
      return false;
    }
  },
  sendEmail: (normalizedEmail, link, env) =>
    sendMagicLinkEmail(env.AUTH_EMAIL, {
      from: env.AUTH_FROM_EMAIL,
      to: normalizedEmail,
      link,
    }),
};

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(400, "INVALID_REQUEST", "Request body is invalid");
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    !actual.every((key, index) => key === expected[index])
  ) {
    throw new ValidationError(400, "INVALID_REQUEST", "Request body is invalid");
  }
  return record;
}

function validateRequestBody(body: unknown): { email: string; turnstileToken: string } {
  const value = exactRecord(body, ["email", "turnstileToken"]);
  if (
    typeof value.email !== "string" ||
    value.email.length < 3 ||
    value.email.length > 254 ||
    typeof value.turnstileToken !== "string" ||
    value.turnstileToken.length < 1 ||
    value.turnstileToken.length > 2_048
  ) {
    throw new ValidationError(400, "INVALID_REQUEST", "Request body is invalid");
  }
  try {
    return { email: normalizeEmail(value.email), turnstileToken: value.turnstileToken };
  } catch {
    throw new ValidationError(400, "INVALID_REQUEST", "Request body is invalid");
  }
}

function validateConsumeBody(body: unknown): { token: string } {
  const value = exactRecord(body, ["token"]);
  if (typeof value.token !== "string" || !OPAQUE_TOKEN.test(value.token)) {
    throw new ValidationError(400, "INVALID_REQUEST", "Request body is invalid");
  }
  return { token: value.token };
}

function validateEmptyBody(body: unknown): Record<string, never> {
  exactRecord(body, []);
  return {};
}

function publicRequestResult() {
  return {
    status: 202,
    code: "AUTH_LINK_REQUESTED" as const,
    data: { message: MAGIC_LINK_PUBLIC_MESSAGE },
  };
}

export function createAuthRoutes(
  overrides: Partial<AuthRouteDependencies> = {},
): readonly RouteDefinition[] {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };

  const requestRoute = defineRoute({
    method: "POST",
    path: "/api/auth/request",
    family: "auth-request",
    boundary: "public",
    admission: "registration",
    security: {
      sameOrigin: "required",
      csrf: "not-required",
      idempotency: "required",
      body: { kind: "json", maxBytes: AUTH_REQUEST_BODY_MAX_BYTES },
    },
    limiter: { name: "auth-request", retryAfterSeconds: 60 },
    validate: ({ body }) => validateRequestBody(body),
    handler: async ({ request, context, validated, env }) => {
      const runtime = env as AuthRouteEnvironment;
      const input = validated as ReturnType<typeof validateRequestBody>;
      const ipRateKey = await sha256Digest(
        `auth-ip:${coarseIpNetwork(request.headers.get("cf-connecting-ip"))}`,
      );
      if (!(await dependencies.limitIp(ipRateKey, runtime))) {
        return publicRequestResult();
      }
      if (
        !(await dependencies.verifyChallenge({
          request,
          response: input.turnstileToken,
          requestId: context.requestId,
          env: runtime,
        }))
      ) {
        return publicRequestResult();
      }

      const now = dependencies.now();
      const identity = await deriveEmailIdentity(input.email, runtime.EMAIL_KEY_SECRET);
      const reserved = await reserveEmailRateLimit(runtime.DB, {
        id: dependencies.uuid(),
        emailKey: identity.emailKey,
        requestedAt: now,
        windowMs: AUTH_EMAIL_RATE_WINDOW_MS,
        maximum: AUTH_EMAIL_RATE_MAXIMUM,
      });
      const existingUser = await getUserByEmailKey(runtime.DB, identity.emailKey);
      const identityBanned =
        await hasActiveBanForEmailKey(runtime.DB, identity.emailKey, now) ||
        (existingUser !== null && (
          existingUser.status === "disabled" ||
          await hasActiveBanForIdentity(
            runtime.DB,
            existingUser.id,
            existingUser.emailKey,
            now,
          )
        ));
      if (!reserved || identityBanned) {
        return publicRequestResult();
      }

      const token = dependencies.opaqueToken();
      const tokenDigest = await hashOpaqueToken(token);
      await createMagicLink(runtime.DB, {
        id: dependencies.uuid(),
        tokenDigest,
        emailKey: identity.emailKey,
        expiresAt: now + AUTH_MAGIC_LINK_TTL_MS,
        requestId: context.requestId,
        requestedAt: now,
      });

      try {
        const publicOrigin = runtime.PUBLIC_ORIGIN ?? new URL(request.url).origin;
        await dependencies.sendEmail(
          identity.normalizedEmail,
          buildMagicLinkUrl(publicOrigin, token),
          runtime,
        );
      } catch {
        try {
          await deleteMagicLinkByDigest(runtime.DB, tokenDigest);
        } catch {
          // A failed cleanup only leaves an expiring, undelivered digest.
        }
      }
      return publicRequestResult();
    },
  });

  const consumeRoute = defineRoute({
    method: "POST",
    path: "/api/auth/consume",
    family: "auth-consume",
    boundary: "public",
    admission: "public-write",
    security: {
      sameOrigin: "required",
      csrf: "not-required",
      idempotency: "required",
      body: { kind: "json", maxBytes: AUTH_CONSUME_BODY_MAX_BYTES },
    },
    limiter: { name: "auth-consume", retryAfterSeconds: 10 },
    validate: ({ body }) => validateConsumeBody(body),
    handler: async ({ validated, env }) => {
      const runtime = env as AuthRouteEnvironment;
      const { token } = validated as ReturnType<typeof validateConsumeBody>;
      const now = dependencies.now();
      const sessionToken = dependencies.opaqueToken();
      const home = validateCoordinates(
        runtime.HOME_LAT ?? "30.6944",
        runtime.HOME_LON ?? "-88.0399",
      );
      const region = normalizeRegion(
        home.latitude,
        home.longitude,
        DEFAULT_PROFILE_RADIUS_NM,
        {
          cellDegrees: TRAFFIC_REGION_CELL_DEGREES,
          providerRadiusStepNm: TRAFFIC_PROVIDER_RADIUS_STEP_NM,
          providerMaxRadiusNm: TRAFFIC_MAX_RADIUS_NM,
        },
      );
      const userId = dependencies.uuid();
      const consumeNonce = dependencies.uuid();
      const sessionId = dependencies.uuid();
      const csrfToken = await deriveCsrfToken(sessionId, runtime.CSRF_SECRET);
      const session = await consumeMagicLinkSession(runtime.DB, {
        tokenDigest: await hashOpaqueToken(token),
        consumedAt: now,
        consumeNonce,
        userId,
        handle: `Pilot_${userId.replaceAll("-", "").slice(0, 8)}`,
        centerLat: home.latitude,
        centerLon: home.longitude,
        regionKey: region.regionKey,
        sessionId,
        sessionDigest: await hashOpaqueToken(sessionToken),
        csrfDigest: await hashOpaqueToken(csrfToken),
        sessionExpiresAt: now + AUTH_SESSION_TTL_SECONDS * 1_000,
        deviceLabel: null,
      });
      if (session === null) {
        throw new ApiHttpError(
          401,
          "AUTH_LINK_INVALID",
          "The sign-in link is invalid or expired",
        );
      }
      return {
        code: "SIGNED_IN" as const,
        data: { csrfToken },
        headers: {
          "set-cookie": sessionCookie(sessionToken, AUTH_SESSION_TTL_SECONDS),
        },
      };
    },
  });

  const logoutRoute = defineRoute({
    method: "POST",
    path: "/api/auth/logout",
    family: "auth-logout",
    boundary: "authenticated",
    admission: "public-write",
    security: {
      sameOrigin: "required",
      csrf: "required",
      idempotency: "required",
      body: { kind: "json", maxBytes: AUTH_CONSUME_BODY_MAX_BYTES },
    },
    limiter: { name: "auth-session", retryAfterSeconds: 10 },
    validate: ({ body }) => validateEmptyBody(body),
    handler: async ({ context, env }) => {
      if (
        context.actor.kind === "anonymous" ||
        context.actor.sessionId === undefined
      ) {
        throw new ApiHttpError(401, "AUTH_REQUIRED", "Authentication is required");
      }
      const revoked = await revokeSessionById(
        (env as AuthRouteEnvironment).DB,
        context.actor.sessionId,
        context.actor.userId,
        dependencies.now(),
      );
      if (!revoked) {
        throw new ApiHttpError(401, "AUTH_REQUIRED", "Authentication is required");
      }
      return {
        code: "SIGNED_OUT" as const,
        data: { signedOut: true },
        headers: { "set-cookie": clearSessionCookie() },
      };
    },
  });

  return [requestRoute, consumeRoute, logoutRoute];
}
