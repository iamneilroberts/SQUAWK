import { getMissionById } from "../db/missions";
import { requireTimestamp, requireUuid } from "../db/client";
import type { VersionedDocument } from "../db/types";
import type { Env } from "../env";
import { ApiHttpError } from "../http/response";
import {
  recordAdminMutation,
  replayAdminMutation,
  type AdminMutationRecord,
} from "./auditMutation";
import type { AdminBroker } from "./mode";

export type TerminateFlightInput = Omit<
  AdminMutationRecord,
  "action" | "targetType" | "targetId" | "before" | "after"
> & { missionId: string };

export async function terminateFlight(
  db: D1Database,
  namespace: Env["ADSB_BROKER"],
  input: TerminateFlightInput,
  broker: AdminBroker,
) {
  const missionId = requireUuid("mission id", input.missionId);
  const base = {
    ...input,
    action: "flight.terminate",
    targetType: "mission",
    targetId: missionId,
  };
  const replay = await replayAdminMutation(db, { ...base, before: null, after: null });
  if (replay !== null) {
    const storedUserId = replay.state?.userId;
    if (typeof storedUserId !== "string") throw new Error("Flight audit is incomplete");
    try {
      await broker(namespace, {
        type: "lease-release",
        userId: storedUserId,
        missionId,
      });
    } catch (error) {
      throw new ApiHttpError(
        503,
        "BROKER_UNAVAILABLE",
        "Flight remains terminated but its broker lease could not be released immediately",
        { cause: error, data: { mutationApplied: true, auditId: replay.auditId } },
      );
    }
    return replay;
  }
  const mission = await getMissionById(db, missionId);
  if (mission === null || mission.status !== "locked") {
    throw new ApiHttpError(404, "NOT_FOUND", "Active flight not found");
  }
  const terminatedAt = requireTimestamp("terminated at", input.createdAt);
  const before: VersionedDocument = {
    schemaVersion: 1,
    missionId,
    userId: mission.userId,
    status: mission.status,
  };
  const after: VersionedDocument = { ...before, status: "abandoned", terminatedAt };
  const recorded = await recordAdminMutation(db, { ...base, before, after }, [
    db.prepare(
      "UPDATE missions SET status = 'abandoned' WHERE id = ? AND status = 'locked'",
    ).bind(missionId),
  ]);
  if (!recorded.replayed) {
    try {
      await broker(namespace, {
        type: "lease-release",
        userId: mission.userId,
        missionId,
      });
    } catch (error) {
      throw new ApiHttpError(
        503,
        "BROKER_UNAVAILABLE",
        "Flight was terminated but its broker lease could not be released immediately",
        { cause: error, data: { mutationApplied: true, auditId: recorded.auditId } },
      );
    }
  }
  return recorded;
}
