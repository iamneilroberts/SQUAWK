// Per-provider circuit-breaker state (adsb-game#19 phase 1). Pure state transitions only —
// storage load/save and clock/random wiring live in the durable object (AdsbBroker.ts),
// mirroring how alerts/transitions.ts separates pure alert logic from its DO glue.
import {
  PROVIDER_CIRCUIT_BASE_COOLDOWN_MS,
  PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
  PROVIDER_CIRCUIT_JITTER_FRACTION,
  PROVIDER_CIRCUIT_MAX_COOLDOWN_MS,
  PROVIDER_CIRCUIT_MAX_TRACKED,
} from "../../src/shared/limits";

export type ProviderCircuitState = "closed" | "open" | "half-open";

export type ProviderCircuitRecord = {
  providerKey: string;
  state: "closed" | "open";
  consecutiveFailures: number;
  cooldownUntilMs: number;
  lastOutcome: "success" | "failure" | null;
  lastOutcomeAtMs: number;
};

export type ProviderCircuitStore = {
  version: 1;
  providers: ProviderCircuitRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isCircuitRecord(value: unknown): value is ProviderCircuitRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.providerKey === "string" &&
    value.providerKey.length > 0 &&
    value.providerKey.length <= 256 &&
    ["closed", "open"].includes(String(value.state)) &&
    count(value.consecutiveFailures) &&
    count(value.cooldownUntilMs) &&
    [null, "success", "failure"].includes(value.lastOutcome as string | null) &&
    count(value.lastOutcomeAtMs)
  );
}

export function isCircuitStore(value: unknown): value is ProviderCircuitStore {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.providers) &&
    value.providers.length <= PROVIDER_CIRCUIT_MAX_TRACKED &&
    value.providers.every(isCircuitRecord)
  );
}

export function emptyCircuitStore(): ProviderCircuitStore {
  return { version: 1, providers: [] };
}

function defaultRecord(providerKey: string): ProviderCircuitRecord {
  return {
    providerKey,
    state: "closed",
    consecutiveFailures: 0,
    cooldownUntilMs: 0,
    lastOutcome: null,
    lastOutcomeAtMs: 0,
  };
}

/** The circuit's effective state, deriving "half-open" from an elapsed cooldown. */
export function effectiveState(
  record: ProviderCircuitRecord,
  nowMs: number,
): ProviderCircuitState {
  if (record.state !== "open") return "closed";
  return nowMs < record.cooldownUntilMs ? "open" : "half-open";
}

/** Exponential backoff from the failure threshold, bounded and jittered. */
export function backoffMs(consecutiveFailures: number, random: () => number): number {
  const overThreshold = Math.max(0, consecutiveFailures - PROVIDER_CIRCUIT_FAILURE_THRESHOLD);
  const exponent = Math.min(6, overThreshold);
  const base = Math.min(
    PROVIDER_CIRCUIT_MAX_COOLDOWN_MS,
    PROVIDER_CIRCUIT_BASE_COOLDOWN_MS * 2 ** exponent,
  );
  const jitter = base * PROVIDER_CIRCUIT_JITTER_FRACTION * Math.max(0, Math.min(1, random()));
  return Math.round(Math.min(PROVIDER_CIRCUIT_MAX_COOLDOWN_MS, base + jitter));
}

/** True when `providerKey` is closed or its cooldown has elapsed (half-open probe allowed). */
export function shouldAttemptProvider(
  store: ProviderCircuitStore,
  providerKey: string,
  nowMs: number,
): boolean {
  const record = store.providers.find((candidate) => candidate.providerKey === providerKey);
  if (record === undefined) return true;
  return effectiveState(record, nowMs) !== "open";
}

/**
 * Mutates `store` in place with the outcome of an attempt against `providerKey`: a success
 * closes the circuit and clears the failure streak; a failure extends the streak and opens
 * the circuit (with a backoff cooldown) once the consecutive-failure threshold is reached.
 *
 * Returns whether `store` actually changed. A success against a provider that is already
 * closed with no failure streak (the steady-state healthy case) has nothing to reset and is
 * reported unchanged -- callers use this to skip a storage write on the hot path rather than
 * persisting an identical record (or a bare `lastOutcomeAtMs` bump) on every single fetch.
 */
export function recordProviderOutcome(
  store: ProviderCircuitStore,
  providerKey: string,
  outcome: "success" | "failure",
  nowMs: number,
  random: () => number,
): boolean {
  const existing = store.providers.find((candidate) => candidate.providerKey === providerKey);
  if (outcome === "success" && (existing === undefined || (
    existing.state === "closed" && existing.consecutiveFailures === 0
  ))) {
    return false;
  }
  const next: ProviderCircuitRecord = existing === undefined
    ? defaultRecord(providerKey)
    : { ...existing };
  next.lastOutcome = outcome;
  next.lastOutcomeAtMs = nowMs;
  if (outcome === "success") {
    next.state = "closed";
    next.consecutiveFailures = 0;
    next.cooldownUntilMs = 0;
  } else {
    next.consecutiveFailures += 1;
    if (next.consecutiveFailures >= PROVIDER_CIRCUIT_FAILURE_THRESHOLD) {
      next.state = "open";
      next.cooldownUntilMs = nowMs + backoffMs(next.consecutiveFailures, random);
    }
  }
  store.providers = store.providers.filter((candidate) => candidate.providerKey !== providerKey);
  store.providers.push(next);
  if (store.providers.length > PROVIDER_CIRCUIT_MAX_TRACKED) {
    store.providers.splice(0, store.providers.length - PROVIDER_CIRCUIT_MAX_TRACKED);
  }
  return true;
}
