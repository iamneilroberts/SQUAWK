import {
  missionPreviewFingerprint,
  type LockMissionRequest,
  type MissionPreviewIdentity,
  type PrepareMissionRequest,
} from "../../../src/mission/contract";
import {
  MISSION_CONTACT_SEARCH_RADIUS_NM,
  MISSION_LOCK_BODY_MAX_BYTES,
  MISSION_MAX_ELIGIBLE_CHOICES,
  MISSION_PREPARE_BODY_MAX_BYTES,
  MISSION_RESULT_BODY_MAX_BYTES,
} from "../../../src/shared/limits";
import {
  isLandingEvidence,
  type MissionResultRequest,
} from "../../../src/mission/resultPackage";
import type { Env } from "../../env";
import {
  sendBrokerCommand,
  type BrokerCommand,
  type BrokerCommandResult,
} from "../../durable/protocol";
import { lockAuthoritativeMission } from "../../missions/lock";
import { prepareAuthoritativeMission } from "../../missions/prepare";
import { finalizeAuthoritativeResult } from "../../missions/results";
import { getMissionById } from "../../db/missions";
import { ApiHttpError } from "../response";
import { defineRoute, type RouteDefinition } from "../router";
import {
  clampRadiusNm,
  validateCoordinates,
  ValidationError,
} from "../validation";

const HEX = /^[0-9a-f]{6}$/i;
const CHOICE_KEY = /^[A-Za-z0-9:_-]{5,160}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const TOKEN = /^[A-Za-z0-9._-]{32,32768}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MissionRouteDependencies = {
  uuid: () => string;
  broker(
    namespace: Env["ADSB_BROKER"],
    command: BrokerCommand,
  ): Promise<BrokerCommandResult>;
};

const DEFAULT_DEPENDENCIES: MissionRouteDependencies = {
  uuid: () => crypto.randomUUID(),
  broker: sendBrokerCommand,
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function activeTrafficQuery(request: Request) {
  const search = new URL(request.url).searchParams;
  const keys = [...new Set(search.keys())].sort();
  const expected = ["lat", "lon", "radius_nm"];
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index]) ||
    expected.some((key) => search.getAll(key).length !== 1)
  ) {
    throw new ValidationError(400, "INVALID_REQUEST", "Active-flight traffic query is invalid");
  }
  const coordinates = validateCoordinates(search.get("lat"), search.get("lon"));
  return {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    radiusNm: clampRadiusNm(search.get("radius_nm")),
  };
}

async function ownedLockedMission(db: D1Database, missionId: string, userId: string) {
  if (!UUID.test(missionId)) {
    throw new ApiHttpError(404, "NOT_FOUND", "Mission not found");
  }
  const mission = await getMissionById(db, missionId);
  if (mission === null || mission.userId !== userId || mission.status !== "locked") {
    throw new ApiHttpError(404, "NOT_FOUND", "Mission not found");
  }
  return mission;
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function preview(value: unknown): value is MissionPreviewIdentity {
  if (!record(value) || !exactKeys(value, [
    "aircraftHex",
    "aircraftType",
    "classId",
    "selectedChoiceKey",
    "eligibleChoiceKeys",
    "versions",
  ])) return false;
  const versions = value.versions;
  const versionKeys = [
    "airportDataset",
    "aircraftProfile",
    "missionProfile",
    "assignment",
    "scoring",
    "physics",
    "assistDefinition",
  ];
  return typeof value.aircraftHex === "string" && HEX.test(value.aircraftHex) &&
    (value.aircraftType === null ||
      (typeof value.aircraftType === "string" && /^[A-Za-z0-9_-]{1,16}$/.test(value.aircraftType))) &&
    (value.classId === "c172s" || value.classId === "b738" || value.classId === "f5e" || value.classId === "biz" || value.classId === "tprop" || value.classId === "t6" || value.classId === "c130") &&
    typeof value.selectedChoiceKey === "string" && CHOICE_KEY.test(value.selectedChoiceKey) &&
    Array.isArray(value.eligibleChoiceKeys) &&
    value.eligibleChoiceKeys.length > 0 &&
    value.eligibleChoiceKeys.length <= MISSION_MAX_ELIGIBLE_CHOICES &&
    new Set(value.eligibleChoiceKeys).size === value.eligibleChoiceKeys.length &&
    value.eligibleChoiceKeys.every((key) => typeof key === "string" && CHOICE_KEY.test(key)) &&
    record(versions) && exactKeys(versions, versionKeys) &&
    versionKeys.every((key) => typeof versions[key] === "string" && VERSION.test(String(versions[key]))) &&
    missionPreviewFingerprint(value as MissionPreviewIdentity).length <= 4_096;
}

export function validatePrepareMission(body: unknown): PrepareMissionRequest {
  if (!record(body) || !exactKeys(body, ["aircraftHex", "position", "preview"])) {
    throw new ValidationError(400, "INVALID_REQUEST", "Mission preparation is invalid");
  }
  if (
    typeof body.aircraftHex !== "string" ||
    !HEX.test(body.aircraftHex) ||
    !record(body.position) ||
    !exactKeys(body.position, ["lat", "lon"]) ||
    !finite(body.position.lat, -90, 90) ||
    !finite(body.position.lon, -180, 180) ||
    !preview(body.preview) ||
    body.preview.aircraftHex.toLowerCase() !== body.aircraftHex.toLowerCase()
  ) {
    throw new ValidationError(400, "INVALID_REQUEST", "Mission preparation is invalid");
  }
  return {
    aircraftHex: body.aircraftHex.toLowerCase(),
    position: { lat: body.position.lat, lon: body.position.lon },
    preview: {
      ...body.preview,
      aircraftHex: body.preview.aircraftHex.toLowerCase(),
    },
  };
}

export function validateLockMission(body: unknown): LockMissionRequest {
  if (
    !record(body) ||
    !exactKeys(body, ["preparationToken", "choiceKey", "assist"]) ||
    typeof body.preparationToken !== "string" ||
    !TOKEN.test(body.preparationToken) ||
    typeof body.choiceKey !== "string" ||
    !CHOICE_KEY.test(body.choiceKey) ||
    !["none", "low", "medium", "high"].includes(String(body.assist))
  ) {
    throw new ValidationError(400, "INVALID_REQUEST", "Mission lock request is invalid");
  }
  return body as LockMissionRequest;
}

export function validateMissionResult(body: unknown): MissionResultRequest {
  const versionKeys = [
    "airportDataset", "aircraftProfile", "missionProfile", "assignment", "scoring",
    "physics", "assistDefinition",
  ];
  const versions = record(body) ? body.versions : null;
  if (
    !record(body) ||
    !exactKeys(body, [
      "schemaVersion", "missionId", "receipt", "choiceKey", "versions", "highestAssist", "evidence",
    ]) ||
    body.schemaVersion !== 1 || typeof body.missionId !== "string" || !UUID.test(body.missionId) ||
    typeof body.receipt !== "string" || !TOKEN.test(body.receipt) ||
    typeof body.choiceKey !== "string" || !CHOICE_KEY.test(body.choiceKey) ||
    !record(versions) || !exactKeys(versions, versionKeys) ||
    !versionKeys.every((key) => typeof versions[key] === "string" && VERSION.test(String(versions[key]))) ||
    !["FULL", "NAV", "OFF"].includes(String(body.highestAssist)) ||
    !isLandingEvidence(body.evidence)
  ) {
    throw new ValidationError(400, "INVALID_REQUEST", "Mission result is invalid");
  }
  return body as MissionResultRequest;
}

function authenticatedUserId(context: { actor: import("../../telemetry/requestContext").RequestActor }): string {
  if (context.actor.kind === "anonymous") {
    throw new ApiHttpError(401, "AUTH_REQUIRED", "Authentication is required");
  }
  return context.actor.userId;
}

function assetSource(env: Env) {
  return {
    fetch(path: string) {
      const origin = env.PUBLIC_ORIGIN ?? "https://worker-assets.invalid";
      return env.ASSETS.fetch(new Request(new URL(path, origin)));
    },
  };
}

export function createMissionRoutes(
  overrides: Partial<MissionRouteDependencies> = {},
): readonly RouteDefinition[] {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };

  const prepare = defineRoute({
    method: "POST",
    path: "/api/missions/prepare",
    family: "missions",
    boundary: "authenticated",
    admission: "public-write",
    security: {
      sameOrigin: "required",
      csrf: "required",
      idempotency: "required",
      body: { kind: "json", maxBytes: MISSION_PREPARE_BODY_MAX_BYTES },
    },
    limiter: { name: "missions", retryAfterSeconds: 5 },
    validate: ({ body }) => validatePrepareMission(body),
    handler: async ({ context, validated, env }) => {
      const runtime = env as Env;
      const userId = authenticatedUserId(context);
      const request = validated as PrepareMissionRequest;
      let traffic;
      try {
        const result = await dependencies.broker(runtime.ADSB_BROKER, {
          type: "traffic",
          forceMode: context.mode,
          request: {
            latitude: request.position.lat,
            longitude: request.position.lon,
            radiusNm: MISSION_CONTACT_SEARCH_RADIUS_NM,
            audience: { kind: "signed", userId },
          },
        });
        if (result.type !== "traffic") throw new TypeError("Unexpected broker response");
        traffic = result.traffic;
      } catch (error) {
        throw new ApiHttpError(
          503,
          "BROKER_UNAVAILABLE",
          "Fresh mission traffic is unavailable",
          { cause: error },
        );
      }
      const prepared = await prepareAuthoritativeMission({
        now: Date.parse(context.serverTime),
        uuid: dependencies.uuid,
        userId,
        signingSecret: runtime.MISSION_SIGNING_SECRET,
        traffic,
        request,
        airportSource: assetSource(runtime),
      });
      if (prepared.reconfirmationRequired) {
        throw new ApiHttpError(
          409,
          "MISSION_RECONFIRM_REQUIRED",
          "The aircraft or eligible route changed during server revalidation",
          { data: { preparation: prepared.preparation } },
        );
      }
      return {
        code: "MISSION_PREPARED" as const,
        data: { preparation: prepared.preparation },
      };
    },
  });

  const lock = defineRoute({
    method: "POST",
    path: "/api/missions",
    family: "missions",
    boundary: "authenticated",
    admission: "public-write",
    security: {
      sameOrigin: "required",
      csrf: "required",
      idempotency: "required",
      body: { kind: "json", maxBytes: MISSION_LOCK_BODY_MAX_BYTES },
    },
    limiter: { name: "missions", retryAfterSeconds: 5 },
    validate: ({ body }) => validateLockMission(body),
    handler: async ({ context, validated, idempotencyKey, env }) => {
      const runtime = env as Env;
      const userId = authenticatedUserId(context);
      const lease = {
        acquire: async (leaseUserId: string, missionId: string) => {
          let result;
          try {
            result = await dependencies.broker(runtime.ADSB_BROKER, {
              type: "lease-acquire",
              forceMode: context.mode,
              userId: leaseUserId,
              missionId,
            });
          } catch (error) {
            throw new ApiHttpError(503, "BROKER_UNAVAILABLE", "Flight lease broker is unavailable", { cause: error });
          }
          if (result.type !== "lease") throw new ApiHttpError(503, "BROKER_UNAVAILABLE", "Flight lease broker returned an invalid response");
          return result.allowed && result.lease !== undefined
            ? { expiresAtMs: result.lease.expiresAtMs }
            : null;
        },
        release: async (leaseUserId: string, missionId: string) => {
          await dependencies.broker(runtime.ADSB_BROKER, {
            type: "lease-release",
            userId: leaseUserId,
            missionId,
          });
        },
      };
      const mission = await lockAuthoritativeMission({
        db: runtime.DB,
        lease,
        userId,
        idempotencyKey: idempotencyKey ?? "",
        signingSecret: runtime.MISSION_SIGNING_SECRET,
        now: Date.parse(context.serverTime),
        request: validated as LockMissionRequest,
      });
      return { code: "MISSION_LOCKED" as const, data: { mission } };
    },
  });

  const traffic = defineRoute({
    method: "GET",
    path: "/api/missions/:missionId/traffic",
    family: "mission-traffic",
    boundary: "authenticated",
    admission: "active-flight",
    security: {
      sameOrigin: "not-required",
      csrf: "not-required",
      idempotency: "not-required",
      body: { kind: "none" },
    },
    limiter: { name: "missions", retryAfterSeconds: 5 },
    validate: ({ request }) => activeTrafficQuery(request),
    handler: async ({ context, params, validated, env }) => {
      const runtime = env as Env;
      const userId = authenticatedUserId(context);
      const mission = await ownedLockedMission(runtime.DB, params.missionId ?? "", userId);
      const query = validated as ReturnType<typeof activeTrafficQuery>;
      let result;
      try {
        result = await dependencies.broker(runtime.ADSB_BROKER, {
          type: "traffic",
          forceMode: context.mode,
          request: {
            ...query,
            audience: {
              kind: "active-ghost",
              userId,
              missionId: mission.id,
              selectedHex: mission.aircraftHex,
            },
          },
        });
      } catch (error) {
        throw new ApiHttpError(
          503,
          "BROKER_UNAVAILABLE",
          "Active-flight traffic is unavailable",
          { cause: error },
        );
      }
      if (result.type !== "traffic") {
        throw new ApiHttpError(503, "BROKER_UNAVAILABLE", "Active-flight traffic response is invalid");
      }
      return { code: "MISSION_TRAFFIC_UPDATED" as const, data: result.traffic };
    },
  });

  const release = defineRoute({
    method: "POST",
    path: "/api/missions/:missionId/release",
    family: "mission-release",
    boundary: "authenticated",
    admission: "recovery",
    security: {
      sameOrigin: "required",
      csrf: "required",
      idempotency: "required",
      body: { kind: "json", maxBytes: 64 },
    },
    limiter: { name: "missions", retryAfterSeconds: 5 },
    validate: ({ body }) => {
      if (!record(body) || Object.keys(body).length !== 0) {
        throw new ValidationError(400, "INVALID_REQUEST", "Mission release request is invalid");
      }
      return body;
    },
    handler: async ({ context, params, env }) => {
      const runtime = env as Env;
      const userId = authenticatedUserId(context);
      const mission = await ownedLockedMission(runtime.DB, params.missionId ?? "", userId);
      let result;
      try {
        result = await dependencies.broker(runtime.ADSB_BROKER, {
          type: "lease-release",
          userId,
          missionId: mission.id,
        });
      } catch (error) {
        throw new ApiHttpError(503, "BROKER_UNAVAILABLE", "Flight lease release is unavailable", { cause: error });
      }
      if (result.type !== "lease" || (!result.allowed && result.reason !== "not-found")) {
        throw new ApiHttpError(503, "BROKER_UNAVAILABLE", "Flight lease release was refused");
      }
      return {
        code: "MISSION_LEASE_RELEASED" as const,
        data: { released: true },
      };
    },
  });

  const result = defineRoute({
    method: "POST",
    path: "/api/missions/:missionId/result",
    family: "mission-results",
    boundary: "authenticated",
    admission: "public-write",
    security: {
      sameOrigin: "required",
      csrf: "required",
      idempotency: "required",
      body: { kind: "json", maxBytes: MISSION_RESULT_BODY_MAX_BYTES },
    },
    limiter: { name: "missions", retryAfterSeconds: 5 },
    validate: ({ body }) => validateMissionResult(body),
    handler: async ({ context, params, validated, idempotencyKey, env }) => {
      const runtime = env as Env;
      const userId = authenticatedUserId(context);
      const missionId = params.missionId ?? "";
      if (!UUID.test(missionId)) throw new ApiHttpError(404, "NOT_FOUND", "Mission not found");
      const result = await finalizeAuthoritativeResult({
        db: runtime.DB,
        userId,
        missionId,
        idempotencyKey: idempotencyKey ?? "",
        signingSecret: runtime.MISSION_SIGNING_SECRET,
        now: Date.parse(context.serverTime),
        uuid: dependencies.uuid,
        request: validated as MissionResultRequest,
        releaseLease: async (leaseUserId, leaseMissionId) => {
          const released = await dependencies.broker(runtime.ADSB_BROKER, {
            type: "lease-release",
            userId: leaseUserId,
            missionId: leaseMissionId,
          });
          if (
            released.type !== "lease" ||
            (!released.allowed && released.reason !== "not-found")
          ) throw new TypeError("Flight lease release was refused");
        },
        traces: runtime.RESULT_TRACES,
        recordTraceHealth: async (outcome) => {
          await dependencies.broker(runtime.ADSB_BROKER, {
            type: "health-record",
            component: "r2",
            outcome,
          });
        },
      });
      return { code: "RESULT_ACCEPTED" as const, data: { result } };
    },
  });

  return [prepare, lock, traffic, release, result];
}
