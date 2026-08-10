import {
  AUTH_REQUEST_BODY_MAX_BYTES,
  DEFAULT_PROFILE_RADIUS_NM,
  TRAFFIC_MAX_RADIUS_NM,
  TRAFFIC_PROVIDER_RADIUS_STEP_NM,
  TRAFFIC_REGION_CELL_DEGREES,
} from "../../../src/shared/limits";
import { normalizeRegion } from "../../adsb/region";
import { deriveCsrfToken } from "../../auth/csrf";
import {
  getUserById,
  getUserPreferences,
  updateUserProfileForSession,
} from "../../db/users";
import { getUserClassStatistics, listUserResultHistory } from "../../db/results";
import type { AssistLevel, TutorialState } from "../../db/types";
import { ApiHttpError } from "../response";
import { defineRoute, type RouteDefinition } from "../router";
import { ValidationError } from "../validation";
import type { AuthRouteEnvironment } from "./auth";

const HANDLE = /^[A-Za-z][A-Za-z0-9_-]{2,31}$/;
const ASSIST_LEVELS: readonly AssistLevel[] = ["none", "low", "medium", "high"];
const TUTORIAL_STATES: readonly TutorialState[] = [
  "new",
  "started",
  "complete",
  "dismissed",
];

export type MeRouteDependencies = {
  now: () => number;
};

type ProfilePatch = {
  handle?: string;
  center?: { lat: number; lon: number };
  defaultAssist?: AssistLevel;
  tutorialState?: TutorialState;
  coachingEnabled?: boolean;
};

const DEFAULT_DEPENDENCIES: MeRouteDependencies = {
  now: () => Date.now(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function profileActor(context: { actor: import("../../telemetry/requestContext").RequestActor }) {
  if (
    context.actor.kind === "anonymous" ||
    context.actor.sessionId === undefined
  ) {
    throw new ApiHttpError(401, "AUTH_REQUIRED", "Authentication is required");
  }
  return context.actor;
}

function validateProfilePatch(body: unknown): ProfilePatch {
  if (!isRecord(body)) {
    throw new ValidationError(400, "INVALID_REQUEST", "Profile update is invalid");
  }
  const allowed = new Set([
    "handle",
    "center",
    "defaultAssist",
    "tutorialState",
    "coachingEnabled",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new ValidationError(400, "INVALID_REQUEST", "Profile update is invalid");
  }

  const patch: ProfilePatch = {};
  if (body.handle !== undefined) {
    if (typeof body.handle !== "string" || !HANDLE.test(body.handle)) {
      throw new ValidationError(400, "INVALID_REQUEST", "Profile update is invalid");
    }
    patch.handle = body.handle;
  }
  if (body.center !== undefined) {
    if (
      !isRecord(body.center) ||
      Object.keys(body.center).length !== 2 ||
      !("lat" in body.center) ||
      !("lon" in body.center) ||
      typeof body.center.lat !== "number" ||
      !Number.isFinite(body.center.lat) ||
      typeof body.center.lon !== "number" ||
      !Number.isFinite(body.center.lon)
    ) {
      throw new ValidationError(400, "INVALID_REQUEST", "Profile update is invalid");
    }
    patch.center = {
      lat: Math.min(90, Math.max(-90, body.center.lat)),
      lon: Math.min(180, Math.max(-180, body.center.lon)),
    };
  }
  if (body.defaultAssist !== undefined) {
    if (!ASSIST_LEVELS.includes(body.defaultAssist as AssistLevel)) {
      throw new ValidationError(400, "INVALID_REQUEST", "Profile update is invalid");
    }
    patch.defaultAssist = body.defaultAssist as AssistLevel;
  }
  if (body.tutorialState !== undefined) {
    if (!TUTORIAL_STATES.includes(body.tutorialState as TutorialState)) {
      throw new ValidationError(400, "INVALID_REQUEST", "Profile update is invalid");
    }
    patch.tutorialState = body.tutorialState as TutorialState;
  }
  if (body.coachingEnabled !== undefined) {
    if (typeof body.coachingEnabled !== "boolean") {
      throw new ValidationError(400, "INVALID_REQUEST", "Profile update is invalid");
    }
    patch.coachingEnabled = body.coachingEnabled;
  }
  return patch;
}

async function loadProfile(db: D1Database, userId: string, csrfToken: string) {
  const [user, preferences, history, classStatistics] = await Promise.all([
    getUserById(db, userId),
    getUserPreferences(db, userId),
    listUserResultHistory(db, userId),
    getUserClassStatistics(db, userId),
  ]);
  if (user === null || preferences === null || user.status === "disabled") {
    throw new ApiHttpError(401, "AUTH_REQUIRED", "Authentication is required");
  }
  return {
    userId: user.id,
    handle: user.handle,
    center: { lat: preferences.centerLat, lon: preferences.centerLon },
    regionKey: preferences.regionKey,
    defaultAssist: preferences.defaultAssist,
    tutorialState: preferences.tutorialState,
    coachingEnabled: preferences.coachingEnabled,
    history,
    classStatistics,
    csrfToken,
  };
}

export function createMeRoutes(
  overrides: Partial<MeRouteDependencies> = {},
): readonly RouteDefinition[] {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };

  const getMe = defineRoute({
    method: "GET",
    path: "/api/me",
    family: "profile",
    boundary: "authenticated",
    admission: "public-read",
    security: {
      sameOrigin: "not-required",
      csrf: "not-required",
      idempotency: "not-required",
      body: { kind: "none" },
    },
    limiter: { name: "profile", retryAfterSeconds: 10 },
    handler: async ({ context, env }) => {
      const actor = profileActor(context);
      const runtime = env as AuthRouteEnvironment;
      const csrfToken = await deriveCsrfToken(
        actor.sessionId ?? "",
        runtime.CSRF_SECRET,
      );
      return { data: await loadProfile(runtime.DB, actor.userId, csrfToken) };
    },
  });

  const patchMe = defineRoute({
    method: "PATCH",
    path: "/api/me",
    family: "profile",
    boundary: "authenticated",
    admission: "public-write",
    security: {
      sameOrigin: "required",
      csrf: "required",
      idempotency: "required",
      body: { kind: "json", maxBytes: AUTH_REQUEST_BODY_MAX_BYTES },
    },
    limiter: { name: "profile", retryAfterSeconds: 10 },
    validate: ({ body }) => validateProfilePatch(body),
    handler: async ({ context, validated, env }) => {
      const actor = profileActor(context);
      const runtime = env as AuthRouteEnvironment;
      const patch = validated as ProfilePatch;
      const [user, preferences] = await Promise.all([
        getUserById(runtime.DB, actor.userId),
        getUserPreferences(runtime.DB, actor.userId),
      ]);
      if (user === null || preferences === null) {
        throw new ApiHttpError(401, "AUTH_REQUIRED", "Authentication is required");
      }
      const center = patch.center ?? {
        lat: preferences.centerLat,
        lon: preferences.centerLon,
      };
      const region = normalizeRegion(center.lat, center.lon, DEFAULT_PROFILE_RADIUS_NM, {
        cellDegrees: TRAFFIC_REGION_CELL_DEGREES,
        providerRadiusStepNm: TRAFFIC_PROVIDER_RADIUS_STEP_NM,
        providerMaxRadiusNm: TRAFFIC_MAX_RADIUS_NM,
      });
      const csrfToken = await deriveCsrfToken(
        actor.sessionId ?? "",
        runtime.CSRF_SECRET,
      );
      const updated = await updateUserProfileForSession(runtime.DB, {
        userId: actor.userId,
        sessionId: actor.sessionId ?? "",
        handle: patch.handle ?? user.handle,
        centerLat: center.lat,
        centerLon: center.lon,
        regionKey: region.regionKey,
        defaultAssist: patch.defaultAssist ?? preferences.defaultAssist,
        tutorialState: patch.tutorialState ?? preferences.tutorialState,
        coachingEnabled: patch.coachingEnabled ?? preferences.coachingEnabled,
        updatedAt: dependencies.now(),
      });
      if (updated === null) {
        throw new ApiHttpError(401, "AUTH_REQUIRED", "Authentication is required");
      }
      return {
        code: "PROFILE_UPDATED" as const,
        data: await loadProfile(runtime.DB, actor.userId, csrfToken),
      };
    },
  });

  return [getMe, patchMe];
}
