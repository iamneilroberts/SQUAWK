import {
  ALERT_COOLDOWN_MS,
  ALERT_RETRY_BASE_MS,
  type AlertCoordinatorState,
  type AlertNotification,
  type AlertObservation,
  type AlertOutboxItem,
  type AlertPhase,
  type AlertSeverity,
  type AlertSignalState,
} from "./types";

const API_WINDOW_MS = 5 * 60 * 1_000;
const API_MINIMUM_TOTAL = 20;
const API_MINIMUM_FAILURES = 5;
const API_FAILURE_RATE = 0.2;
const API_RECOVERY_RATE = 0.05;
const COMPONENT_FAILURE_COUNT = 3;
const MAX_TRACKED = 128;

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function emptyAlertState(nowMs: number): AlertCoordinatorState {
  return {
    version: 1,
    lastBrokerTransitionSequence: 0,
    signals: [],
    apiWindow: { startedAtMs: nowMs, total: 0, failures: 0, active: false, sequence: 0 },
    providerCapacity: { band: "normal", sequence: 0 },
    seenAuditIds: [],
    cooldowns: [],
    outbox: [],
    deliveredFingerprints: [],
    lastCronAtMs: null,
  };
}

function isNotification(value: unknown): value is AlertNotification {
  if (!record(value)) return false;
  return (
    typeof value.fingerprint === "string" && value.fingerprint.length <= 192 &&
    typeof value.signalKey === "string" && value.signalKey.length <= 96 &&
    ["budget", "flight-capacity", "api-health", "component-health", "provider-health", "provider-capacity", "admin-action", "test"].includes(String(value.kind)) &&
    ["active", "recovery", "test"].includes(String(value.phase)) &&
    ["warning", "error", "recovery", "test"].includes(String(value.severity)) &&
    count(value.occurredAtMs) &&
    typeof value.title === "string" && value.title.length <= 128 &&
    (value.threshold === null || typeof value.threshold === "string") &&
    (value.action === null || typeof value.action === "string") &&
    (value.remainingCapacity === null || count(value.remainingCapacity)) &&
    (value.requestId === null || typeof value.requestId === "string") &&
    (value.auditId === null || typeof value.auditId === "string")
  );
}

export function isAlertState(value: unknown): value is AlertCoordinatorState {
  if (!record(value) || value.version !== 1) return false;
  const window = value.apiWindow;
  const providerCapacity = value.providerCapacity;
  return (
    count(value.lastBrokerTransitionSequence) &&
    Array.isArray(value.signals) && value.signals.length <= 32 && value.signals.every((signal) =>
      record(signal) && typeof signal.key === "string" && signal.key.length <= 96 &&
      typeof signal.active === "boolean" && count(signal.consecutiveFailures) && count(signal.sequence)
    ) &&
    record(window) && count(window.startedAtMs) && count(window.total) && count(window.failures) &&
    Number(window.failures) <= Number(window.total) && typeof window.active === "boolean" && count(window.sequence) &&
    record(providerCapacity) && ["normal", "70", "90", "100"].includes(String(providerCapacity.band)) && count(providerCapacity.sequence) &&
    Array.isArray(value.seenAuditIds) && value.seenAuditIds.length <= MAX_TRACKED && value.seenAuditIds.every((item) => typeof item === "string") &&
    Array.isArray(value.cooldowns) && value.cooldowns.length <= MAX_TRACKED && value.cooldowns.every((item) => record(item) && typeof item.key === "string" && count(item.queuedAtMs)) &&
    Array.isArray(value.outbox) && value.outbox.length <= 32 && value.outbox.every((item) => record(item) && isNotification(item.alert) && count(item.attempts) && count(item.nextAttemptAtMs)) &&
    Array.isArray(value.deliveredFingerprints) && value.deliveredFingerprints.length <= MAX_TRACKED && value.deliveredFingerprints.every((item) => typeof item === "string") &&
    (value.lastCronAtMs === null || count(value.lastCronAtMs))
  );
}

function boundedPush(items: string[], value: string): void {
  items.push(value);
  if (items.length > MAX_TRACKED) items.splice(0, items.length - MAX_TRACKED);
}

function signal(state: AlertCoordinatorState, key: string): AlertSignalState {
  let current = state.signals.find((candidate) => candidate.key === key);
  if (current === undefined) {
    current = { key, active: false, consecutiveFailures: 0, sequence: 0 };
    state.signals.push(current);
  }
  return current;
}

function enqueue(
  state: AlertCoordinatorState,
  alert: AlertNotification,
  useCooldown = false,
): void {
  if (
    state.deliveredFingerprints.includes(alert.fingerprint) ||
    state.outbox.some((item) => item.alert.fingerprint === alert.fingerprint)
  ) return;
  const cooldownKey = `${alert.signalKey}:${alert.phase}`;
  const previous = state.cooldowns.find((item) => item.key === cooldownKey);
  if (useCooldown && previous !== undefined && alert.occurredAtMs - previous.queuedAtMs < ALERT_COOLDOWN_MS) {
    return;
  }
  state.cooldowns = state.cooldowns.filter((item) => item.key !== cooldownKey);
  state.cooldowns.push({ key: cooldownKey, queuedAtMs: alert.occurredAtMs });
  if (state.cooldowns.length > MAX_TRACKED) state.cooldowns.splice(0, state.cooldowns.length - MAX_TRACKED);
  state.outbox.push({ alert, attempts: 0, nextAttemptAtMs: alert.occurredAtMs });
  if (state.outbox.length > 32) state.outbox.splice(0, state.outbox.length - 32);
}

function notification(input: Omit<AlertNotification, "requestId" | "auditId"> & Partial<Pick<AlertNotification, "requestId" | "auditId">>): AlertNotification {
  return { ...input, requestId: input.requestId ?? null, auditId: input.auditId ?? null };
}

function transitionSeverity(to: string): AlertSeverity {
  return to === "normal" ? "recovery" : to === "conservation" || to === "warning" ? "warning" : "error";
}

function observeBrokerTransition(state: AlertCoordinatorState, observation: Extract<AlertObservation, { type: "broker-transition" }>): void {
  const transition = observation.transition;
  if (transition.sequence <= state.lastBrokerTransitionSequence) return;
  state.lastBrokerTransitionSequence = transition.sequence;
  const recovery = transition.to === "normal";
  const phase: AlertPhase = recovery ? "recovery" : "active";
  const threshold = transition.kind === "budget"
    ? transition.to === "conservation" ? "70% of daily request capacity"
      : transition.to === "read-only" ? "90% of daily request capacity"
      : transition.to === "kill-switch" ? "100% of daily request capacity"
      : "UTC daily capacity reset"
    : transition.to === "warning" ? "8 of 10 active flights"
      : transition.to === "full" ? "10 of 10 active flights"
      : "active flights below warning threshold";
  enqueue(state, notification({
    fingerprint: `${transition.kind}:${transition.sequence}:${phase}`,
    signalKey: transition.kind,
    kind: transition.kind,
    phase,
    severity: transitionSeverity(String(transition.to)),
    occurredAtMs: transition.atMs,
    title: transition.kind === "budget"
      ? `Request capacity ${String(transition.from)} to ${String(transition.to)}`
      : `Active flights ${String(transition.from)} to ${String(transition.to)}`,
    threshold,
    action: recovery ? "Normal admission policy restored" : transition.to === "kill-switch" || transition.to === "full" ? "New dynamic work denied" : "Capacity safeguards activated",
    remainingCapacity: observation.remainingCapacity,
  }));
}

function evaluateApiWindow(state: AlertCoordinatorState, atMs: number): void {
  const window = state.apiWindow;
  if (window.total < API_MINIMUM_TOTAL) return;
  const rate = window.failures / window.total;
  if (!window.active && window.failures >= API_MINIMUM_FAILURES && rate >= API_FAILURE_RATE) {
    window.active = true;
    window.sequence += 1;
    enqueue(state, notification({
      fingerprint: `api-health:${window.sequence}:active`, signalKey: "api-health", kind: "api-health", phase: "active", severity: "error", occurredAtMs: atMs,
      title: "Sustained API failures detected", threshold: `at least ${API_MINIMUM_FAILURES} failures and 20% failure rate`, action: "Inspect request logs and bindings", remainingCapacity: null,
    }), true);
  } else if (window.active && rate <= API_RECOVERY_RATE) {
    window.active = false;
    window.sequence += 1;
    enqueue(state, notification({
      fingerprint: `api-health:${window.sequence}:recovery`, signalKey: "api-health", kind: "api-health", phase: "recovery", severity: "recovery", occurredAtMs: atMs,
      title: "API failure rate recovered", threshold: "5% or lower failure rate", action: "Normal monitoring resumed", remainingCapacity: null,
    }), true);
  }
}

function rollApiWindow(state: AlertCoordinatorState, atMs: number): void {
  if (atMs - state.apiWindow.startedAtMs < API_WINDOW_MS) return;
  evaluateApiWindow(state, atMs);
  state.apiWindow.startedAtMs = atMs;
  state.apiWindow.total = 0;
  state.apiWindow.failures = 0;
}

function observeComponent(state: AlertCoordinatorState, key: string, label: string, outcome: "success" | "failure", atMs: number): void {
  const current = signal(state, key);
  if (outcome === "failure") current.consecutiveFailures += 1;
  else current.consecutiveFailures = 0;
  if (!current.active && current.consecutiveFailures >= COMPONENT_FAILURE_COUNT) {
    current.active = true;
    current.sequence += 1;
    enqueue(state, notification({
      fingerprint: `${key}:${current.sequence}:active`, signalKey: key, kind: key === "provider-health" ? "provider-health" : "component-health", phase: "active", severity: "error", occurredAtMs: atMs,
      title: `${label} failures detected`, threshold: `${COMPONENT_FAILURE_COUNT} consecutive failures`, action: "Inspect binding health and recent deploys", remainingCapacity: null,
    }), true);
  } else if (current.active && outcome === "success") {
    current.active = false;
    current.sequence += 1;
    enqueue(state, notification({
      fingerprint: `${key}:${current.sequence}:recovery`, signalKey: key, kind: key === "provider-health" ? "provider-health" : "component-health", phase: "recovery", severity: "recovery", occurredAtMs: atMs,
      title: `${label} recovered`, threshold: "successful health observation", action: "Normal monitoring resumed", remainingCapacity: null,
    }), true);
  }
}

export function observeAlert(state: AlertCoordinatorState, observation: AlertObservation): AlertCoordinatorState {
  switch (observation.type) {
    case "broker-transition":
      observeBrokerTransition(state, observation);
      break;
    case "request-outcome":
      rollApiWindow(state, observation.atMs);
      state.apiWindow.total += 1;
      if (observation.outcome === "failure") state.apiWindow.failures += 1;
      evaluateApiWindow(state, observation.atMs);
      break;
    case "component-outcome":
      observeComponent(state, observation.component === "provider" ? "provider-health" : `component:${observation.component}`, observation.component.toUpperCase(), observation.outcome, observation.atMs);
      break;
    case "provider-staleness": {
      const provider = signal(state, "provider-health");
      if (observation.stale && !provider.active) {
        provider.active = true;
        provider.sequence += 1;
        enqueue(state, notification({
          fingerprint: `provider-health:${provider.sequence}:active`, signalKey: "provider-health", kind: "provider-health", phase: "active", severity: "error", occurredAtMs: observation.atMs,
          title: "ADS-B provider data is stale", threshold: "all cached provider regions stale or unavailable", action: "Traffic remains cache-backed while provider health is investigated", remainingCapacity: null,
        }), true);
      } else if (!observation.stale && provider.active) {
        provider.active = false;
        provider.consecutiveFailures = 0;
        provider.sequence += 1;
        enqueue(state, notification({
          fingerprint: `provider-health:${provider.sequence}:recovery`, signalKey: "provider-health", kind: "provider-health", phase: "recovery", severity: "recovery", occurredAtMs: observation.atMs,
          title: "ADS-B provider data recovered", threshold: "fresh provider cache available", action: "Normal traffic refresh resumed", remainingCapacity: null,
        }), true);
      }
      break;
    }
    case "provider-capacity": {
      const ratio = observation.limit === 0 ? 1 : observation.used / observation.limit;
      const next = ratio >= 1 ? "100" : ratio >= 0.9 ? "90" : ratio >= 0.7 ? "70" : "normal";
      const capacity = state.providerCapacity;
      if (capacity.band !== next) {
        const previous = capacity.band;
        capacity.band = next;
        capacity.sequence += 1;
        const recovery = next === "normal";
        enqueue(state, notification({
          fingerprint: `provider-capacity:${capacity.sequence}:${next}`,
          signalKey: "provider-capacity",
          kind: "provider-capacity",
          phase: recovery ? "recovery" : "active",
          severity: recovery ? "recovery" : next === "70" ? "warning" : "error",
          occurredAtMs: observation.atMs,
          title: `Provider capacity ${previous} to ${next}`,
          threshold: recovery ? "UTC daily provider capacity reset" : `${next}% of daily provider allowance`,
          action: recovery ? "Normal provider refresh resumed" : next === "100" ? "Provider refresh exhausted; cached traffic only" : "Monitor provider usage and traffic cadence",
          remainingCapacity: Math.max(0, observation.limit - observation.used),
        }));
      }
      break;
    }
    case "admin-action":
      if (!state.seenAuditIds.includes(observation.auditId)) {
        boundedPush(state.seenAuditIds, observation.auditId);
        enqueue(state, notification({
          fingerprint: `admin:${observation.auditId}`, signalKey: `admin:${observation.action}`, kind: "admin-action", phase: "active",
          severity: observation.action.includes("kill") || observation.action.includes("terminate") || observation.action.includes("revoke") || observation.action.includes("ban") ? "error" : "warning",
          occurredAtMs: observation.atMs, title: `Administrative action: ${observation.action}`, threshold: "audited control mutation", action: observation.action, remainingCapacity: null,
          requestId: observation.requestId, auditId: observation.auditId,
        }));
      }
      break;
    case "test":
      if (!state.seenAuditIds.includes(observation.auditId)) {
        boundedPush(state.seenAuditIds, observation.auditId);
        enqueue(state, notification({
          fingerprint: `test:${observation.auditId}`, signalKey: "test", kind: "test", phase: "test", severity: "test", occurredAtMs: observation.atMs,
          title: "TEST operational alert", threshold: "manual delivery drill", action: "Confirm receipt and contents", remainingCapacity: null,
          requestId: observation.requestId, auditId: observation.auditId,
        }));
      }
      break;
    case "cron":
      state.lastCronAtMs = observation.atMs;
      rollApiWindow(state, observation.atMs);
      break;
  }
  return state;
}

export function dueAlerts(state: AlertCoordinatorState, nowMs: number): AlertOutboxItem[] {
  return state.outbox.filter((item) => item.nextAttemptAtMs <= nowMs);
}

export function markAlertDelivered(state: AlertCoordinatorState, fingerprint: string): void {
  state.outbox = state.outbox.filter((item) => item.alert.fingerprint !== fingerprint);
  if (!state.deliveredFingerprints.includes(fingerprint)) boundedPush(state.deliveredFingerprints, fingerprint);
}

export function markAlertFailed(state: AlertCoordinatorState, fingerprint: string, nowMs: number): void {
  const item = state.outbox.find((candidate) => candidate.alert.fingerprint === fingerprint);
  if (item === undefined) return;
  item.attempts += 1;
  item.nextAttemptAtMs = nowMs + Math.min(15 * 60 * 1_000, ALERT_RETRY_BASE_MS * 2 ** Math.min(item.attempts - 1, 4));
}
