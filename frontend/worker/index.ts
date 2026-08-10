import type { Env } from "./env";
import { isSystemMode, type SystemMode } from "../src/shared/mode";
import {
  sendBrokerCommand,
  type AdmissionResult,
  type BrokerCommand,
} from "./durable/protocol";
import type { TrafficRequest } from "./adsb/traffic";
import {
  allowEndpointLimiter,
  createCloudflareEndpointLimiter,
  createRouter,
  defineRoute,
  type RouterDependencies,
} from "./http/router";
import { ApiHttpError } from "./http/response";
import {
  clampRadiusNm,
  validateCoordinates,
  ValidationError,
} from "./http/validation";
import { sha256Digest } from "./telemetry/requestContext";
import { authorizeSession } from "./auth/sessions";
import { readCsrfToken, verifyCsrfToken } from "./auth/csrf";
import { createAuthRoutes } from "./http/routes/auth";
import { createMeRoutes } from "./http/routes/me";
import { createMissionRoutes } from "./http/routes/missions";

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

const recoveryStatusRoute = defineRoute({
  method: "GET",
  path: "/api/admin/recovery/status",
  family: "admin-recovery",
  boundary: "admin",
  admission: "recovery",
  security: {
    sameOrigin: "not-required",
    csrf: "not-required",
    idempotency: "not-required",
    body: { kind: "none" },
  },
  limiter: { name: "admin-recovery", retryAfterSeconds: 1 },
  handler: async ({ context }) => ({
    data: {
      status: "recovery-ready",
      forceMode: context.mode,
      broker: "unchecked",
    },
  }),
});

function exactQuery(request: Request, expected: readonly string[]): URLSearchParams {
  const search = new URL(request.url).searchParams;
  const actual = [...new Set(search.keys())].sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    !actual.every((key, index) => key === wanted[index]) ||
    expected.some((key) => search.getAll(key).length !== 1)
  ) throw new ValidationError(400, "INVALID_REQUEST", "Traffic query is invalid");
  return search;
}

const configRoute = defineRoute({
  method: "GET",
  path: "/api/config",
  family: "config",
  boundary: "public",
  admission: "public-read",
  security: {
    sameOrigin: "not-required",
    csrf: "not-required",
    idempotency: "not-required",
    body: { kind: "none" },
  },
  limiter: { name: "config", retryAfterSeconds: 1 },
  handler: async ({ env }) => {
    const runtime = env as Env;
    const home = validateCoordinates(
      runtime.HOME_LAT ?? "30.6944",
      runtime.HOME_LON ?? "-88.0399",
    );
    return {
      data: {
        home: { lat: home.latitude, lon: home.longitude },
        ...(runtime.TURNSTILE_SITE_KEY === undefined
          ? {}
          : { turnstileSiteKey: runtime.TURNSTILE_SITE_KEY }),
      },
    };
  },
});

const trafficRoute = defineRoute({
  method: "GET",
  path: "/api/traffic",
  family: "traffic",
  boundary: "public",
  admission: "public-read",
  security: {
    sameOrigin: "not-required",
    csrf: "not-required",
    idempotency: "not-required",
    body: { kind: "none" },
  },
  limiter: { name: "traffic", retryAfterSeconds: 15 },
  validate: ({ request }) => {
    const search = exactQuery(request, ["lat", "lon", "radius_nm"]);
    const coordinates = validateCoordinates(search.get("lat"), search.get("lon"));
    return {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      radiusNm: clampRadiusNm(search.get("radius_nm")),
    };
  },
  handler: async ({ context, validated, env }) => {
    const query = validated as Omit<TrafficRequest, "audience">;
    const request: TrafficRequest = {
      ...query,
      audience: context.actor.kind === "anonymous"
        ? { kind: "anonymous" }
        : { kind: "signed", userId: context.actor.userId },
    };
    try {
      const result = await sendBrokerCommand((env as Env).ADSB_BROKER, {
        type: "traffic",
        forceMode: context.mode,
        request,
      });
      if (result.type !== "traffic") throw new TypeError("Unexpected broker response");
      return { data: result.traffic };
    } catch (error) {
      throw new ApiHttpError(
        503,
        "BROKER_UNAVAILABLE",
        "Traffic broker is unavailable",
        { cause: error },
      );
    }
  },
});

const failClosedLimiter = createCloudflareEndpointLimiter(undefined, 1);

export function resolveEndpointLimiter(name: string, env: Env) {
  if (
    name === "status" || name === "config" || name === "admin-recovery" ||
    name === "auth-request" || name === "auth-consume" ||
    name === "auth-session" || name === "profile"
  ) return allowEndpointLimiter;
  if (name === "traffic") {
    return env.APP_ENV === "local"
      ? allowEndpointLimiter
      : createCloudflareEndpointLimiter(env.TRAFFIC_REQUEST_RATE_LIMITER, 15);
  }
  if (name === "missions") {
    return env.APP_ENV === "local"
      ? allowEndpointLimiter
      : createCloudflareEndpointLimiter(env.MISSION_REQUEST_RATE_LIMITER, 5);
  }
  return failClosedLimiter;
}

function forceMode(env: Env): SystemMode {
  if (!isSystemMode(env.FORCE_MODE)) throw new TypeError("FORCE_MODE is invalid");
  return env.FORCE_MODE;
}

const routerDependencies = {
  uuid: () => crypto.randomUUID(),
  wallClock: () => new Date(),
  monotonicNow: () => performance.now(),
  digest: sha256Digest,
  verifyCsrf: (request, context, env) =>
    verifyCsrfToken(
      readCsrfToken(request),
      context.actor.kind === "anonymous" ? null : context.actor.sessionId ?? null,
      env.CSRF_SECRET,
    ),
  authorize: (_boundary, request, context, env) =>
    authorizeSession(request, env.DB, Date.parse(context.serverTime), context.actor),
  resolveLimiter: resolveEndpointLimiter,
  admitRequest: async ({ kind, forceMode: deploymentMode, context, params }, env) => {
    if (deploymentMode === "KILL_SWITCH") {
      return { allowed: false, mode: "KILL_SWITCH" as const };
    }

    let command: BrokerCommand;
    if (kind === "active-flight") {
      const missionId = params.missionId;
      if (context.actor.kind === "anonymous" || missionId === undefined) {
        throw new ApiHttpError(
          503,
          "ADMISSION_DENIED",
          "Active flight lease is required",
        );
      }
      command = {
        type: "admit",
        kind,
        forceMode: deploymentMode,
        userId: context.actor.userId,
        missionId,
      };
    } else {
      command = { type: "admit", kind, forceMode: deploymentMode };
    }

    let result: AdmissionResult;
    try {
      const brokerResult = await sendBrokerCommand(env.ADSB_BROKER, command);
      if (brokerResult.type !== "admission") {
        throw new Error("Unexpected broker response");
      }
      result = brokerResult;
    } catch (error) {
      throw new ApiHttpError(
        503,
        "BROKER_UNAVAILABLE",
        "Broker admission is unavailable",
        { cause: error },
      );
    }
    return { allowed: result.allowed, mode: result.status.effectiveMode };
  },
  observe: (event) => console.error("worker_request_error", event),
  resolveMode: forceMode,
} satisfies RouterDependencies<Env>;

const apiRouter = createRouter<Env>(
  [
    statusRoute,
    configRoute,
    trafficRoute,
    ...createAuthRoutes(),
    ...createMeRoutes(),
    ...createMissionRoutes(),
    recoveryStatusRoute,
  ],
  routerDependencies,
);

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return apiRouter.fetch(request, env);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export default worker;
export { AdsbBroker } from "./durable/AdsbBroker";
