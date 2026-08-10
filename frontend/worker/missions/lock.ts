import {
  missionChoiceKey,
  missionVersions,
  type LockedMissionDocument,
  type LockedMissionView,
  type LockMissionRequest,
  type MissionReconstruction,
  type MissionReceiptPayload,
} from "../../src/mission/contract";
import { missionProfileForClass } from "../../src/mission/profiles";
import { loadClassById } from "../../src/sim/params";
import { buildSpawnState } from "../../src/takeover/spawn";
import type { ClassParams } from "../../src/sim/types";
import {
  MISSION_RECEIPT_TTL_MS,
} from "../../src/shared/limits";
import { DATA_VERSIONS } from "../../src/shared/versions";
import {
  createLockedMission,
  getMissionById,
  getMissionByUserAndIdempotencyKey,
} from "../db/missions";
import type { Mission } from "../db/types";
import { ApiHttpError } from "../http/response";
import {
  MissionAuthorizationError,
  signMissionReceipt,
  verifyMissionPreparation,
} from "./authorization";

export type MissionLease = {
  expiresAtMs: number;
};

export type MissionLeaseDependencies = {
  acquire(userId: string, missionId: string): Promise<MissionLease | null>;
  release(userId: string, missionId: string): Promise<void>;
};

export type LockAuthoritativeMissionOptions = {
  db: D1Database;
  lease: MissionLeaseDependencies;
  userId: string;
  idempotencyKey: string;
  signingSecret: string;
  now: number;
  request: LockMissionRequest;
};

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function reconstruction(
  contact: Parameters<typeof buildSpawnState>[0],
  aircraftProfile: ClassParams,
): MissionReconstruction {
  const spawn = buildSpawnState(contact, aircraftProfile, {
    terrainHeightM: null,
  });
  return {
    disclosure:
      "Position, altitude, track, groundspeed, and available vertical rate are measured ADS-B values. Attitude, body rates, controls, and engine state are reconstructed class defaults.",
    terrainHeightM: null,
    altitudeSource: spawn.altitudeSource,
    verticalRateSource: contact.baro_rate === null ? "reconstructed-zero" : "barometric",
    state: spawn.state,
    controls: spawn.controls,
    adjustments: spawn.adjustments,
  };
}

function parseLockedDocument(mission: Mission): LockedMissionDocument | null {
  try {
    const value = JSON.parse(mission.adsbSnapshotJson) as LockedMissionDocument;
    return value.schemaVersion === 2 &&
      value.preparationId === mission.id &&
      typeof value.idempotencyKey === "string" &&
      typeof value.lockRequestDigest === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

function currentVersions(payload: {
  classId: "c172s" | "b738" | "f5e";
  versions: { airportDataset: string };
}) {
  const profile = missionProfileForClass(payload.classId);
  return missionVersions({
    datasetVersion: payload.versions.airportDataset,
    profileVersion: profile.profileVersion,
    assignmentVersion: profile.assignmentVersion,
    scoringVersion: profile.scoringVersion,
  });
}

function sameVersions(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const keys = Object.keys(left).sort();
  return keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key]);
}

async function lockedView(options: {
  document: LockedMissionDocument;
  leaseExpiresAt: number;
  signingSecret: string;
}): Promise<LockedMissionView> {
  const receiptPayload: MissionReceiptPayload = {
    schemaVersion: 1,
    purpose: "mission-receipt",
    missionId: options.document.preparationId,
    aircraftHex: options.document.contact.hex,
    choiceKey: missionChoiceKey(options.document.assignment),
    lockedAt: options.document.lockedAt,
    expiresAt: options.document.lockedAt + MISSION_RECEIPT_TTL_MS,
    versions: options.document.versions,
  };
  return {
    schemaVersion: 1,
    missionId: options.document.preparationId,
    status: "locked",
    lockedAt: options.document.lockedAt,
    leaseExpiresAt: options.leaseExpiresAt,
    receipt: await signMissionReceipt(receiptPayload, options.signingSecret),
    contact: options.document.contact,
    traffic: options.document.traffic,
    classId: options.document.classId,
    assignment: options.document.assignment,
    versions: options.document.versions,
    assist: options.document.assist,
    reconstruction: options.document.reconstruction,
  };
}

function matchingExisting(
  mission: Mission | null,
  userId: string,
  requestDigest: string,
): LockedMissionDocument | null {
  if (mission === null) return null;
  const document = parseLockedDocument(mission);
  if (
    mission.userId !== userId ||
    mission.status !== "locked" ||
    document === null ||
    document.lockRequestDigest !== requestDigest
  ) {
    throw new ApiHttpError(
      409,
      "MISSION_IDEMPOTENCY_CONFLICT",
      "The mission preparation or idempotency key was already used differently",
    );
  }
  return document;
}

export async function lockAuthoritativeMission(
  options: LockAuthoritativeMissionOptions,
): Promise<LockedMissionView> {
  let payload;
  let preparationExpired = false;
  try {
    payload = await verifyMissionPreparation({
      token: options.request.preparationToken,
      secret: options.signingSecret,
      userId: options.userId,
      now: options.now,
    });
  } catch (error) {
    const expired = error instanceof MissionAuthorizationError && error.message.includes("expired");
    if (!expired) {
      throw new ApiHttpError(
        409,
        "MISSION_PREPARATION_INVALID",
        "Mission preparation is invalid",
        { cause: error },
      );
    }
    preparationExpired = true;
    try {
      payload = await verifyMissionPreparation({
        token: options.request.preparationToken,
        secret: options.signingSecret,
        userId: options.userId,
        now: 0,
      });
    } catch (verificationError) {
      throw new ApiHttpError(
        409,
        "MISSION_PREPARATION_EXPIRED",
        "Mission preparation has expired",
        { cause: verificationError },
      );
    }
  }

  if (payload.versions.airportDataset !== DATA_VERSIONS.airport) {
    throw new ApiHttpError(
      409,
      "MISSION_PREPARATION_INVALID",
      "Mission airport data is no longer current",
    );
  }
  const expectedVersions = currentVersions(payload);
  if (!sameVersions(payload.versions, expectedVersions)) {
    throw new ApiHttpError(
      409,
      "MISSION_PREPARATION_INVALID",
      "Mission rules changed after preparation",
    );
  }
  const assignment = payload.eligibleChoices.find(
    (choice) => missionChoiceKey(choice) === options.request.choiceKey,
  );
  if (assignment === undefined) {
    throw new ApiHttpError(
      409,
      "MISSION_DESTINATION_INVALID",
      "The selected destination was not in the authoritative eligible set",
    );
  }

  const requestDigest = await sha256(JSON.stringify([
    payload.preparationId,
    options.idempotencyKey,
    options.request.choiceKey,
    options.request.assist,
  ]));
  const [byMissionId, byIdempotencyKey] = await Promise.all([
    getMissionById(options.db, payload.preparationId),
    getMissionByUserAndIdempotencyKey(
      options.db,
      options.userId,
      options.idempotencyKey,
    ),
  ]);
  const existing = matchingExisting(
    byMissionId ?? byIdempotencyKey,
    options.userId,
    requestDigest,
  );
  if (existing !== null) {
    const lease = await options.lease.acquire(options.userId, payload.preparationId);
    if (lease === null) {
      throw new ApiHttpError(
        409,
        "MISSION_CAPACITY_UNAVAILABLE",
        "Active-flight capacity is unavailable",
      );
    }
    return lockedView({
      document: existing,
      leaseExpiresAt: lease.expiresAtMs,
      signingSecret: options.signingSecret,
    });
  }
  if (preparationExpired) {
    throw new ApiHttpError(
      409,
      "MISSION_PREPARATION_EXPIRED",
      "Mission preparation has expired",
    );
  }

  const lease = await options.lease.acquire(options.userId, payload.preparationId);
  if (lease === null) {
    throw new ApiHttpError(
      409,
      "MISSION_CAPACITY_UNAVAILABLE",
      "Active-flight capacity is unavailable",
    );
  }

  const missionProfile = missionProfileForClass(payload.classId);
  const aircraftProfile = loadClassById(payload.classId);
  const document: LockedMissionDocument = {
    schemaVersion: 2,
    preparationId: payload.preparationId,
    idempotencyKey: options.idempotencyKey,
    lockRequestDigest: requestDigest,
    contact: payload.contact,
    traffic: payload.traffic,
    classId: payload.classId,
    aircraftProfile: structuredClone(aircraftProfile),
    missionProfile: structuredClone(missionProfile),
    assignment,
    versions: payload.versions,
    assist: options.request.assist,
    reconstruction: reconstruction(payload.contact, aircraftProfile),
    preparedAt: payload.issuedAt,
    lockedAt: options.now,
  };

  try {
    await createLockedMission(options.db, {
      id: payload.preparationId,
      userId: options.userId,
      aircraftHex: payload.contact.hex,
      aircraftClass: payload.classId,
      adsbSnapshot: document,
      airportIcao: assignment.airportIdent,
      runwayIdent: assignment.runwayEndIdent,
      scoringVersion: payload.versions.scoring,
      physicsVersion: payload.versions.physics,
      assists: {
        schemaVersion: 1,
        selected: options.request.assist,
        definitionVersion: payload.versions.assistDefinition,
      },
      createdAt: payload.issuedAt,
      lockedAt: options.now,
    });
  } catch (error) {
    let commitState: "unknown" | "present" | "absent" = "unknown";
    try {
      const [racedById, racedByKey] = await Promise.all([
        getMissionById(options.db, payload.preparationId),
        getMissionByUserAndIdempotencyKey(
          options.db,
          options.userId,
          options.idempotencyKey,
        ),
      ]);
      commitState = racedById === null ? "absent" : "present";
      const raced = matchingExisting(
        racedById ?? racedByKey,
        options.userId,
        requestDigest,
      );
      if (raced !== null) {
        return lockedView({
          document: raced,
          leaseExpiresAt: lease.expiresAtMs,
          signingSecret: options.signingSecret,
        });
      }
    } catch (raceError) {
      if (raceError instanceof ApiHttpError) {
        if (commitState !== "present") {
          await options.lease.release(options.userId, payload.preparationId).catch(() => undefined);
        }
        throw raceError;
      }
    }
    if (commitState === "absent") {
      await options.lease.release(options.userId, payload.preparationId).catch(() => undefined);
    }
    throw new ApiHttpError(
      503,
      "MISSION_COMMIT_FAILED",
      "The authoritative mission could not be committed",
      { cause: error },
    );
  }

  return lockedView({
    document,
    leaseExpiresAt: lease.expiresAtMs,
    signingSecret: options.signingSecret,
  });
}
