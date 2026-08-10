import { describe, expect, it, vi } from "vitest";

import { AuthClientError } from "../auth/session";
import type { PendingMissionResult } from "../debrief/types";
import { createQueuedMissionResult, type ResultQueue } from "./resultQueue";
import { syncPendingResults } from "./sync";

function record(missionId: string) {
  const pending = {
    idempotencyKey: `key-${missionId}`,
    request: { schemaVersion: 1, missionId } as PendingMissionResult["request"],
    preview: {} as PendingMissionResult["preview"],
  };
  return createQueuedMissionResult(pending, 100, 10_000);
}

function queueWith(records = [record("mission-a")]): ResultQueue & { remove: ReturnType<typeof vi.fn> } {
  return {
    enqueue: vi.fn(),
    list: vi.fn().mockResolvedValue(records),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

describe("offline result synchronization", () => {
  it("submits the original package and idempotency key exactly once, then removes it", async () => {
    const queue = queueWith();
    const submit = vi.fn().mockResolvedValue({ missionId: "mission-a" });
    const outcome = await syncPendingResults({ queue, submit, now: 500 });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ missionId: "mission-a" }), "key-mission-a");
    expect(queue.remove).toHaveBeenCalledWith("mission-a", "key-mission-a");
    expect(outcome).toMatchObject({ accepted: 1, discarded: 0, remaining: 0 });
  });

  it("retains a result during network/read-only failure and stops retrying the batch", async () => {
    const queue = queueWith([record("mission-a"), record("mission-b")]);
    const submit = vi.fn().mockRejectedValue(new AuthClientError(503, "READ_ONLY"));
    const outcome = await syncPendingResults({ queue, submit, now: 500 });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(queue.remove).not.toHaveBeenCalled();
    expect(outcome.remaining).toBe(2);
  });

  it("discards a Worker-rejected expired receipt and never marks it accepted", async () => {
    const queue = queueWith();
    const submit = vi.fn().mockRejectedValue(new AuthClientError(409, "MISSION_RESULT_INVALID"));
    const outcome = await syncPendingResults({ queue, submit, now: 500 });
    expect(queue.remove).toHaveBeenCalledWith("mission-a", "key-mission-a");
    expect(outcome).toMatchObject({ accepted: 0, discarded: 1, remaining: 0 });
  });
});
