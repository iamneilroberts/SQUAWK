import { TRAFFIC_MAX_RADIUS_NM } from "../../../src/shared/limits";
import { isSystemMode, type SystemMode } from "../../../src/shared/mode";
import { clearTrafficRegion, resolveTrafficRegion } from "../../admin/cache";
import { terminateFlight } from "../../admin/flights";
import {
  readOperationalStatus,
  setOperationalSettings,
  setRequestedMode,
  type AdminBroker,
} from "../../admin/mode";
import { revokeSession } from "../../admin/sessions";
import { banUser, lookupUserByExactEmail, unbanUser } from "../../admin/users";
import {
  recordAdminMutation,
  replayAdminMutation,
  type AdminMutationRecord,
} from "../../admin/auditMutation";
import { deriveCsrfToken } from "../../auth/csrf";
import type { BanScope, VersionedDocument } from "../../db/types";
import { sendBrokerCommand } from "../../durable/protocol";
import {
  ANALYTICS_VIEWS,
  ANALYTICS_WINDOWS,
  queryRequestAnalytics,
  type AnalyticsView,
  type AnalyticsWindow,
} from "../../admin/analytics";
import { exportAdminEvents, listAdminEvents, type AdminEventFilters } from "../../admin/events";
import {
  findAdminUserByExactIdentity,
  listAdminActiveSessions,
  readAdminOverview,
  readAdminUserDetail,
  readBrokerAdminSnapshot,
} from "../../admin/overview";
import type { Env } from "../../env";
import { ApiHttpError } from "../response";
import { defineRoute, type RouteDefinition } from "../router";
import { validateCoordinates, validateRadiusNm, ValidationError } from "../validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY_BYTES = 8_192;

export type AdminRouteDependencies = {
  now: () => number;
  uuid: () => string;
  broker: AdminBroker;
  analytics: typeof queryRequestAnalytics;
};

const DEFAULT_DEPENDENCIES: AdminRouteDependencies = {
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
  broker: sendBrokerCommand,
  analytics: queryRequestAnalytics,
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function invalid(message = "Admin request is invalid"): never {
  throw new ValidationError(400, "INVALID_REQUEST", message);
}

function reason(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 8 ||
    value.length > 512 ||
    value.includes("@")
  ) invalid("An admin reason is required");
  return value;
}

function routeId(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (value === undefined || !UUID.test(value)) {
    throw new ApiHttpError(404, "NOT_FOUND", "Admin target not found");
  }
  return value.toLowerCase();
}

function adminActor(context: { actor: import("../../telemetry/requestContext").RequestActor }) {
  if (
    context.actor.kind !== "admin" ||
    context.actor.sessionId === undefined
  ) throw new ApiHttpError(403, "FORBIDDEN", "Administrator access is required");
  return context.actor;
}

function forceMode(env: Env): SystemMode {
  if (!isSystemMode(env.FORCE_MODE)) throw new TypeError("FORCE_MODE is invalid");
  return env.FORCE_MODE;
}

async function queueAdminAlert(
  runtime: Env,
  broker: AdminBroker,
  input: {
    action: string;
    auditId: string;
    requestId: string;
    atMs: number;
    test?: boolean;
  },
): Promise<boolean> {
  try {
    await broker(runtime.ADSB_BROKER, input.test
      ? {
          type: "alert-test",
          auditId: input.auditId,
          requestId: input.requestId,
          atMs: input.atMs,
          forceMode: forceMode(runtime),
        }
      : {
          type: "alert-admin",
          action: input.action,
          auditId: input.auditId,
          requestId: input.requestId,
          atMs: input.atMs,
          forceMode: forceMode(runtime),
        });
    return true;
  } catch (error) {
    console.error("adsb_admin_alert_queue_failed", {
      action: input.action,
      auditId: input.auditId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  }
}

function operationalState(status: Awaited<ReturnType<typeof readOperationalStatus>>): VersionedDocument {
  return { schemaVersion: 1, ...status };
}

function mutationRecord(
  input: {
    context: import("../../telemetry/requestContext").RequestContext;
    idempotencyKey?: string;
    request: unknown;
    reason: string;
  },
  action: string,
  targetType: string,
  targetId: string,
  createdAt: number,
  before: VersionedDocument | null,
  after: VersionedDocument | null,
): AdminMutationRecord {
  const actor = adminActor(input.context);
  if (input.idempotencyKey === undefined) throw new TypeError("Idempotency key is missing");
  return {
    actor: actor.userId,
    idempotencyKey: input.idempotencyKey,
    action,
    targetType,
    targetId,
    request: input.request,
    before,
    after,
    reason: input.reason,
    requestId: input.context.requestId,
    createdAt,
  };
}

function mutationSecurity() {
  return {
    sameOrigin: "required" as const,
    csrf: "required" as const,
    idempotency: "required" as const,
    body: { kind: "json" as const, maxBytes: BODY_BYTES },
  };
}

function readSecurity() {
  return {
    sameOrigin: "not-required" as const,
    csrf: "not-required" as const,
    idempotency: "not-required" as const,
    body: { kind: "none" as const },
  };
}

function queryValues(request: Request, allowed: readonly string[]): URLSearchParams {
  const search = new URL(request.url).searchParams;
  const accepted = new Set(allowed);
  for (const key of search.keys()) {
    if (!accepted.has(key) || search.getAll(key).length !== 1) invalid();
  }
  return search;
}

function boundedInteger(value: string | null, fallback: number, maximum: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) invalid();
  return parsed;
}

function optionalTimestamp(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) invalid();
  return parsed;
}

function validateEventsQuery(request: Request, exportMode = false) {
  const search = queryValues(
    request,
    exportMode
      ? ["level", "category", "after", "before", "limit", "format"]
      : ["level", "category", "after", "before", "limit"],
  );
  const level = search.get("level");
  if (level !== null && !["warning", "error", "transition"].includes(level)) invalid();
  const category = search.get("category");
  if (category !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(category)) invalid();
  const filters: AdminEventFilters = {
    level: level as AdminEventFilters["level"],
    category,
    afterMs: optionalTimestamp(search.get("after")),
    beforeMs: optionalTimestamp(search.get("before")),
    limit: boundedInteger(search.get("limit"), exportMode ? 250 : 100, exportMode ? 250 : 200),
  };
  if (filters.afterMs !== null && filters.beforeMs !== null && filters.afterMs > filters.beforeMs) invalid();
  if (!exportMode) return { filters };
  const format = search.get("format") ?? "json";
  if (format !== "json" && format !== "csv") invalid();
  return { filters, format: format as "json" | "csv" };
}

function validateMode(body: unknown) {
  if (!record(body) || !exactKeys(body, ["mode", "reason"], ["confirmation"])) invalid();
  if (!isSystemMode(body.mode)) invalid();
  const why = reason(body.reason);
  if (body.mode === "KILL_SWITCH" && body.confirmation !== "KILL_SWITCH") {
    invalid("KILL_SWITCH confirmation is required");
  }
  if (body.mode !== "KILL_SWITCH" && body.confirmation !== undefined) invalid();
  return { mode: body.mode, reason: why, ...(body.confirmation === undefined ? {} : { confirmation: body.confirmation }) };
}

function validateSettings(body: unknown) {
  if (
    !record(body) ||
    !exactKeys(body, ["registrationEnabled", "providerCacheOnly", "reason"]) ||
    typeof body.registrationEnabled !== "boolean" ||
    typeof body.providerCacheOnly !== "boolean"
  ) invalid();
  return {
    registrationEnabled: body.registrationEnabled,
    providerCacheOnly: body.providerCacheOnly,
    reason: reason(body.reason),
  };
}

function validateCache(body: unknown) {
  if (!record(body) || !exactKeys(body, ["latitude", "longitude", "radiusNm", "reason"])) invalid();
  const coordinates = validateCoordinates(body.latitude, body.longitude);
  return {
    ...coordinates,
    radiusNm: validateRadiusNm(body.radiusNm),
    reason: reason(body.reason),
  };
}

function validateLookup(body: unknown) {
  if (!record(body) || !exactKeys(body, ["email"]) || typeof body.email !== "string") invalid();
  if (body.email.length < 3 || body.email.length > 254) invalid();
  return { email: body.email };
}

function validateBan(body: unknown) {
  if (!record(body) || !exactKeys(body, ["scope", "expiresAt", "reason", "confirmation"])) invalid();
  if (body.scope !== "temporary" && body.scope !== "permanent") invalid();
  if (body.expiresAt !== null && (!Number.isSafeInteger(body.expiresAt) || Number(body.expiresAt) < 0)) invalid();
  if (typeof body.confirmation !== "string") invalid();
  return {
    scope: body.scope as BanScope,
    expiresAt: body.expiresAt as number | null,
    reason: reason(body.reason),
    confirmation: body.confirmation,
  };
}

function validateDestructive(body: unknown) {
  if (!record(body) || !exactKeys(body, ["reason", "confirmation"]) || typeof body.confirmation !== "string") invalid();
  return { reason: reason(body.reason), confirmation: body.confirmation };
}

function validateReason(body: unknown) {
  if (!record(body) || !exactKeys(body, ["reason"])) invalid();
  return { reason: reason(body.reason) };
}

export function createAdminRoutes(
  overrides: Partial<AdminRouteDependencies> = {},
): readonly RouteDefinition[] {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const status = defineRoute({
    method: "GET",
    path: "/api/admin/status",
    family: "admin-status",
    boundary: "admin",
    admission: "recovery",
    security: {
      sameOrigin: "not-required",
      csrf: "not-required",
      idempotency: "not-required",
      body: { kind: "none" },
    },
    limiter: { name: "admin", retryAfterSeconds: 1 },
    handler: async ({ context, env }) => {
      const actor = adminActor(context);
      const runtime = env as Env;
      return {
        data: {
          status: await readOperationalStatus(
            runtime.ADSB_BROKER,
            forceMode(runtime),
            dependencies.broker,
          ),
          csrfToken: await deriveCsrfToken(actor.sessionId!, runtime.CSRF_SECRET),
        },
      };
    },
  });

  const overview = defineRoute({
    method: "GET",
    path: "/api/admin/overview",
    family: "admin-overview",
    boundary: "admin",
    admission: "recovery",
    security: readSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ request }) => {
      queryValues(request, []);
      return undefined;
    },
    handler: async ({ env }) => {
      const runtime = env as Env;
      return { data: await readAdminOverview(runtime, forceMode(runtime), dependencies.now(), dependencies.broker) };
    },
  });

  const analytics = defineRoute({
    method: "GET",
    path: "/api/admin/analytics",
    family: "admin-analytics",
    boundary: "admin",
    admission: "recovery",
    security: readSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ request }) => {
      const search = queryValues(request, ["view", "window"]);
      const view = search.get("view") ?? "summary";
      const window = search.get("window") ?? "1h";
      if (!ANALYTICS_VIEWS.includes(view as AnalyticsView)) invalid();
      if (!ANALYTICS_WINDOWS.includes(window as AnalyticsWindow)) invalid();
      return { view: view as AnalyticsView, window: window as AnalyticsWindow };
    },
    handler: async ({ validated, env }) => {
      const { view, window } = validated as { view: AnalyticsView; window: AnalyticsWindow };
      return { data: await dependencies.analytics(env as Env, view, window) };
    },
  });

  const capacity = defineRoute({
    method: "GET",
    path: "/api/admin/capacity",
    family: "admin-capacity",
    boundary: "admin",
    admission: "recovery",
    security: readSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ request }) => {
      queryValues(request, []);
      return undefined;
    },
    handler: async ({ env }) => {
      const runtime = env as Env;
      const snapshot = await readBrokerAdminSnapshot(runtime.ADSB_BROKER, forceMode(runtime), dependencies.broker);
      return { data: {
        capturedAtMs: snapshot.capturedAtMs,
        cacheRegions: snapshot.cacheRegions,
        providerWork: snapshot.providerWork,
        status: snapshot.status,
        source: "application-snapshot",
        authoritativeBilling: false,
      } };
    },
  });

  const activeSessions = defineRoute({
    method: "GET",
    path: "/api/admin/sessions",
    family: "admin-sessions",
    boundary: "admin",
    admission: "recovery",
    security: readSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ request }) => {
      const search = queryValues(request, ["limit"]);
      return { limit: boundedInteger(search.get("limit"), 50, 100) };
    },
    handler: async ({ validated, env }) => {
      const runtime = env as Env;
      const snapshot = await readBrokerAdminSnapshot(runtime.ADSB_BROKER, forceMode(runtime), dependencies.broker);
      return { data: {
        sessions: await listAdminActiveSessions(runtime.DB, snapshot, dependencies.now(), (validated as { limit: number }).limit),
        capturedAtMs: snapshot.capturedAtMs,
        presenceEphemeral: true,
      } };
    },
  });

  const events = defineRoute({
    method: "GET",
    path: "/api/admin/events",
    family: "admin-events",
    boundary: "admin",
    admission: "recovery",
    security: readSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ request }) => validateEventsQuery(request),
    handler: async ({ validated, env }) => {
      const { filters } = validated as { filters: AdminEventFilters };
      const runtime = env as Env;
      const accountId = runtime.CLOUDFLARE_ACCOUNT_ID;
      const service = runtime.APP_ENV === "production" ? "voygent-adsb-game" : "voygent-adsb-game-staging";
      const workersLogsUrl = accountId !== undefined && /^[0-9a-f]{32}$/i.test(accountId)
        ? `https://dash.cloudflare.com/${accountId}/workers/services/view/${service}/production/observability/logs`
        : "https://dash.cloudflare.com/";
      return { data: {
        events: await listAdminEvents(runtime.DB, filters),
        fullLogStream: false,
        workersLogsUrl,
      } };
    },
  });

  const eventExport = defineRoute({
    method: "GET",
    path: "/api/admin/events/export",
    family: "admin-events-export",
    boundary: "admin",
    admission: "recovery",
    security: readSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ request }) => validateEventsQuery(request, true),
    handler: async ({ validated, env }) => {
      const { filters, format } = validated as { filters: AdminEventFilters; format: "json" | "csv" };
      return { data: await exportAdminEvents((env as Env).DB, filters, format) };
    },
  });

  const userSearch = defineRoute({
    method: "GET",
    path: "/api/admin/users",
    family: "admin-users",
    boundary: "admin",
    admission: "recovery",
    security: readSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ request }) => {
      const search = queryValues(request, ["kind", "query"]);
      const kind = search.get("kind");
      const query = search.get("query");
      if ((kind !== "id" && kind !== "handle") || query === null || query.length > 36 || query.includes("@")) invalid();
      return { kind, query };
    },
    handler: async ({ validated, env }) => {
      const { kind, query } = validated as { kind: "id" | "handle"; query: string };
      const user = await findAdminUserByExactIdentity((env as Env).DB, kind, query);
      return { data: { user } };
    },
  });

  const userDetail = defineRoute({
    method: "GET",
    path: "/api/admin/users/:userId",
    family: "admin-users",
    boundary: "admin",
    admission: "recovery",
    security: readSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ params, request }) => {
      queryValues(request, []);
      return { userId: routeId(params, "userId") };
    },
    handler: async ({ validated, env }) => {
      const user = await readAdminUserDetail(
        (env as Env).DB,
        (validated as { userId: string }).userId,
        dependencies.now(),
      );
      if (user === null) throw new ApiHttpError(404, "NOT_FOUND", "User not found");
      return { data: { user } };
    },
  });

  const mode = defineRoute({
    method: "POST",
    path: "/api/admin/mode",
    family: "admin-mode",
    boundary: "admin",
    admission: "recovery",
    security: mutationSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ body }) => validateMode(body),
    handler: async ({ context, idempotencyKey, validated, env }) => {
      const runtime = env as Env;
      const input = validated as ReturnType<typeof validateMode>;
      const now = dependencies.now();
      const base = mutationRecord(
        { context, idempotencyKey, request: input, reason: input.reason },
        "mode.set",
        "broker",
        "global-v1",
        now,
        null,
        null,
      );
      const replay = await replayAdminMutation(runtime.DB, base);
      if (replay !== null) return { data: replay };
      const before = await readOperationalStatus(runtime.ADSB_BROKER, forceMode(runtime), dependencies.broker);
      const after = await setRequestedMode(
        runtime.ADSB_BROKER,
        input.mode,
        forceMode(runtime),
        dependencies.broker,
      );
      try {
        const result = await recordAdminMutation(runtime.DB, {
          ...base,
          before: operationalState(before),
          after: operationalState(after),
        });
        await queueAdminAlert(runtime, dependencies.broker, {
          action: input.mode === "KILL_SWITCH"
            ? "mode.kill-switch"
            : input.mode === "READ_ONLY"
              ? "mode.read-only"
              : "mode.normal",
          auditId: result.auditId,
          requestId: context.requestId,
          atMs: now,
        });
        return { data: { ...result, status: after } };
      } catch (error) {
        await setRequestedMode(
          runtime.ADSB_BROKER,
          before.requestedMode,
          forceMode(runtime),
          dependencies.broker,
        ).catch(() => undefined);
        throw error;
      }
    },
  });

  const settings = defineRoute({
    method: "POST",
    path: "/api/admin/settings",
    family: "admin-settings",
    boundary: "admin",
    admission: "recovery",
    security: mutationSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ body }) => validateSettings(body),
    handler: async ({ context, idempotencyKey, validated, env }) => {
      const runtime = env as Env;
      const input = validated as ReturnType<typeof validateSettings>;
      const now = dependencies.now();
      const base = mutationRecord(
        { context, idempotencyKey, request: input, reason: input.reason },
        "settings.set",
        "broker",
        "global-v1",
        now,
        null,
        null,
      );
      const replay = await replayAdminMutation(runtime.DB, base);
      if (replay !== null) return { data: replay };
      const before = await readOperationalStatus(runtime.ADSB_BROKER, forceMode(runtime), dependencies.broker);
      const after = await setOperationalSettings(
        runtime.ADSB_BROKER,
        input,
        forceMode(runtime),
        dependencies.broker,
      );
      try {
        const result = await recordAdminMutation(runtime.DB, {
          ...base,
          before: operationalState(before),
          after: operationalState(after),
        });
        await queueAdminAlert(runtime, dependencies.broker, {
          action: base.action,
          auditId: result.auditId,
          requestId: context.requestId,
          atMs: now,
        });
        return { data: { ...result, status: after } };
      } catch (error) {
        await setOperationalSettings(
          runtime.ADSB_BROKER,
          {
            registrationEnabled: before.registrationEnabled,
            providerCacheOnly: before.providerCacheOnly,
          },
          forceMode(runtime),
          dependencies.broker,
        ).catch(() => undefined);
        throw error;
      }
    },
  });

  const cache = defineRoute({
    method: "POST",
    path: "/api/admin/cache/region",
    family: "admin-cache",
    boundary: "admin",
    admission: "recovery",
    security: mutationSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ body }) => validateCache(body),
    handler: async ({ context, idempotencyKey, validated, env }) => {
      const runtime = env as Env;
      const input = validated as ReturnType<typeof validateCache>;
      const now = dependencies.now();
      const maximumRadius = Number(runtime.UPSTREAM_MAX_RADIUS_NM ?? TRAFFIC_MAX_RADIUS_NM);
      const normalized = resolveTrafficRegion(input, maximumRadius);
      const base = mutationRecord(
        { context, idempotencyKey, request: input, reason: input.reason },
        "cache.region.clear",
        "traffic-region",
        normalized.regionKey,
        now,
        null,
        null,
      );
      const replay = await replayAdminMutation(runtime.DB, base);
      if (replay !== null) return { data: replay };
      const cleared = await clearTrafficRegion(
        runtime.ADSB_BROKER,
        input,
        maximumRadius,
        forceMode(runtime),
        dependencies.broker,
      );
      const after: VersionedDocument = {
        schemaVersion: 1,
        regionKey: cleared.regionKey,
        cleared: cleared.cleared,
      };
      const result = await recordAdminMutation(runtime.DB, {
        ...base,
        after,
      });
      await queueAdminAlert(runtime, dependencies.broker, {
        action: base.action,
        auditId: result.auditId,
        requestId: context.requestId,
        atMs: now,
      });
      return { data: { ...result, regionKey: cleared.regionKey, cleared: cleared.cleared } };
    },
  });

  const lookup = defineRoute({
    method: "POST",
    path: "/api/admin/users/lookup",
    family: "admin-users",
    boundary: "admin",
    admission: "recovery",
    security: mutationSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ body }) => validateLookup(body),
    handler: async ({ validated, env }) => {
      const runtime = env as Env;
      const { email } = validated as ReturnType<typeof validateLookup>;
      return { data: { user: await lookupUserByExactEmail(runtime.DB, email, runtime.EMAIL_KEY_SECRET) } };
    },
  });

  const ban = defineRoute({
    method: "POST",
    path: "/api/admin/users/:userId/ban",
    family: "admin-users",
    boundary: "admin",
    admission: "recovery",
    security: mutationSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ body, params }) => {
      const input = validateBan(body);
      const userId = routeId(params, "userId");
      if (input.confirmation !== `BAN ${userId}`) invalid("Ban confirmation is required");
      return { ...input, userId };
    },
    handler: async ({ context, idempotencyKey, validated, env }) => {
      const runtime = env as Env;
      const input = validated as ReturnType<typeof validateBan> & { userId: string };
      const base = mutationRecord(
        { context, idempotencyKey, request: input, reason: input.reason },
        "user.ban",
        "user",
        input.userId,
        dependencies.now(),
        null,
        null,
      );
      const result = await banUser(runtime.DB, runtime.ADSB_BROKER, {
        ...base,
        userId: input.userId,
        banId: dependencies.uuid(),
        scope: input.scope,
        expiresAt: input.expiresAt,
      }, dependencies.broker);
      await queueAdminAlert(runtime, dependencies.broker, {
        action: base.action,
        auditId: result.auditId,
        requestId: context.requestId,
        atMs: base.createdAt,
      });
      return { data: result };
    },
  });

  const unban = defineRoute({
    method: "POST",
    path: "/api/admin/bans/:banId/unban",
    family: "admin-users",
    boundary: "admin",
    admission: "recovery",
    security: mutationSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ body, params }) => ({ ...validateReason(body), banId: routeId(params, "banId") }),
    handler: async ({ context, idempotencyKey, validated, env }) => {
      const runtime = env as Env;
      const input = validated as ReturnType<typeof validateReason> & { banId: string };
      const base = mutationRecord(
        { context, idempotencyKey, request: input, reason: input.reason },
        "user.unban",
        "ban",
        input.banId,
        dependencies.now(),
        null,
        null,
      );
      const result = await unbanUser(runtime.DB, { ...base, banId: input.banId });
      await queueAdminAlert(runtime, dependencies.broker, {
        action: base.action,
        auditId: result.auditId,
        requestId: context.requestId,
        atMs: base.createdAt,
      });
      return { data: result };
    },
  });

  const session = defineRoute({
    method: "POST",
    path: "/api/admin/sessions/:sessionId/revoke",
    family: "admin-sessions",
    boundary: "admin",
    admission: "recovery",
    security: mutationSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ body, params }) => {
      const input = validateDestructive(body);
      const sessionId = routeId(params, "sessionId");
      if (input.confirmation !== `REVOKE ${sessionId}`) invalid("Session confirmation is required");
      return { ...input, sessionId };
    },
    handler: async ({ context, idempotencyKey, validated, env }) => {
      const runtime = env as Env;
      const input = validated as ReturnType<typeof validateDestructive> & { sessionId: string };
      const base = mutationRecord(
        { context, idempotencyKey, request: input, reason: input.reason },
        "session.revoke",
        "session",
        input.sessionId,
        dependencies.now(),
        null,
        null,
      );
      const result = await revokeSession(runtime.DB, { ...base, sessionId: input.sessionId });
      await queueAdminAlert(runtime, dependencies.broker, {
        action: base.action,
        auditId: result.auditId,
        requestId: context.requestId,
        atMs: base.createdAt,
      });
      return { data: result };
    },
  });

  const flight = defineRoute({
    method: "POST",
    path: "/api/admin/flights/:missionId/terminate",
    family: "admin-flights",
    boundary: "admin",
    admission: "recovery",
    security: mutationSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ body, params }) => {
      const input = validateDestructive(body);
      const missionId = routeId(params, "missionId");
      if (input.confirmation !== `TERMINATE ${missionId}`) invalid("Flight confirmation is required");
      return { ...input, missionId };
    },
    handler: async ({ context, idempotencyKey, validated, env }) => {
      const runtime = env as Env;
      const input = validated as ReturnType<typeof validateDestructive> & { missionId: string };
      const base = mutationRecord(
        { context, idempotencyKey, request: input, reason: input.reason },
        "flight.terminate",
        "mission",
        input.missionId,
        dependencies.now(),
        null,
        null,
      );
      const result = await terminateFlight(
          runtime.DB,
          runtime.ADSB_BROKER,
          { ...base, missionId: input.missionId },
          dependencies.broker,
        );
      await queueAdminAlert(runtime, dependencies.broker, {
        action: base.action,
        auditId: result.auditId,
        requestId: context.requestId,
        atMs: base.createdAt,
      });
      return { data: result };
    },
  });

  const testAlert = defineRoute({
    method: "POST",
    path: "/api/admin/alerts/test",
    family: "admin-alerts",
    boundary: "admin",
    admission: "recovery",
    security: mutationSecurity(),
    limiter: { name: "admin", retryAfterSeconds: 1 },
    validate: ({ body }) => validateReason(body),
    handler: async ({ context, idempotencyKey, validated, env }) => {
      const runtime = env as Env;
      const input = validated as ReturnType<typeof validateReason>;
      const now = dependencies.now();
      const base = mutationRecord(
        { context, idempotencyKey, request: input, reason: input.reason },
        "alert.test",
        "alert-pipeline",
        "singleton",
        now,
        null,
        { schemaVersion: 1, test: true },
      );
      const result = await recordAdminMutation(runtime.DB, base);
      const queued = await queueAdminAlert(runtime, dependencies.broker, {
        action: base.action,
        auditId: result.auditId,
        requestId: context.requestId,
        atMs: now,
        test: true,
      });
      return { data: { ...result, queued } };
    },
  });

  return [
    status,
    overview,
    analytics,
    capacity,
    activeSessions,
    events,
    eventExport,
    userSearch,
    userDetail,
    mode,
    settings,
    cache,
    lookup,
    ban,
    unban,
    session,
    flight,
    testAlert,
  ];
}
