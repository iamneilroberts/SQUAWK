import type { TrustBoundary } from "../../src/shared/api";
import { API_SUCCESS_CODES, type ApiSuccessCode } from "../../src/shared/codes";
import {
  isSystemMode,
  mostRestrictiveMode,
  type SystemMode,
} from "../../src/shared/mode";
import { readIdempotencyKey } from "./idempotency";
import { ApiHttpError, jsonEnvelope } from "./response";
import { applySecurityHeaders, enforceSameOrigin, type AppEnvironment } from "./security";
import { readBoundedJsonBody } from "./validation";
import {
  createRequestContext,
  type RequestActor,
  type RequestContext,
  type RequestContextDependencies,
} from "../telemetry/requestContext";
import { redactSensitive, safeErrorName } from "../telemetry/redact";

export type PipelineStage =
  | "context"
  | "same-origin"
  | "authorization"
  | "csrf"
  | "idempotency"
  | "limiter"
  | "broker"
  | "body"
  | "validation"
  | "handler"
  | "response"
  | "telemetry";

export type EndpointLimiter = {
  limit: (key: string) => Promise<{ allowed: boolean }>;
};

export const allowEndpointLimiter: EndpointLimiter = {
  limit: async () => ({ allowed: true }),
};

export function createCloudflareEndpointLimiter(
  binding: RateLimit | undefined,
  _retryAfterSeconds: number,
): EndpointLimiter {
  return {
    async limit(key) {
      if (binding === undefined) {
        throw new ApiHttpError(503, "LIMITER_UNAVAILABLE", "Request limiter is unavailable");
      }
      try {
        const outcome = await binding.limit({ key });
        return { allowed: outcome.success };
      } catch (error) {
        throw new ApiHttpError(
          503,
          "LIMITER_UNAVAILABLE",
          "Request limiter is unavailable",
          { cause: error },
        );
      }
    },
  };
}

type RuntimeEnvironment = {
  APP_ENV?: string;
  REQUEST_ANALYTICS?: AnalyticsEngineDataset;
};

type RouteSecurity = {
  sameOrigin: "required" | "not-required";
  csrf: "required" | "not-required";
  idempotency: "required" | "not-required";
  body:
    | { kind: "none" }
    | { kind: "json"; maxBytes?: number };
};

export type RouteAdmission = "public-read" | "public-write" | "active-flight" | "recovery";

export type RouteRequest = {
  request: Request;
  context: RequestContext;
  params: Record<string, string>;
  body: unknown;
  validated: unknown;
  idempotencyKey?: string;
  env: unknown;
};

export type RouteResult = {
  status?: number;
  code?: ApiSuccessCode;
  data?: unknown;
  headers?: HeadersInit;
};

export type RouteDefinition = {
  method: string;
  path: string;
  family: string;
  boundary: TrustBoundary;
  admission: RouteAdmission;
  security: RouteSecurity;
  limiter: { name: string; retryAfterSeconds: number };
  validate?: (input: {
    body: unknown;
    params: Record<string, string>;
    request: Request;
    context: RequestContext;
  }) => unknown | Promise<unknown>;
  handler: (input: RouteRequest) => RouteResult | Promise<RouteResult>;
};

export type BrokerAdmissionRequest = {
  kind: Exclude<RouteAdmission, "recovery">;
  forceMode: SystemMode;
  request: Request;
  context: RequestContext;
  params: Record<string, string>;
};

export type BrokerAdmissionDecision = {
  allowed: boolean;
  mode: SystemMode;
};

export type RouterDependencies<Env extends RuntimeEnvironment> =
  RequestContextDependencies & {
    verifyCsrf: (request: Request, context: RequestContext) => boolean | Promise<boolean>;
    authorize: (
      boundary: TrustBoundary,
      request: Request,
      context: RequestContext,
      env: Env,
    ) => RequestActor | Promise<RequestActor>;
    resolveLimiter: (name: string, env: Env) => EndpointLimiter;
    admitRequest: (
      input: BrokerAdmissionRequest,
      env: Env,
    ) => BrokerAdmissionDecision | Promise<BrokerAdmissionDecision>;
    observe: (event: unknown) => void;
    resolveMode?: (env: Env) => SystemMode;
    onStage?: (stage: PipelineStage) => void;
  };

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REQUIRED_VALUES = new Set(["required", "not-required"]);
const ADMISSION_VALUES = new Set<RouteAdmission>([
  "public-read",
  "public-write",
  "active-flight",
  "recovery",
]);
const PARAMETER_VALUE = /^[A-Za-z0-9_-]+$/;
const ROUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function validRoutePath(path: string): boolean {
  if (path === "/api") return true;
  if (!path.startsWith("/api/")) return false;
  return path
    .slice(5)
    .split("/")
    .every((part) =>
      part.startsWith(":")
        ? /^[A-Za-z][A-Za-z0-9_]*$/.test(part.slice(1))
        : PARAMETER_VALUE.test(part),
    );
}

function pathSpecificity(path: string): number {
  return path.split("/").filter((part) => part !== "" && !part.startsWith(":")).length;
}

function routePatternsOverlap(left: string, right: string): boolean {
  const leftParts = left.split("/");
  const rightParts = right.split("/");
  if (leftParts.length !== rightParts.length) return false;
  return leftParts.every((part, index) => {
    const other = rightParts[index] ?? "";
    return part.startsWith(":") || other.startsWith(":") || part === other;
  });
}

function validateSecurity(route: RouteDefinition): void {
  const security: unknown = route.security;
  if (!isRecord(security)) throw new TypeError("Route security declaration is required");
  for (const field of ["sameOrigin", "csrf", "idempotency"] as const) {
    if (!REQUIRED_VALUES.has(String(security[field]))) {
      throw new TypeError(`Route security ${field} declaration is invalid`);
    }
  }

  const body = security.body;
  if (!isRecord(body) || (body.kind !== "none" && body.kind !== "json")) {
    throw new TypeError("Route body security declaration is invalid");
  }
  if (
    body.kind === "json" &&
    body.maxBytes !== undefined &&
    (!Number.isSafeInteger(body.maxBytes) || Number(body.maxBytes) < 1)
  ) {
    throw new TypeError("Route body maxBytes must be a positive safe integer");
  }

  if (MUTATING_METHODS.has(route.method)) {
    if (
      security.sameOrigin !== "required" ||
      security.idempotency !== "required" ||
      body.kind !== "json"
    ) {
      throw new TypeError(
        "Mutating routes require same-origin, idempotency, and bounded JSON",
      );
    }
    if (route.boundary !== "public" && security.csrf !== "required") {
      throw new TypeError("Authenticated mutating routes require CSRF");
    }
    if (typeof route.validate !== "function") {
      throw new TypeError("Mutating routes require an explicit body validator");
    }
  }
}

export function defineRoute<T extends RouteDefinition>(route: T): T {
  if (!route.boundary || !["public", "authenticated", "admin"].includes(route.boundary)) {
    throw new TypeError("Route boundary is required");
  }
  if (typeof route.method !== "string" || !METHODS.has(route.method)) {
    throw new TypeError("Route method must be a supported uppercase method");
  }
  if (typeof route.path !== "string" || !validRoutePath(route.path)) {
    throw new TypeError("Dynamic routes must use a valid /api path");
  }
  if (typeof route.family !== "string" || !ROUTE_NAME.test(route.family)) {
    throw new TypeError("Route family must be a non-empty stable name");
  }
  if (!ADMISSION_VALUES.has(route.admission)) {
    throw new TypeError("Route admission is required");
  }
  validateSecurity(route);
  if (!isRecord(route.limiter)) throw new TypeError("Route limiter declaration is required");
  if (typeof route.limiter.name !== "string" || !ROUTE_NAME.test(route.limiter.name)) {
    throw new TypeError("Route limiter name must be a non-empty stable name");
  }
  if (!Number.isSafeInteger(route.limiter.retryAfterSeconds) || route.limiter.retryAfterSeconds < 1) {
    throw new TypeError("Route retryAfterSeconds must be a positive integer");
  }
  if (route.validate !== undefined && typeof route.validate !== "function") {
    throw new TypeError("Route validator must be a function");
  }
  if (typeof route.handler !== "function") throw new TypeError("Route handler is required");
  return route;
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const expected = pattern.split("/");
  const actual = pathname.split("/");
  if (expected.length !== actual.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const patternPart = expected[index] ?? "";
    const actualPart = actual[index] ?? "";
    if (patternPart.startsWith(":")) {
      const name = patternPart.slice(1);
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !PARAMETER_VALUE.test(actualPart)) {
        return null;
      }
      params[name] = actualPart;
    } else if (patternPart !== actualPart) {
      return null;
    }
  }
  return params;
}

function appEnvironment(value: string | undefined): AppEnvironment {
  return value === "production" || value === "staging" ? value : "local";
}

function secure(response: Response, env: RuntimeEnvironment): Response {
  return applySecurityHeaders(response, appEnvironment(env.APP_ENV));
}

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

function recordTelemetry(
  env: RuntimeEnvironment,
  context: RequestContext,
  response: Response,
  monotonicNow: () => number,
): void {
  try {
    env.REQUEST_ANALYTICS?.writeDataPoint({
      blobs: [context.routeFamily, statusClass(response.status), context.mode, "none", "none"],
      doubles: [Math.max(0, monotonicNow() - context.startedAtMs)],
      indexes: [context.actor.samplingKey],
    });
  } catch {
    // Analytics is deliberately failure-tolerant and cannot change request truth.
  }
}

function requireBoundaryActor(boundary: TrustBoundary, actor: RequestActor): void {
  if (boundary !== "public" && actor.kind === "anonymous") {
    throw new ApiHttpError(401, "AUTH_REQUIRED", "Authentication is required");
  }
  if (boundary === "admin" && actor.kind !== "admin") {
    throw new ApiHttpError(403, "FORBIDDEN", "Administrator access is required");
  }
}

function expectedErrorResponse(context: RequestContext, error: ApiHttpError): Response {
  const headers = new Headers();
  if (error.retryAfterSeconds !== undefined) {
    headers.set("retry-after", String(error.retryAfterSeconds));
  }
  return jsonEnvelope(context, {
    ok: false,
    code: error.code,
    status: error.status,
    error: {
      message: error.message,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    },
    headers,
  });
}

function observeUnexpected<Env extends RuntimeEnvironment>(
  dependencies: RouterDependencies<Env>,
  context: RequestContext,
  error: unknown,
): void {
  try {
    dependencies.observe(
      redactSensitive({
        requestId: context.requestId,
        routeFamily: context.routeFamily,
        errorType: error instanceof Error ? safeErrorName(error.name) : typeof error,
      }),
    );
  } catch {
    // Observability failure cannot replace the original stable error response.
  }
}

function internalErrorResponse(context: RequestContext): Response {
  return jsonEnvelope(context, {
    ok: false,
    code: "INTERNAL_ERROR",
    status: 500,
    error: { message: "An unexpected error occurred" },
  });
}

function successfulResponse(context: RequestContext, result: RouteResult): Response {
  const status = result.status ?? 200;
  const code = result.code ?? "OK";
  if (
    !Number.isInteger(status) ||
    status < 200 ||
    status > 299 ||
    status === 204 ||
    status === 205
  ) {
    throw new TypeError("Route success status must carry a JSON envelope");
  }
  if (!API_SUCCESS_CODES.includes(code)) {
    throw new TypeError("Route success code is not registered");
  }
  return jsonEnvelope(context, {
    ok: true,
    code,
    status,
    ...(result.data === undefined ? {} : { data: result.data }),
    ...(result.headers === undefined ? {} : { headers: result.headers }),
  });
}

export function createRouter<Env extends RuntimeEnvironment>(
  routeDefinitions: readonly RouteDefinition[],
  dependencies: RouterDependencies<Env>,
): { fetch(request: Request, env: Env): Promise<Response> } {
  const routes = routeDefinitions.map((route) => defineRoute(route));
  const identities = new Set<string>();
  const registered: RouteDefinition[] = [];
  for (const route of routes) {
    const identity = `${route.method} ${route.path}`;
    if (identities.has(identity)) throw new TypeError(`Duplicate route: ${identity}`);
    for (const existing of registered) {
      if (
        existing.method === route.method &&
        routePatternsOverlap(existing.path, route.path) &&
        pathSpecificity(existing.path) === pathSpecificity(route.path)
      ) {
        throw new TypeError(`Ambiguous routes: ${existing.path} and ${route.path}`);
      }
    }
    identities.add(identity);
    registered.push(route);
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const pathMatches = routes
        .flatMap((route) => {
          const params = matchPath(route.path, url.pathname);
          return params === null ? [] : [{ route, params }];
        })
        .sort((left, right) => pathSpecificity(right.route.path) - pathSpecificity(left.route.path));
      const selected = pathMatches.find(({ route }) => route.method === request.method);
      const contextRoute = selected?.route ?? pathMatches[0]?.route;
      const routeFamily = contextRoute?.family ?? "unknown";
      const boundary = contextRoute?.boundary;
      let capturedRequestId: string | undefined;
      let capturedServerTime: string | undefined;
      let capturedStartedAtMs: number | undefined;
      let resolvedMode: SystemMode = "NORMAL";
      let context: RequestContext;
      try {
        const candidateMode = dependencies.resolveMode?.(env) ?? "NORMAL";
        if (!isSystemMode(candidateMode)) throw new TypeError("Resolved system mode is invalid");
        resolvedMode = candidateMode;
        context = await createRequestContext(
          request,
          {
            routeFamily,
            mode: resolvedMode,
            ...(boundary === undefined ? {} : { boundary }),
          },
          {
            uuid: () => {
              const requestId = dependencies.uuid();
              if (!UUID_V4.test(requestId)) throw new TypeError("Request UUID is invalid");
              capturedRequestId = requestId;
              return requestId;
            },
            wallClock: () => {
              const value = dependencies.wallClock();
              capturedServerTime = value.toISOString();
              return value;
            },
            monotonicNow: () => {
              const value = dependencies.monotonicNow();
              if (!Number.isFinite(value)) throw new TypeError("Monotonic clock is invalid");
              capturedStartedAtMs = value;
              return value;
            },
            digest: async (value) => {
              const digest = await dependencies.digest(value);
              if (typeof digest !== "string" || digest.length < 1 || digest.length > 128) {
                throw new TypeError("Actor digest is invalid");
              }
              return digest;
            },
          },
        );
      } catch (error) {
        context = {
          requestId: capturedRequestId ?? crypto.randomUUID(),
          serverTime: capturedServerTime ?? new Date().toISOString(),
          startedAtMs: capturedStartedAtMs ?? performance.now(),
          mode: resolvedMode,
          routeFamily,
          ...(boundary === undefined ? {} : { boundary }),
          actor: { kind: "anonymous", samplingKey: "anon:unavailable" },
        };
        observeUnexpected(dependencies, context, error);
        return secure(internalErrorResponse(context), env);
      }

      if (pathMatches.length === 0) {
        return secure(
          jsonEnvelope(context, {
            ok: false,
            code: "NOT_FOUND",
            status: 404,
            error: { message: "API route not found" },
          }),
          env,
        );
      }
      if (selected === undefined) {
        const allow = [...new Set(pathMatches.map(({ route }) => route.method))].sort().join(", ");
        return secure(
          jsonEnvelope(context, {
            ok: false,
            code: "METHOD_NOT_ALLOWED",
            status: 405,
            error: { message: "Method not allowed" },
            headers: { allow },
          }),
          env,
        );
      }

      const { route, params } = selected;
      let admitted = false;
      let response: Response;
      try {
        dependencies.onStage?.("context");

        if (route.security.sameOrigin === "required") {
          dependencies.onStage?.("same-origin");
          enforceSameOrigin(request);
        }

        dependencies.onStage?.("authorization");
        const actor = await dependencies.authorize(route.boundary, request, context, env);
        requireBoundaryActor(route.boundary, actor);
        context = { ...context, actor };

        if (route.security.csrf === "required") {
          dependencies.onStage?.("csrf");
          if (!(await dependencies.verifyCsrf(request, context))) {
            throw new ApiHttpError(403, "CSRF_INVALID", "CSRF validation failed");
          }
        }

        let idempotencyKey: string | undefined;
        if (route.security.idempotency === "required") {
          dependencies.onStage?.("idempotency");
          idempotencyKey = readIdempotencyKey(request.headers);
        }

        dependencies.onStage?.("limiter");
        const limiter = dependencies.resolveLimiter(route.limiter.name, env);
        const decision = await limiter.limit(context.actor.samplingKey);
        if (!decision.allowed) {
          throw new ApiHttpError(429, "RATE_LIMITED", "Request rate limit exceeded", {
            retryAfterSeconds: route.limiter.retryAfterSeconds,
          });
        }

        dependencies.onStage?.("broker");
        if (route.admission !== "recovery") {
          const brokerDecision = await dependencies.admitRequest(
            {
              kind: route.admission,
              forceMode: resolvedMode,
              request,
              context,
              params,
            },
            env,
          );
          if (
            typeof brokerDecision.allowed !== "boolean" ||
            !isSystemMode(brokerDecision.mode)
          ) {
            throw new TypeError("Broker admission decision is invalid");
          }
          context = {
            ...context,
            mode: mostRestrictiveMode(resolvedMode, brokerDecision.mode),
          };
          if (!brokerDecision.allowed) {
            throw new ApiHttpError(
              503,
              "ADMISSION_DENIED",
              "Dynamic request admission denied",
            );
          }
        }
        admitted = true;

        let body: unknown;
        if (route.security.body.kind === "json") {
          dependencies.onStage?.("body");
          body = await readBoundedJsonBody(request, route.security.body.maxBytes);
        }

        let validated = body;
        if (route.validate !== undefined) {
          dependencies.onStage?.("validation");
          validated = await route.validate({ body, params, request, context });
        }

        dependencies.onStage?.("handler");
        const result = await route.handler({
          request,
          context,
          params,
          body,
          validated,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          env,
        });
        dependencies.onStage?.("response");
        response = successfulResponse(context, result);
      } catch (error) {
        if (error instanceof ApiHttpError) {
          response = expectedErrorResponse(context, error);
        } else {
          observeUnexpected(dependencies, context, error);
          response = internalErrorResponse(context);
        }
      }

      response = secure(response, env);
      if (admitted) {
        recordTelemetry(env, context, response, dependencies.monotonicNow);
        dependencies.onStage?.("telemetry");
      }
      return response;
    },
  };
}
