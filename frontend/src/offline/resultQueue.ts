import type { PendingMissionResult } from "../debrief/types";
import { MISSION_RESULT_BODY_MAX_BYTES } from "../shared/limits";

export const RESULT_QUEUE_MAX_COUNT = 8;
export const RESULT_QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const RESULT_QUEUE_MAX_BYTES = 1_048_576;

export type QueuedMissionResult = PendingMissionResult & {
  schemaVersion: 1;
  missionId: string;
  queuedAt: number;
  expiresAt: number;
  byteSize: number;
};

export type ResultQueue = {
  enqueue(pending: PendingMissionResult, queuedAt: number, expiresAt: number): Promise<QueuedMissionResult>;
  list(now: number): Promise<QueuedMissionResult[]>;
  remove(missionId: string, idempotencyKey: string): Promise<void>;
};

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function createQueuedMissionResult(
  pending: PendingMissionResult,
  queuedAt: number,
  expiresAt: number,
): QueuedMissionResult {
  if (!Number.isFinite(queuedAt) || !Number.isFinite(expiresAt) || expiresAt <= queuedAt) {
    throw new TypeError("Queued result timestamps are invalid");
  }
  const base = {
    schemaVersion: 1 as const,
    missionId: pending.request.missionId,
    queuedAt,
    expiresAt: Math.min(expiresAt, queuedAt + RESULT_QUEUE_MAX_AGE_MS),
    ...pending,
  };
  if (encodedBytes(pending.request) > MISSION_RESULT_BODY_MAX_BYTES) {
    throw new RangeError("Mission result request exceeds the Worker body limit");
  }
  let queued = { ...base, byteSize: 0 };
  for (;;) {
    const byteSize = encodedBytes(queued);
    if (byteSize === queued.byteSize) break;
    queued = { ...queued, byteSize };
  }
  if (queued.byteSize > RESULT_QUEUE_MAX_BYTES) {
    throw new RangeError("Mission result is too large to queue");
  }
  return queued;
}

export function pruneExpiredResults(
  records: readonly QueuedMissionResult[],
  now: number,
): QueuedMissionResult[] {
  return records
    .filter((record) => {
      if (record.schemaVersion !== 1 || !Number.isFinite(record.queuedAt) ||
        record.queuedAt > now || !Number.isFinite(record.expiresAt) || record.expiresAt <= now ||
        record.expiresAt > record.queuedAt + RESULT_QUEUE_MAX_AGE_MS ||
        record.missionId !== record.request?.missionId ||
        typeof record.idempotencyKey !== "string" || record.idempotencyKey.length === 0 ||
        !Number.isFinite(record.byteSize) || record.byteSize <= 0 ||
        record.byteSize > RESULT_QUEUE_MAX_BYTES) return false;
      return encodedBytes(record) === record.byteSize;
    })
    .sort((left, right) => left.queuedAt - right.queuedAt || left.missionId.localeCompare(right.missionId));
}

export function boundedResultQueue(
  records: readonly QueuedMissionResult[],
  incoming: QueuedMissionResult,
  now: number,
): QueuedMissionResult[] {
  const live = pruneExpiredResults(records, now);
  const existing = live.find((record) => record.missionId === incoming.missionId);
  if (existing !== undefined) {
    if (existing.idempotencyKey !== incoming.idempotencyKey) {
      throw new Error("Mission result idempotency conflict");
    }
    return live;
  }
  const bounded = [...live, incoming].sort(
    (left, right) => left.queuedAt - right.queuedAt || left.missionId.localeCompare(right.missionId),
  );
  let totalBytes = bounded.reduce((sum, record) => sum + record.byteSize, 0);
  while (bounded.length > RESULT_QUEUE_MAX_COUNT || totalBytes > RESULT_QUEUE_MAX_BYTES) {
    const removed = bounded.shift();
    if (removed !== undefined) totalBytes -= removed.byteSize;
  }
  if (!bounded.includes(incoming)) throw new RangeError("Mission result could not fit in the queue");
  return bounded;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed")), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed")), { once: true });
  });
}

export function createIndexedDbResultQueue(factory: IDBFactory): ResultQueue {
  let databasePromise: Promise<IDBDatabase> | null = null;
  function database(): Promise<IDBDatabase> {
    if (databasePromise !== null) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = factory.open("adsb-game-results", 1);
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains("results")) {
          request.result.createObjectStore("results", { keyPath: "missionId" });
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB unavailable")), { once: true });
    });
    return databasePromise;
  }

  async function mutate(
    update: (records: QueuedMissionResult[]) => QueuedMissionResult[],
  ): Promise<QueuedMissionResult[]> {
    const db = await database();
    const transaction = db.transaction("results", "readwrite");
    const store = transaction.objectStore("results");
    const current = await requestValue(store.getAll() as IDBRequest<QueuedMissionResult[]>);
    const next = update(current);
    store.clear();
    for (const record of next) store.put(record);
    await transactionDone(transaction);
    return next;
  }

  return {
    async enqueue(pending, queuedAt, expiresAt) {
      const incoming = createQueuedMissionResult(pending, queuedAt, expiresAt);
      const records = await mutate((current) => boundedResultQueue(current, incoming, queuedAt));
      return records.find((record) => record.missionId === incoming.missionId) ?? incoming;
    },
    list(now) {
      return mutate((current) => pruneExpiredResults(current, now));
    },
    async remove(missionId, idempotencyKey) {
      await mutate((current) => current.filter(
        (record) => record.missionId !== missionId || record.idempotencyKey !== idempotencyKey,
      ));
    },
  };
}
