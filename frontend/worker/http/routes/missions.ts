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
} from "../../../src/shared/limits";
import type { Env } from "../../env";
import {
  sendBrokerCommand,
  type BrokerCommand,
  type BrokerCommandResult,
} from "../../durable/protocol";
import { lockAuthoritativeMission } from "../../missions/lock";
import { prepareAuthoritativeMission } from "../../missions/prepare";
import { ApiHttpError } from "../response";
import { defineRoute, type RouteDefinition } from "../router";
import { ValidationError } from "../validation";

const HEX = /^[0-9a-f]{6}$/i;
const CHOICE_KEY = /^[A-Za-z0-9:_-]{5,160}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const TOKEN = /^[A-Za-z0-9._-]{32,32768}$/;

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
    (value.classId === "c172s" || value.classId === "b738" || value.classId === "f5e") &&
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

  return [prepare, lock];
}
