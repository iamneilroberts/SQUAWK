import type { Env } from "./env";
import { isSystemMode, type SystemMode } from "../src/shared/mode";
import {
  sendBrokerCommand,
  type AdmissionResult,
  type BrokerCommand,
} from "./durable/protocol";
import {
  allowEndpointLimiter,
  createCloudflareEndpointLimiter,
  createRouter,
  defineRoute,
  type RouterDependencies,
} from "./http/router";
import { ApiHttpError } from "./http/response";
import { sha256Digest } from "./telemetry/requestContext";

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

const failClosedLimiter = createCloudflareEndpointLimiter(undefined, 1);

function forceMode(env: Env): SystemMode {
  if (!isSystemMode(env.FORCE_MODE)) throw new TypeError("FORCE_MODE is invalid");
  return env.FORCE_MODE;
}

const routerDependencies = {
  uuid: () => crypto.randomUUID(),
  wallClock: () => new Date(),
  monotonicNow: () => performance.now(),
  digest: sha256Digest,
  verifyCsrf: async () => false,
  authorize: async (_boundary, _request, context) => context.actor,
  resolveLimiter: (name) =>
    name === "status" || name === "admin-recovery"
      ? allowEndpointLimiter
      : failClosedLimiter,
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
  [statusRoute, recoveryStatusRoute],
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
