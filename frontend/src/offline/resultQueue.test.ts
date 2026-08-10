import { describe, expect, it } from "vitest";

import type { PendingMissionResult } from "../debrief/types";
import {
  RESULT_QUEUE_MAX_COUNT,
  boundedResultQueue,
  createQueuedMissionResult,
  pruneExpiredResults,
} from "./resultQueue";

function pending(missionId: string, key = `key-${missionId}`): PendingMissionResult {
  return {
    idempotencyKey: key,
    request: { schemaVersion: 1, missionId } as PendingMissionResult["request"],
    preview: {} as PendingMissionResult["preview"],
  };
}

describe("offline result queue policy", () => {
  it("deduplicates the same mission and preserves its idempotency key", () => {
    const first = createQueuedMissionResult(pending("mission-a", "stable-key"), 100, 10_000);
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBe(first.byteSize);
    const duplicate = createQueuedMissionResult(pending("mission-a", "stable-key"), 200, 10_000);
    const queue = boundedResultQueue([first], duplicate, 300);
    expect(queue).toEqual([first]);
  });

  it("rejects a second idempotency key for the same mission", () => {
    const first = createQueuedMissionResult(pending("mission-a", "stable-key"), 100, 10_000);
    const conflict = createQueuedMissionResult(pending("mission-a", "changed-key"), 200, 10_000);
    expect(() => boundedResultQueue([first], conflict, 300)).toThrow(/idempotency/i);
  });

  it("prunes expired receipts and evicts the oldest result at the count bound", () => {
    const records = Array.from({ length: RESULT_QUEUE_MAX_COUNT }, (_, index) =>
      createQueuedMissionResult(pending(`mission-${index}`), 100 + index, 10_000));
    const newest = createQueuedMissionResult(pending("mission-new"), 1_000, 10_000);
    const bounded = boundedResultQueue(records, newest, 500);
    expect(bounded).toHaveLength(RESULT_QUEUE_MAX_COUNT);
    expect(bounded.some((record) => record.missionId === "mission-0")).toBe(false);
    expect(bounded.at(-1)?.missionId).toBe("mission-new");

    expect(pruneExpiredResults(bounded, 10_000)).toEqual([]);
  });

  it("evicts oldest packages to enforce the total encoded byte bound", () => {
    const bulky = (missionId: string, queuedAt: number) => {
      const value = pending(missionId);
      value.preview = { padding: "x".repeat(400_000) } as unknown as PendingMissionResult["preview"];
      return createQueuedMissionResult(value, queuedAt, 10_000);
    };
    const first = bulky("mission-a", 100);
    const second = bulky("mission-b", 200);
    const third = bulky("mission-c", 300);
    const bounded = boundedResultQueue([first, second], third, 400);
    expect(bounded.map((record) => record.missionId)).toEqual(["mission-b", "mission-c"]);
    expect(bounded.reduce((sum, record) => sum + record.byteSize, 0)).toBeLessThanOrEqual(1_048_576);
  });

  it("drops corrupted metadata instead of trusting it back into a transaction", () => {
    const valid = createQueuedMissionResult(pending("mission-a"), 100, 10_000);
    expect(pruneExpiredResults([{ ...valid, byteSize: 1 }], 200)).toEqual([]);
  });
});
