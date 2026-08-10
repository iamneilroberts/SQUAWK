import type { PendingMissionResult } from "../debrief/types";
import type { MissionResultView } from "../mission/resultPackage";
import { createIndexedDbResultQueue, type QueuedMissionResult, type ResultQueue } from "./resultQueue";
import { syncPendingResults } from "./sync";

export type ResultQueueSnapshot = {
  pendingCount: number;
  syncing: boolean;
  message: string | null;
};

export type ResultQueueEvent =
  | { kind: "accepted"; record: QueuedMissionResult; result: MissionResultView }
  | { kind: "discarded"; record: QueuedMissionResult };

let queue: ResultQueue | null = null;
let activeSync: Promise<void> | null = null;
let snapshot: ResultQueueSnapshot = { pendingCount: 0, syncing: false, message: null };
const listeners = new Set<() => void>();
const eventListeners = new Set<(event: ResultQueueEvent) => void>();

function resultQueue(): ResultQueue {
  if (queue !== null) return queue;
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  queue = createIndexedDbResultQueue(indexedDB);
  return queue;
}

function publish(next: ResultQueueSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function refresh(message = snapshot.message): Promise<void> {
  const records = await resultQueue().list(Date.now());
  publish({ pendingCount: records.length, syncing: snapshot.syncing, message });
}

export function getResultQueueSnapshot(): ResultQueueSnapshot {
  return snapshot;
}

export function subscribeResultQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeResultQueueEvents(listener: (event: ResultQueueEvent) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export async function queueMissionResult(
  pending: PendingMissionResult,
  queuedAt: number,
  expiresAt: number,
): Promise<void> {
  await resultQueue().enqueue(pending, queuedAt, expiresAt);
  await refresh("RESULT SAVED FOR RETRY");
  // Do not make result submission wait for a service-worker registration: development,
  // unsupported, or failed-registration environments may leave `ready` pending forever.
  void navigator.serviceWorker?.ready.then(async (registration) => {
    const syncRegistration = registration as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    };
    await syncRegistration.sync?.register("sync-mission-results");
  }).catch(() => {
    // Foreground online/app-start retry remains available when Background Sync is absent.
  });
}

export async function removeQueuedMissionResult(
  missionId: string,
  idempotencyKey: string,
): Promise<void> {
  await resultQueue().remove(missionId, idempotencyKey);
  await refresh(null);
}

export function syncQueuedMissionResults(): Promise<void> {
  if (activeSync !== null) return activeSync;
  publish({ ...snapshot, syncing: true });
  let pendingQueue: ResultQueue;
  try {
    pendingQueue = resultQueue();
  } catch {
    publish({ ...snapshot, syncing: false, message: "OFFLINE RESULT STORAGE IS UNAVAILABLE" });
    return Promise.resolve();
  }
  activeSync = syncPendingResults({
    queue: pendingQueue,
    onAccepted(record, result) {
      for (const listener of eventListeners) {
        listener({ kind: "accepted", record, result: result as MissionResultView });
      }
    },
    onDiscarded(record) {
      for (const listener of eventListeners) listener({ kind: "discarded", record });
    },
  }).then((outcome) => {
    publish({
      pendingCount: outcome.remaining,
      syncing: false,
      message: outcome.accepted > 0
        ? `${outcome.accepted} QUEUED RESULT${outcome.accepted === 1 ? "" : "S"} VERIFIED`
        : outcome.discarded > 0
          ? `${outcome.discarded} INVALID OR EXPIRED RESULT${outcome.discarded === 1 ? "" : "S"} DISCARDED`
          : outcome.remaining > 0 ? "WAITING FOR A VALID SESSION AND NETWORK" : null,
    });
  }).catch(() => {
    publish({ ...snapshot, syncing: false, message: "RESULT SYNC WILL RETRY" });
  }).finally(() => {
    activeSync = null;
  });
  return activeSync;
}

export function startResultSync(): () => void {
  const sync = () => void syncQueuedMissionResults();
  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === "SYNC_RESULTS") sync();
  };
  window.addEventListener("online", sync);
  const onVisibility = () => {
    if (document.visibilityState === "visible") sync();
  };
  document.addEventListener("visibilitychange", onVisibility);
  navigator.serviceWorker?.addEventListener("message", onMessage);
  const interval = window.setInterval(() => {
    if (document.visibilityState === "visible") sync();
  }, 60_000);
  void refresh().then(sync).catch(() => undefined);
  return () => {
    window.removeEventListener("online", sync);
    document.removeEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker?.removeEventListener("message", onMessage);
    window.clearInterval(interval);
  };
}
