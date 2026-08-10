import type { Env } from "./env";
import {
  allowEndpointLimiter,
  createCloudflareEndpointLimiter,
  createRouter,
  defineRoute,
  type RouterDependencies,
} from "./http/router";
import { sha256Digest } from "./telemetry/requestContext";

const statusRoute = defineRoute({
  method: "GET",
  path: "/api/status",
  family: "status",
  boundary: "public",
  security: {
    sameOrigin: "not-required",
    csrf: "not-required",
    idempotency: "not-required",
    body: { kind: "none" },
  },
  limiter: { name: "status", retryAfterSeconds: 1 },
  handler: async () => ({ data: { status: "ok" } }),
});

const failClosedLimiter = createCloudflareEndpointLimiter(undefined, 1);

const routerDependencies = {
  uuid: () => crypto.randomUUID(),
  wallClock: () => new Date(),
  monotonicNow: () => performance.now(),
  digest: sha256Digest,
  verifyCsrf: async () => false,
  authorize: async (_boundary, _request, context) => context.actor,
  resolveLimiter: (name) => (name === "status" ? allowEndpointLimiter : failClosedLimiter),
  observe: (event) => console.error("worker_request_error", event),
  resolveMode: () => "NORMAL" as const,
} satisfies RouterDependencies<Env>;

const apiRouter = createRouter<Env>([statusRoute], routerDependencies);

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
