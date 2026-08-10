import { AuthClientError } from "../auth/session";
import { submitMissionResult } from "../mission/api";
import type { MissionResultRequest, MissionResultView } from "../mission/resultPackage";
import type { QueuedMissionResult, ResultQueue } from "./resultQueue";

export type ResultSyncOutcome = {
  accepted: number;
  discarded: number;
  remaining: number;
};

export function resultFailureIsPermanent(error: unknown): boolean {
  if (!(error instanceof AuthClientError)) return false;
  if (["ACCOUNT_BANNED", "ACCOUNT_DISABLED", "MISSION_RESULT_INVALID"].includes(error.code ?? "")) {
    return true;
  }
  if ([408, 425, 429].includes(error.status) || error.status >= 500) return false;
  // Authentication and CSRF can recover after session refresh; never erase a valid flight for them.
  if (error.status === 401 || error.code === "CSRF_INVALID") return false;
  return error.status >= 400 && error.status < 500;
}

export async function syncPendingResults(options: {
  queue: ResultQueue;
  submit?: (request: MissionResultRequest, idempotencyKey: string) => Promise<MissionResultView | unknown>;
  now?: number;
  onAccepted?: (record: QueuedMissionResult, result: MissionResultView | unknown) => void;
  onDiscarded?: (record: QueuedMissionResult, error: unknown) => void;
}): Promise<ResultSyncOutcome> {
  const now = options.now ?? Date.now();
  const records = await options.queue.list(now);
  const submit = options.submit ?? submitMissionResult;
  let accepted = 0;
  let discarded = 0;
  for (const record of records) {
    try {
      const result = await submit(record.request, record.idempotencyKey);
      await options.queue.remove(record.missionId, record.idempotencyKey);
      accepted += 1;
      options.onAccepted?.(record, result);
    } catch (error) {
      if (!resultFailureIsPermanent(error)) break;
      await options.queue.remove(record.missionId, record.idempotencyKey);
      discarded += 1;
      options.onDiscarded?.(record, error);
    }
  }
  return { accepted, discarded, remaining: records.length - accepted - discarded };
}
