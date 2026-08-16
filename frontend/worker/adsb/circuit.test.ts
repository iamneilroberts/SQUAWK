import { describe, expect, it } from "vitest";

import {
  PROVIDER_CIRCUIT_BASE_COOLDOWN_MS,
  PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
  PROVIDER_CIRCUIT_JITTER_FRACTION,
  PROVIDER_CIRCUIT_MAX_COOLDOWN_MS,
} from "../../src/shared/limits";
import {
  backoffMs,
  effectiveState,
  emptyCircuitStore,
  isCircuitStore,
  recordProviderOutcome,
  shouldAttemptProvider,
  type ProviderCircuitStore,
} from "./circuit";

const KEY = "api.airplanes.live";
const noJitter = () => 0;
const maxJitter = () => 1;

describe("provider circuit store validation", () => {
  it("accepts an empty store and rejects malformed shapes", () => {
    expect(isCircuitStore(emptyCircuitStore())).toBe(true);
    expect(isCircuitStore(undefined)).toBe(false);
    expect(isCircuitStore(null)).toBe(false);
    expect(isCircuitStore({ version: 2, providers: [] })).toBe(false);
    expect(isCircuitStore({ version: 1, providers: [{ providerKey: "x" }] })).toBe(false);
  });

  it("has no key for older persisted state (defaulting handled by the caller, not this module)", () => {
    // AdsbBroker's loadProviderCircuits() returns emptyCircuitStore() when the storage key
    // is absent (older persisted broker state never wrote provider-circuit:v1). This module
    // only needs to prove the empty store is valid and every provider starts closed.
    const store = emptyCircuitStore();
    expect(shouldAttemptProvider(store, KEY, 1_000)).toBe(true);
  });
});

describe("shouldAttemptProvider / effectiveState", () => {
  it("is closed and attemptable before any failure is recorded", () => {
    const store = emptyCircuitStore();
    expect(shouldAttemptProvider(store, KEY, 0)).toBe(true);
  });

  it("stays closed and attemptable below the consecutive-failure threshold", () => {
    const store = emptyCircuitStore();
    for (let i = 0; i < PROVIDER_CIRCUIT_FAILURE_THRESHOLD - 1; i += 1) {
      recordProviderOutcome(store, KEY, "failure", 1_000, noJitter);
    }
    const record = store.providers.find((candidate) => candidate.providerKey === KEY)!;
    expect(effectiveState(record, 1_000)).toBe("closed");
    expect(shouldAttemptProvider(store, KEY, 1_000)).toBe(true);
  });

  it("opens the circuit exactly at the failure threshold and skips further attempts", () => {
    const store = emptyCircuitStore();
    for (let i = 0; i < PROVIDER_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      recordProviderOutcome(store, KEY, "failure", 1_000, noJitter);
    }
    const record = store.providers.find((candidate) => candidate.providerKey === KEY)!;
    expect(record.state).toBe("open");
    expect(effectiveState(record, 1_000)).toBe("open");
    expect(shouldAttemptProvider(store, KEY, 1_000)).toBe(false);
  });

  it("does not skip a different provider's key while one is open", () => {
    const store = emptyCircuitStore();
    for (let i = 0; i < PROVIDER_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      recordProviderOutcome(store, "primary.example", "failure", 1_000, noJitter);
    }
    expect(shouldAttemptProvider(store, "primary.example", 1_000)).toBe(false);
    expect(shouldAttemptProvider(store, "fallback.example", 1_000)).toBe(true);
  });

  it("moves to half-open once the cooldown elapses, and allows exactly one probe", () => {
    const store = emptyCircuitStore();
    for (let i = 0; i < PROVIDER_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      recordProviderOutcome(store, KEY, "failure", 1_000, noJitter);
    }
    const record = store.providers.find((candidate) => candidate.providerKey === KEY)!;
    const cooldownUntil = record.cooldownUntilMs;

    expect(shouldAttemptProvider(store, KEY, cooldownUntil - 1)).toBe(false);
    expect(effectiveState(record, cooldownUntil)).toBe("half-open");
    expect(shouldAttemptProvider(store, KEY, cooldownUntil)).toBe(true);
  });

  it("a successful half-open probe closes the circuit and clears the failure streak", () => {
    const store = emptyCircuitStore();
    for (let i = 0; i < PROVIDER_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      recordProviderOutcome(store, KEY, "failure", 1_000, noJitter);
    }
    const record = store.providers.find((candidate) => candidate.providerKey === KEY)!;
    const probeAtMs = record.cooldownUntilMs;

    recordProviderOutcome(store, KEY, "success", probeAtMs, noJitter);
    const after = store.providers.find((candidate) => candidate.providerKey === KEY)!;
    expect(after.state).toBe("closed");
    expect(after.consecutiveFailures).toBe(0);
    expect(after.cooldownUntilMs).toBe(0);
    expect(shouldAttemptProvider(store, KEY, probeAtMs)).toBe(true);
  });

  it("a failed half-open probe reopens the circuit with a fresh, larger cooldown", () => {
    const store = emptyCircuitStore();
    for (let i = 0; i < PROVIDER_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      recordProviderOutcome(store, KEY, "failure", 1_000, noJitter);
    }
    const first = store.providers.find((candidate) => candidate.providerKey === KEY)!;
    const probeAtMs = first.cooldownUntilMs;

    recordProviderOutcome(store, KEY, "failure", probeAtMs, noJitter);
    const second = store.providers.find((candidate) => candidate.providerKey === KEY)!;
    expect(second.state).toBe("open");
    expect(second.consecutiveFailures).toBe(PROVIDER_CIRCUIT_FAILURE_THRESHOLD + 1);
    expect(second.cooldownUntilMs - probeAtMs).toBeGreaterThan(first.cooldownUntilMs - 1_000);
    expect(shouldAttemptProvider(store, KEY, probeAtMs)).toBe(false);
  });
});

describe("backoffMs", () => {
  it("grows monotonically with consecutive failures and stays bounded by jitter", () => {
    const thresholdCooldown = backoffMs(PROVIDER_CIRCUIT_FAILURE_THRESHOLD, noJitter);
    const nextCooldown = backoffMs(PROVIDER_CIRCUIT_FAILURE_THRESHOLD + 1, noJitter);
    expect(thresholdCooldown).toBe(PROVIDER_CIRCUIT_BASE_COOLDOWN_MS);
    expect(nextCooldown).toBeGreaterThan(thresholdCooldown);
  });

  it("bounds jitter to the configured fraction of the base cooldown", () => {
    const base = backoffMs(PROVIDER_CIRCUIT_FAILURE_THRESHOLD, noJitter);
    const withMaxJitter = backoffMs(PROVIDER_CIRCUIT_FAILURE_THRESHOLD, maxJitter);
    expect(withMaxJitter).toBeGreaterThanOrEqual(base);
    expect(withMaxJitter).toBeLessThanOrEqual(
      Math.round(base * (1 + PROVIDER_CIRCUIT_JITTER_FRACTION)),
    );
  });

  it("never exceeds the configured maximum cooldown even at very high failure counts", () => {
    expect(backoffMs(1_000, maxJitter)).toBeLessThanOrEqual(PROVIDER_CIRCUIT_MAX_COOLDOWN_MS);
  });
});

describe("recordProviderOutcome no-op reporting (review finding #1)", () => {
  it("reports no change for a healthy success with no prior record", () => {
    const store = emptyCircuitStore();
    const changed = recordProviderOutcome(store, KEY, "success", 1_000, noJitter);
    expect(changed).toBe(false);
    expect(store.providers).toHaveLength(0);
  });

  it("reports no change for a healthy success against an already-closed, zero-failure record", () => {
    const store = emptyCircuitStore();
    recordProviderOutcome(store, KEY, "success", 1_000, noJitter); // no-op, no record created
    const changed = recordProviderOutcome(store, KEY, "success", 2_000, noJitter);
    expect(changed).toBe(false);
    expect(store.providers).toHaveLength(0);
  });

  it("reports a change when success resets a sub-threshold failure streak", () => {
    const store = emptyCircuitStore();
    recordProviderOutcome(store, KEY, "failure", 1_000, noJitter); // 1 of 3, still closed
    const changed = recordProviderOutcome(store, KEY, "success", 2_000, noJitter);
    expect(changed).toBe(true);
    const record = store.providers.find((candidate) => candidate.providerKey === KEY)!;
    expect(record.consecutiveFailures).toBe(0);
  });

  it("reports a change when a half-open probe succeeds", () => {
    const store = emptyCircuitStore();
    for (let i = 0; i < PROVIDER_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      recordProviderOutcome(store, KEY, "failure", 1_000, noJitter);
    }
    const cooldownUntil = store.providers.find((c) => c.providerKey === KEY)!.cooldownUntilMs;
    expect(recordProviderOutcome(store, KEY, "success", cooldownUntil, noJitter)).toBe(true);
  });

  it("always reports a change on failure", () => {
    const store = emptyCircuitStore();
    expect(recordProviderOutcome(store, KEY, "failure", 1_000, noJitter)).toBe(true);
    expect(recordProviderOutcome(store, KEY, "failure", 2_000, noJitter)).toBe(true);
  });
});

describe("backward compatibility", () => {
  it("treats a missing provider-circuit:v1 key as an empty store (handled by AdsbBroker's loader)", () => {
    // AdsbBroker.loadProviderCircuits() defaults to emptyCircuitStore() when
    // storage.get(PROVIDER_CIRCUIT_KEY) returns undefined -- exactly like the alert lane
    // defaults AlertCoordinatorState and the provider-gate defaults ProviderGateState.
    // Simulate that directly here since this module owns the shape it defaults to.
    const store: ProviderCircuitStore = emptyCircuitStore();
    expect(isCircuitStore(store)).toBe(true);
    expect(store.providers).toHaveLength(0);
  });
});
