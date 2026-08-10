import {
  AuthClientError,
  postAuthenticatedJson,
} from "../auth/session";
import type {
  LockedMissionView,
  LockMissionRequest,
  MissionPreparationData,
  MissionPreparationView,
  PrepareMissionRequest,
} from "./contract";

export type PrepareMissionOutcome =
  | { kind: "prepared"; preparation: MissionPreparationView }
  | { kind: "reconfirm"; preparation: MissionPreparationView };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function preparationFrom(value: unknown): MissionPreparationView | null {
  if (!record(value) || !record(value.preparation)) return null;
  const preparation = value.preparation;
  return preparation.schemaVersion === 1 &&
    typeof preparation.preparationToken === "string" &&
    typeof preparation.preparationId === "string" &&
    record(preparation.contact) &&
    Array.isArray(preparation.eligibleChoices) &&
    record(preparation.selected)
    ? preparation as MissionPreparationView
    : null;
}

export async function prepareMission(
  request: PrepareMissionRequest,
): Promise<PrepareMissionOutcome> {
  try {
    const data = await postAuthenticatedJson<MissionPreparationData>(
      "/api/missions/prepare",
      request,
    );
    return { kind: "prepared", preparation: data.preparation };
  } catch (error) {
    if (error instanceof AuthClientError && error.code === "MISSION_RECONFIRM_REQUIRED") {
      const preparation = preparationFrom(error.data);
      if (preparation !== null) return { kind: "reconfirm", preparation };
    }
    throw error;
  }
}

export async function lockMission(
  request: LockMissionRequest,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<LockedMissionView> {
  const data = await postAuthenticatedJson<{ mission: LockedMissionView }>(
    "/api/missions",
    request,
    idempotencyKey,
  );
  return data.mission;
}

export async function releaseMissionLease(
  missionId: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<void> {
  await postAuthenticatedJson<{ released: boolean }>(
    `/api/missions/${missionId}/release`,
    {},
    idempotencyKey,
  );
}
