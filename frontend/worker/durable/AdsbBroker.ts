import { DurableObject } from "cloudflare:workers";

import {
  ACTIVE_FLIGHT_GLOBAL_LIMIT,
  ACTIVE_FLIGHT_LEASE_SECONDS,
  ACTIVE_FLIGHT_RESERVE_PER_LEASE,
  ACTIVE_FLIGHT_WARNING,
  CONSERVATION_THRESHOLD_REQUESTS,
  DAILY_ADMITTED_REQUEST_LIMIT,
  KILL_SWITCH_THRESHOLD_REQUESTS,
  READ_ONLY_THRESHOLD_REQUESTS,
  TRAFFIC_CACHE_MAX_REGIONS,
  TRAFFIC_EXPIRE_SECONDS,
  TRAFFIC_PROVIDER_RADIUS_STEP_NM,
  TRAFFIC_REGION_CELL_DEGREES,
} from "../../src/shared/limits";
import { mostRestrictiveMode, type SystemMode } from "../../src/shared/mode";
import type { Env } from "../env";
import {
  fetchProviderTraffic,
  ProviderConfigurationError,
  ProviderUnavailableError,
  readProviderSettings,
  type ProviderAttemptGate,
  type ProviderSettings,
  type ProviderTraffic,
} from "../adsb/provider";
import { normalizeRegion, type NormalizedRegion } from "../adsb/region";
import {
  cacheMetadataForSuccess,
  isTrafficCacheBody,
  isTrafficCacheMetadata,
  freshness,
  providerPriority,
  retryDelayMs,
  trafficCadenceSeconds,
  trafficData,
  type ProviderPriority,
  type TrafficCacheBody,
  type TrafficCacheMetadata,
  type TrafficRequest,
} from "../adsb/traffic";
import { systemClock, type Clock } from "./clock";
import {
  ADSB_BROKER_COMMAND_PATH,
  parseBrokerCommand,
  type AdmissionDenialReason,
  type AdmissionResult,
  type BrokerCommand,
  type BrokerCommandResult,
  type BrokerAdminSnapshot,
  type BrokerHealthCounters,
  type BrokerResponse,
  type BrokerStatus,
  type BrokerTransition,
  type BudgetBand,
  type FlightCapacityBand,
  type LeaseDenialReason,
  type LeaseResult,
} from "./protocol";

const STATE_KEY = "broker-state:v1";
const TRAFFIC_INDEX_KEY = "traffic-index:v1";
const PROVIDER_GATE_KEY = "provider-gate:v1";
const TRAFFIC_BODY_PREFIX = "traffic-body:v1:";
const CLOCK = Symbol("AdsbBroker.clock");
const TRAFFIC_PROVIDER = Symbol("AdsbBroker.trafficProvider");
const PROVIDER_SETTINGS = Symbol("AdsbBroker.providerSettings");
const SLEEP = Symbol("AdsbBroker.sleep");
const PROVIDER_QUEUE_SNAPSHOT = Symbol("AdsbBroker.providerQueueSnapshot");
const SIGNED_VIEWER_COUNT = Symbol("AdsbBroker.signedViewerCount");
const MAX_COMMAND_BYTES = 8_192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LeaseRecord = {
  userId: string;
  missionId: string;
  expiresAtMs: number;
  reserveRemaining: number;
};

type StoredBrokerState = {
  version: 2;
  utcDay: string;
  admittedRequests: number;
  providerRequests: number;
  automaticMode: SystemMode;
  requestedMode: SystemMode;
  budgetBand: BudgetBand;
  flightCapacityBand: FlightCapacityBand;
  leases: LeaseRecord[];
  health: BrokerHealthCounters;
  transitionSequence: number;
  lastAlertTransition: BrokerTransition | null;
  registrationEnabled: boolean;
  providerCacheOnly: boolean;
};

type StorageView = Pick<
  DurableObjectTransaction,
  "get" | "put" | "delete" | "setAlarm" | "deleteAlarm"
>;

type TrafficFailureRecord = {
  regionKey: string;
  retryAtMs: number;
  expiresAtMs: number;
  lastAccessAtMs: number;
  failureCount: number;
};

type TrafficIndex = {
  version: 1;
  entries: TrafficCacheMetadata[];
  failures: TrafficFailureRecord[];
};

type TrafficCacheSnapshot = {
  metadata: TrafficCacheMetadata | null;
  body: TrafficCacheBody | null;
  retryAtMs: number;
  failureCount: number;
};

type ProviderGateState = { version: 1; nextAttemptAtMs: number };
export type BrokerTrafficProvider = (
  region: NormalizedRegion,
  settings: ProviderSettings,
  gate: ProviderAttemptGate,
  nowMs: () => number,
) => Promise<ProviderTraffic>;
type Sleeper = (milliseconds: number) => Promise<void>;

type ViewerPresence = {
  userId: string;
  missionId: string | null;
  lastSeenAtMs: number;
  audience: "signed" | "active-ghost" | "ambient";
};

type ProviderJob = {
  sequence: number;
  priority: ProviderPriority;
  run: () => Promise<TrafficCacheSnapshot>;
  resolve: (snapshot: TrafficCacheSnapshot) => void;
  reject: (error: unknown) => void;
};

class ProviderAllowanceError extends Error {
  constructor() {
    super("ADS-B provider allowance is unavailable");
    this.name = "ProviderAllowanceError";
  }
}

const defaultTrafficProvider: BrokerTrafficProvider = (region, settings, gate, nowMs) =>
  fetchProviderTraffic(region, settings, gate, {
    fetch: globalThis.fetch.bind(globalThis),
    nowMs,
    setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  });

const systemSleep: Sleeper = (milliseconds) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

function emptyTrafficIndex(): TrafficIndex {
  return { version: 1, entries: [], failures: [] };
}

function isFailureRecord(value: unknown): value is TrafficFailureRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.regionKey === "string" &&
    Number.isSafeInteger(value.retryAtMs) &&
    Number.isSafeInteger(value.expiresAtMs) &&
    Number.isSafeInteger(value.lastAccessAtMs) &&
    Number.isSafeInteger(value.failureCount) &&
    Number(value.failureCount) >= 1
  );
}

function isTrafficIndex(value: unknown): value is TrafficIndex {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    Array.isArray(value.entries) &&
    value.entries.every(isTrafficCacheMetadata) &&
    Array.isArray(value.failures) &&
    value.failures.every(isFailureRecord)
  );
}

async function loadTrafficIndex(storage: StorageView): Promise<TrafficIndex> {
  const stored = await storage.get<unknown>(TRAFFIC_INDEX_KEY);
  if (stored === undefined) return emptyTrafficIndex();
  if (!isTrafficIndex(stored)) throw new Error("Traffic cache index is invalid");
  return stored;
}

function trafficBodyKey(regionKey: string): string {
  return `${TRAFFIC_BODY_PREFIX}${regionKey}`;
}

async function evictExpiredTraffic(
  storage: StorageView,
  index: TrafficIndex,
  nowMs: number,
): Promise<void> {
  const expired = index.entries.filter(({ expiresAtMs }) => expiresAtMs <= nowMs);
  for (const entry of expired) await storage.delete(trafficBodyKey(entry.regionKey));
  if (expired.length > 0) {
    const expiredKeys = new Set(expired.map(({ regionKey }) => regionKey));
    index.entries = index.entries.filter(({ regionKey }) => !expiredKeys.has(regionKey));
  }
  index.failures = index.failures.filter(({ expiresAtMs }) => expiresAtMs > nowMs);
}

function pruneLru(index: TrafficIndex): string[] {
  const removed: string[] = [];
  index.entries.sort((left, right) => right.lastAccessAtMs - left.lastAccessAtMs);
  for (const entry of index.entries.splice(TRAFFIC_CACHE_MAX_REGIONS)) {
    removed.push(entry.regionKey);
  }
  index.failures.sort((left, right) => right.lastAccessAtMs - left.lastAccessAtMs);
  index.failures.splice(TRAFFIC_CACHE_MAX_REGIONS);
  return removed;
}

async function loadProviderGate(storage: StorageView): Promise<ProviderGateState> {
  const stored = await storage.get<unknown>(PROVIDER_GATE_KEY);
  if (stored === undefined) return { version: 1, nextAttemptAtMs: 0 };
  if (
    !isRecord(stored) ||
    stored.version !== 1 ||
    !Number.isSafeInteger(stored.nextAttemptAtMs) ||
    Number(stored.nextAttemptAtMs) < 0
  ) throw new Error("Provider gate state is invalid");
  return stored as ProviderGateState;
}

function zeroHealth(): BrokerHealthCounters {
  return {
    admitted: 0,
    admissionRejected: 0,
    leaseRejected: 0,
    providerCalls: 0,
    providerFailures: 0,
    componentFailures: 0,
  };
}

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function initialState(nowMs: number): StoredBrokerState {
  return {
    version: 2,
    utcDay: utcDay(nowMs),
    admittedRequests: 0,
    providerRequests: 0,
    automaticMode: "NORMAL",
    requestedMode: "NORMAL",
    budgetBand: "normal",
    flightCapacityBand: "normal",
    leases: [],
    health: zeroHealth(),
    transitionSequence: 0,
    lastAlertTransition: null,
    registrationEnabled: true,
    providerCacheOnly: false,
  };
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStoredTransition(value: unknown): value is BrokerTransition {
  if (!isRecord(value)) return false;
  const budgetBands = ["normal", "conservation", "read-only", "kill-switch"];
  const flightBands = ["normal", "warning", "full"];
  const from = String(value.from);
  const to = String(value.to);
  const bandsMatch = value.kind === "budget"
    ? budgetBands.includes(from) && budgetBands.includes(to)
    : value.kind === "flight-capacity"
      ? flightBands.includes(from) && flightBands.includes(to)
      : false;
  return (
    isSafeCount(value.sequence) &&
    isSafeCount(value.atMs) &&
    bandsMatch
  );
}

function isStoredState(value: unknown): value is StoredBrokerState {
  if (!isRecord(value)) return false;
  const state = value as Partial<StoredBrokerState>;
  const leases = state.leases;
  const health = state.health;
  if (!Array.isArray(leases) || !isRecord(health)) return false;
  const validLeases = leases.every(
    (lease) =>
      isRecord(lease) &&
      typeof lease.userId === "string" &&
      UUID.test(lease.userId) &&
      typeof lease.missionId === "string" &&
      UUID.test(lease.missionId) &&
      isSafeCount(lease.expiresAtMs) &&
      isSafeCount(lease.reserveRemaining) &&
      lease.reserveRemaining <= ACTIVE_FLIGHT_RESERVE_PER_LEASE,
  );
  const uniqueUsers = new Set(leases.map((lease) => lease.userId)).size === leases.length;
  const uniqueMissions = new Set(leases.map((lease) => lease.missionId)).size === leases.length;
  const totalReserve = leases.reduce(
    (total, lease) => total + Number(lease.reserveRemaining),
    0,
  );
  const healthKeys = [
    "admitted",
    "admissionRejected",
    "leaseRejected",
    "providerCalls",
    "providerFailures",
    "componentFailures",
  ] as const;
  const validHealth =
    Object.keys(health).length === healthKeys.length &&
    healthKeys.every((key) => isSafeCount(health[key]));
  const validTransition =
    state.lastAlertTransition === null ||
    (isStoredTransition(state.lastAlertTransition) &&
      isSafeCount(state.transitionSequence) &&
      state.lastAlertTransition.sequence <= state.transitionSequence);
  return (
    state.version === 2 &&
    typeof state.utcDay === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(state.utcDay) &&
    isSafeCount(state.admittedRequests) &&
    state.admittedRequests <= DAILY_ADMITTED_REQUEST_LIMIT &&
    isSafeCount(state.providerRequests) &&
    ["NORMAL", "READ_ONLY", "KILL_SWITCH"].includes(String(state.automaticMode)) &&
    ["NORMAL", "READ_ONLY", "KILL_SWITCH"].includes(String(state.requestedMode)) &&
    ["normal", "conservation", "read-only", "kill-switch"].includes(
      String(state.budgetBand),
    ) &&
    state.budgetBand === budgetBandFor(state.admittedRequests) &&
    state.automaticMode === automaticModeFor(state.admittedRequests) &&
    ["normal", "warning", "full"].includes(String(state.flightCapacityBand)) &&
    leases.length <= ACTIVE_FLIGHT_GLOBAL_LIMIT &&
    validLeases &&
    uniqueUsers &&
    uniqueMissions &&
    totalReserve <= ACTIVE_FLIGHT_GLOBAL_LIMIT * ACTIVE_FLIGHT_RESERVE_PER_LEASE &&
    (state.admittedRequests >= READ_ONLY_THRESHOLD_REQUESTS || totalReserve === 0) &&
    state.flightCapacityBand === flightCapacityBandFor(leases.length) &&
    validHealth &&
    typeof state.registrationEnabled === "boolean" &&
    typeof state.providerCacheOnly === "boolean" &&
    isSafeCount(state.transitionSequence) &&
    validTransition
  );
}

function migrateStoredState(value: unknown): StoredBrokerState | null {
  const candidate = isRecord(value) && value.version === 1
    ? {
        ...value,
        version: 2,
        registrationEnabled: true,
        providerCacheOnly: false,
      }
    : value;
  return isStoredState(candidate) ? candidate : null;
}

function budgetBandFor(count: number): BudgetBand {
  if (count >= KILL_SWITCH_THRESHOLD_REQUESTS) return "kill-switch";
  if (count >= READ_ONLY_THRESHOLD_REQUESTS) return "read-only";
  if (count >= CONSERVATION_THRESHOLD_REQUESTS) return "conservation";
  return "normal";
}

function automaticModeFor(count: number): SystemMode {
  if (count >= KILL_SWITCH_THRESHOLD_REQUESTS) return "KILL_SWITCH";
  if (count >= READ_ONLY_THRESHOLD_REQUESTS) return "READ_ONLY";
  return "NORMAL";
}

function flightCapacityBandFor(count: number): FlightCapacityBand {
  if (count >= ACTIVE_FLIGHT_GLOBAL_LIMIT) return "full";
  if (count >= ACTIVE_FLIGHT_WARNING) return "warning";
  return "normal";
}

function recordTransition(
  state: StoredBrokerState,
  kind: BrokerTransition["kind"],
  from: BrokerTransition["from"],
  to: BrokerTransition["to"],
  nowMs: number,
): void {
  if (from === to) return;
  state.transitionSequence += 1;
  state.lastAlertTransition = {
    sequence: state.transitionSequence,
    kind,
    from,
    to,
    atMs: nowMs,
  };
}

function updateFlightCapacityBand(state: StoredBrokerState, nowMs: number): void {
  const next = flightCapacityBandFor(state.leases.length);
  recordTransition(state, "flight-capacity", state.flightCapacityBand, next, nowMs);
  state.flightCapacityBand = next;
}

function updateBudgetBand(state: StoredBrokerState, nowMs: number): void {
  const previous = state.budgetBand;
  const next = budgetBandFor(state.admittedRequests);
  if (previous !== "read-only" && next === "read-only") {
    for (const lease of state.leases) {
      lease.reserveRemaining = ACTIVE_FLIGHT_RESERVE_PER_LEASE;
    }
  }
  recordTransition(state, "budget", previous, next, nowMs);
  state.budgetBand = next;
  state.automaticMode = automaticModeFor(state.admittedRequests);
}

function rollover(state: StoredBrokerState, nowMs: number): void {
  const day = utcDay(nowMs);
  if (state.utcDay === day) return;
  const previousBand = state.budgetBand;
  state.utcDay = day;
  state.admittedRequests = 0;
  state.providerRequests = 0;
  state.automaticMode = "NORMAL";
  state.budgetBand = "normal";
  state.health.admitted = 0;
  for (const lease of state.leases) lease.reserveRemaining = 0;
  recordTransition(state, "budget", previousBand, "normal", nowMs);
}

function cleanExpiredLeases(state: StoredBrokerState, nowMs: number): void {
  const active = state.leases.filter((lease) => lease.expiresAtMs > nowMs);
  if (active.length === state.leases.length) return;
  state.leases = active;
  updateFlightCapacityBand(state, nowMs);
}

function reserveRemaining(state: StoredBrokerState): number {
  return state.leases.reduce((total, lease) => total + lease.reserveRemaining, 0);
}

function status(state: StoredBrokerState, forceMode: SystemMode): BrokerStatus {
  return {
    utcDay: state.utcDay,
    admittedRequests: state.admittedRequests,
    providerRequests: state.providerRequests,
    automaticMode: state.automaticMode,
    requestedMode: state.requestedMode,
    effectiveMode: mostRestrictiveMode(forceMode, state.requestedMode, state.automaticMode),
    budgetBand: state.budgetBand,
    activeFlights: state.leases.length,
    flightCapacityBand: state.flightCapacityBand,
    protectedReserveRemaining: reserveRemaining(state),
    health: { ...state.health },
    lastAlertTransition: state.lastAlertTransition,
    registrationEnabled: state.registrationEnabled,
    providerCacheOnly: state.providerCacheOnly,
  };
}

async function loadState(storage: StorageView, nowMs: number): Promise<StoredBrokerState> {
  const stored = await storage.get<unknown>(STATE_KEY);
  if (stored === undefined) return initialState(nowMs);
  const migrated = migrateStoredState(stored);
  if (migrated === null) throw new Error("Broker storage is invalid");
  return migrated;
}

async function scheduleNextExpiry(storage: StorageView, state: StoredBrokerState): Promise<void> {
  const leaseExpiry = state.leases.reduce<number | null>(
    (current, lease) => current === null || lease.expiresAtMs < current ? lease.expiresAtMs : current,
    null,
  );
  const index = await loadTrafficIndex(storage);
  const trafficExpiry = [...index.entries, ...index.failures].reduce<number | null>(
    (current, entry) =>
      current === null || entry.expiresAtMs < current ? entry.expiresAtMs : current,
    null,
  );
  const earliest = leaseExpiry === null
    ? trafficExpiry
    : trafficExpiry === null
      ? leaseExpiry
      : Math.min(leaseExpiry, trafficExpiry);
  if (earliest === null) await storage.deleteAlarm();
  else await storage.setAlarm(earliest);
}

function findLease(
  state: StoredBrokerState,
  userId: string,
  missionId: string,
): LeaseRecord | undefined {
  return state.leases.find(
    (lease) => lease.userId === userId && lease.missionId === missionId,
  );
}

function rejectAdmission(
  state: StoredBrokerState,
  forceMode: SystemMode,
  reason: AdmissionDenialReason,
): AdmissionResult {
  state.health.admissionRejected += 1;
  return { type: "admission", allowed: false, reason, status: status(state, forceMode) };
}

function rejectLease(
  state: StoredBrokerState,
  forceMode: SystemMode,
  reason: LeaseDenialReason,
): LeaseResult {
  state.health.leaseRejected += 1;
  return { type: "lease", allowed: false, reason, status: status(state, forceMode) };
}

function admit(
  state: StoredBrokerState,
  command: Extract<BrokerCommand, { type: "admit" }>,
  nowMs: number,
): AdmissionResult {
  const effectiveMode = mostRestrictiveMode(
    command.forceMode,
    state.requestedMode,
    state.automaticMode,
  );
  if (effectiveMode === "KILL_SWITCH") {
    return rejectAdmission(state, command.forceMode, "kill-switch");
  }
  if (
    (command.kind === "public-write" || command.kind === "registration") &&
    effectiveMode === "READ_ONLY"
  ) {
    return rejectAdmission(state, command.forceMode, "read-only");
  }
  if (command.kind === "registration" && !state.registrationEnabled) {
    return rejectAdmission(state, command.forceMode, "registration-disabled");
  }

  const lease = command.kind === "active-flight"
    ? findLease(state, command.userId, command.missionId)
    : undefined;
  if (command.kind === "active-flight" && lease === undefined) {
    return rejectAdmission(state, command.forceMode, "lease-required");
  }
  if (state.admittedRequests >= DAILY_ADMITTED_REQUEST_LIMIT) {
    return rejectAdmission(state, command.forceMode, "daily-limit");
  }

  const remaining = reserveRemaining(state);
  const generalCeiling = DAILY_ADMITTED_REQUEST_LIMIT - remaining;
  const usingProtectedCapacity =
    state.budgetBand === "read-only" && state.admittedRequests >= generalCeiling;
  if (usingProtectedCapacity && command.kind !== "active-flight") {
    return rejectAdmission(state, command.forceMode, "protected-reserve");
  }
  if (usingProtectedCapacity && lease?.reserveRemaining === 0) {
    return rejectAdmission(state, command.forceMode, "lease-reserve-exhausted");
  }

  if (usingProtectedCapacity && lease !== undefined) lease.reserveRemaining -= 1;
  if (lease !== undefined) lease.expiresAtMs = nowMs + ACTIVE_FLIGHT_LEASE_SECONDS * 1_000;
  state.admittedRequests += 1;
  state.health.admitted += 1;
  updateBudgetBand(state, nowMs);
  return { type: "admission", allowed: true, status: status(state, command.forceMode) };
}

function mutateLease(
  state: StoredBrokerState,
  command: Extract<BrokerCommand, { type: "lease-acquire" | "lease-renew" }>,
  nowMs: number,
): LeaseResult {
  const effectiveMode = mostRestrictiveMode(
    command.forceMode,
    state.requestedMode,
    state.automaticMode,
  );
  if (effectiveMode === "KILL_SWITCH") return rejectLease(state, command.forceMode, "kill-switch");
  if (effectiveMode === "READ_ONLY") return rejectLease(state, command.forceMode, "read-only");

  const existing = findLease(state, command.userId, command.missionId);
  if (existing !== undefined) {
    existing.expiresAtMs = nowMs + ACTIVE_FLIGHT_LEASE_SECONDS * 1_000;
    return {
      type: "lease",
      allowed: true,
      lease: { ...existing },
      status: status(state, command.forceMode),
    };
  }
  if (command.type === "lease-renew") return rejectLease(state, command.forceMode, "not-found");
  if (state.leases.some((lease) => lease.userId === command.userId)) {
    return rejectLease(state, command.forceMode, "user-limit");
  }
  if (state.leases.length >= ACTIVE_FLIGHT_GLOBAL_LIMIT) {
    return rejectLease(state, command.forceMode, "global-limit");
  }

  const lease: LeaseRecord = {
    userId: command.userId,
    missionId: command.missionId,
    expiresAtMs: nowMs + ACTIVE_FLIGHT_LEASE_SECONDS * 1_000,
    reserveRemaining: 0,
  };
  state.leases.push(lease);
  updateFlightCapacityBand(state, nowMs);
  return {
    type: "lease",
    allowed: true,
    lease: { ...lease },
    status: status(state, command.forceMode),
  };
}

function executeCommand(
  state: StoredBrokerState,
  command: BrokerCommand,
  nowMs: number,
): BrokerCommandResult {
  switch (command.type) {
    case "traffic":
      throw new TypeError("Traffic commands require the asynchronous broker path");
    case "admin-snapshot":
      throw new TypeError("Administrative snapshots require the asynchronous broker path");
    case "admit":
      return admit(state, command, nowMs);
    case "lease-acquire":
    case "lease-renew":
      return mutateLease(state, command, nowMs);
    case "lease-release": {
      const lease = findLease(state, command.userId, command.missionId);
      if (lease === undefined) return rejectLease(state, "NORMAL", "not-found");
      state.leases = state.leases.filter((candidate) => candidate !== lease);
      updateFlightCapacityBand(state, nowMs);
      return { type: "lease", allowed: true, lease: { ...lease }, status: status(state, "NORMAL") };
    }
    case "lease-release-user": {
      const before = state.leases.length;
      state.leases = state.leases.filter((lease) => lease.userId !== command.userId);
      if (state.leases.length === before) return rejectLease(state, "NORMAL", "not-found");
      updateFlightCapacityBand(state, nowMs);
      return { type: "lease", allowed: true, status: status(state, "NORMAL") };
    }
    case "mode-set":
      state.requestedMode = command.requestedMode;
      return { type: "status", status: status(state, command.forceMode) };
    case "settings-set":
      state.registrationEnabled = command.registrationEnabled;
      state.providerCacheOnly = command.providerCacheOnly;
      return { type: "status", status: status(state, command.forceMode) };
    case "cache-clear-region":
      throw new TypeError("Cache clear commands require the asynchronous broker path");
    case "status":
      return { type: "status", status: status(state, command.forceMode) };
    case "transitions":
      return {
        type: "transition",
        transition: state.lastAlertTransition,
        status: status(state, command.forceMode),
      };
    case "provider-record":
      state.providerRequests += 1;
      state.health.providerCalls += 1;
      if (command.outcome === "failure") state.health.providerFailures += 1;
      return { type: "recorded", status: status(state, "NORMAL") };
    case "health-record":
      if (command.outcome === "failure") state.health.componentFailures += 1;
      return { type: "recorded", status: status(state, "NORMAL") };
    case "recover":
      state.health = zeroHealth();
      return { type: "status", status: status(state, command.forceMode) };
  }
}

function json(body: BrokerResponse, statusCode: number, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

async function readCommand(request: Request): Promise<BrokerCommand> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new TypeError("Invalid broker command");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_COMMAND_BYTES) {
    throw new TypeError("Invalid broker command");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TypeError("Invalid broker command");
  }
  return parseBrokerCommand(value);
}

async function readTrafficSnapshot(
  storage: DurableObjectStorage,
  regionKey: string,
  nowMs: number,
): Promise<TrafficCacheSnapshot> {
  return storage.transaction(async (transaction) => {
    const state = await loadState(transaction, nowMs);
    rollover(state, nowMs);
    cleanExpiredLeases(state, nowMs);
    const index = await loadTrafficIndex(transaction);
    await evictExpiredTraffic(transaction, index, nowMs);
    const metadata = index.entries.find((entry) => entry.regionKey === regionKey) ?? null;
    const failure = index.failures.find((entry) => entry.regionKey === regionKey) ?? null;
    let body: TrafficCacheBody | null = null;
    if (metadata !== null) {
      const storedBody = await transaction.get<unknown>(trafficBodyKey(regionKey));
      if (isTrafficCacheBody(storedBody)) {
        body = storedBody;
        metadata.lastAccessAtMs = nowMs;
      } else {
        index.entries = index.entries.filter((entry) => entry !== metadata);
        await transaction.delete(trafficBodyKey(regionKey));
      }
    }
    if (failure !== null) failure.lastAccessAtMs = nowMs;
    await transaction.put(STATE_KEY, state);
    await transaction.put(TRAFFIC_INDEX_KEY, index);
    await scheduleNextExpiry(transaction, state);
    return {
      metadata: body === null ? null : metadata,
      body,
      retryAtMs: metadata?.retryAtMs ?? failure?.retryAtMs ?? 0,
      failureCount: metadata?.failureCount ?? failure?.failureCount ?? 0,
    };
  });
}

async function persistTrafficSuccess(
  storage: DurableObjectStorage,
  regionKey: string,
  result: ProviderTraffic,
  nowMs: number,
): Promise<TrafficCacheSnapshot> {
  return storage.transaction(async (transaction) => {
    const state = await loadState(transaction, nowMs);
    rollover(state, nowMs);
    cleanExpiredLeases(state, nowMs);
    const index = await loadTrafficIndex(transaction);
    await evictExpiredTraffic(transaction, index, nowMs);
    const metadata = cacheMetadataForSuccess(regionKey, result, nowMs);
    index.entries = index.entries.filter((entry) => entry.regionKey !== regionKey);
    index.entries.push(metadata);
    index.failures = index.failures.filter((entry) => entry.regionKey !== regionKey);
    const body: TrafficCacheBody = { version: 1, contacts: result.contacts };
    await transaction.put(trafficBodyKey(regionKey), body);
    for (const removed of pruneLru(index)) {
      await transaction.delete(trafficBodyKey(removed));
    }
    await transaction.put(STATE_KEY, state);
    await transaction.put(TRAFFIC_INDEX_KEY, index);
    await scheduleNextExpiry(transaction, state);
    return { metadata, body, retryAtMs: 0, failureCount: 0 };
  });
}

async function persistTrafficFailure(
  storage: DurableObjectStorage,
  regionKey: string,
  nowMs: number,
): Promise<TrafficCacheSnapshot> {
  return storage.transaction(async (transaction) => {
    const state = await loadState(transaction, nowMs);
    rollover(state, nowMs);
    cleanExpiredLeases(state, nowMs);
    const index = await loadTrafficIndex(transaction);
    await evictExpiredTraffic(transaction, index, nowMs);
    const metadata = index.entries.find((entry) => entry.regionKey === regionKey) ?? null;
    const oldFailure = index.failures.find((entry) => entry.regionKey === regionKey) ?? null;
    const failureCount = (metadata?.failureCount ?? oldFailure?.failureCount ?? 0) + 1;
    const retryAtMs = nowMs + retryDelayMs(failureCount);
    let body: TrafficCacheBody | null = null;

    if (metadata !== null) {
      const storedBody = await transaction.get<unknown>(trafficBodyKey(regionKey));
      if (isTrafficCacheBody(storedBody)) {
        body = storedBody;
        metadata.providerAvailable = false;
        metadata.failureCount = failureCount;
        metadata.retryAtMs = retryAtMs;
        metadata.lastAccessAtMs = nowMs;
      } else {
        index.entries = index.entries.filter((entry) => entry !== metadata);
        await transaction.delete(trafficBodyKey(regionKey));
      }
    }

    index.failures = index.failures.filter((entry) => entry.regionKey !== regionKey);
    if (body === null) {
      index.failures.push({
        regionKey,
        retryAtMs,
        expiresAtMs: nowMs + TRAFFIC_EXPIRE_SECONDS * 1_000,
        lastAccessAtMs: nowMs,
        failureCount,
      });
    }
    for (const removed of pruneLru(index)) {
      await transaction.delete(trafficBodyKey(removed));
    }
    await transaction.put(STATE_KEY, state);
    await transaction.put(TRAFFIC_INDEX_KEY, index);
    await scheduleNextExpiry(transaction, state);
    return {
      metadata: body === null ? null : metadata,
      body,
      retryAtMs,
      failureCount,
    };
  });
}

async function readBrokerStatus(
  storage: DurableObjectStorage,
  nowMs: number,
  forceMode: SystemMode,
): Promise<BrokerStatus> {
  return storage.transaction(async (transaction) => {
    const state = await loadState(transaction, nowMs);
    rollover(state, nowMs);
    cleanExpiredLeases(state, nowMs);
    await transaction.put(STATE_KEY, state);
    await scheduleNextExpiry(transaction, state);
    return status(state, forceMode);
  });
}

export class AdsbBroker extends DurableObject<Env> {
  [CLOCK]: Clock = systemClock;
  [TRAFFIC_PROVIDER]: BrokerTrafficProvider = defaultTrafficProvider;
  [PROVIDER_SETTINGS]: ProviderSettings | null = null;
  [SLEEP]: Sleeper = systemSleep;

  readonly #trafficInFlight = new Map<string, Promise<TrafficCacheSnapshot>>();
  readonly #providerQueue: ProviderJob[] = [];
  readonly #signedViewers = new Map<string, Map<string, ViewerPresence>>();
  #providerSequence = 0;
  #providerDraining = false;
  #providerRunningPriority: ProviderPriority | null = null;

  [PROVIDER_QUEUE_SNAPSHOT](): ProviderPriority[] {
    return this.#providerQueue.map(({ priority }) => priority);
  }

  [SIGNED_VIEWER_COUNT](): number {
    let count = 0;
    for (const viewers of this.#signedViewers.values()) count += viewers.size;
    return count;
  }

  #settings(): ProviderSettings {
    return this[PROVIDER_SETTINGS] ?? readProviderSettings(this.env);
  }

  #signedViewerCount(regionKey: string, request: TrafficRequest, nowMs: number): number {
    const viewers = this.#signedViewers.get(regionKey) ?? new Map<string, ViewerPresence>();
    for (const [userId, presence] of viewers) {
      if (nowMs - presence.lastSeenAtMs > 45_000) viewers.delete(userId);
    }
    if (request.audience.kind !== "anonymous") {
      viewers.set(request.audience.userId, {
        userId: request.audience.userId,
        missionId: request.audience.kind === "signed" ? null : request.audience.missionId,
        lastSeenAtMs: nowMs,
        audience: request.audience.kind,
      });
    }
    if (viewers.size === 0) this.#signedViewers.delete(regionKey);
    else this.#signedViewers.set(regionKey, viewers);
    return viewers.size;
  }

  #prunePresence(nowMs: number): void {
    for (const [regionKey, viewers] of this.#signedViewers) {
      for (const [userId, presence] of viewers) {
        if (nowMs - presence.lastSeenAtMs > 45_000) viewers.delete(userId);
      }
      if (viewers.size === 0) this.#signedViewers.delete(regionKey);
    }
  }

  async #adminSnapshot(forceMode: SystemMode): Promise<BrokerCommandResult> {
    const nowMs = this[CLOCK].nowMs();
    this.#prunePresence(nowMs);
    return this.ctx.storage.transaction(async (transaction) => {
      const state = await loadState(transaction, nowMs);
      rollover(state, nowMs);
      cleanExpiredLeases(state, nowMs);
      const index = await loadTrafficIndex(transaction);
      await evictExpiredTraffic(transaction, index, nowMs);
      const brokerStatus = status(state, forceMode);
      const viewerCounts = new Map(
        [...this.#signedViewers].map(([regionKey, viewers]) => [regionKey, viewers.size]),
      );
      const failureByRegion = new Map(index.failures.map((failure) => [failure.regionKey, failure]));
      const cacheRegionKeys = new Set([
        ...index.entries.map(({ regionKey }) => regionKey),
        ...index.failures.map(({ regionKey }) => regionKey),
      ]);
      const cacheRegions: BrokerAdminSnapshot["cacheRegions"] = [...cacheRegionKeys]
        .map((regionKey) => {
          const metadata = index.entries.find((entry) => entry.regionKey === regionKey);
          const failure = failureByRegion.get(regionKey);
          return {
            regionKey,
            fetchedAtMs: metadata === undefined ? null : metadata.fetchedAt * 1_000,
            expiresAtMs: metadata?.expiresAtMs ?? failure?.expiresAtMs ?? nowMs,
            lastAccessAtMs: metadata?.lastAccessAtMs ?? failure?.lastAccessAtMs ?? nowMs,
            providerAvailable: metadata?.providerAvailable ?? false,
            failureCount: metadata?.failureCount ?? failure?.failureCount ?? 0,
            retryAtMs: metadata?.retryAtMs ?? failure?.retryAtMs ?? 0,
            viewerCount: viewerCounts.get(regionKey) ?? 0,
          };
        })
        .sort((left, right) => right.lastAccessAtMs - left.lastAccessAtMs)
        .slice(0, TRAFFIC_CACHE_MAX_REGIONS);
      const presence: BrokerAdminSnapshot["presence"] = [];
      for (const [regionKey, viewers] of this.#signedViewers) {
        for (const viewer of viewers.values()) presence.push({ ...viewer, regionKey });
      }
      presence.sort((left, right) => right.lastSeenAtMs - left.lastSeenAtMs);
      const queuedByPriority: [number, number, number, number] = [0, 0, 0, 0];
      for (const { priority } of this.#providerQueue) queuedByPriority[priority] += 1;
      const snapshot: BrokerAdminSnapshot = {
        capturedAtMs: nowMs,
        status: brokerStatus,
        leases: state.leases.map((lease) => ({ ...lease })),
        cacheRegions,
        presence: presence.slice(0, 200),
        providerWork: {
          queuedByPriority,
          inFlightRegions: this.#trafficInFlight.size,
          runningPriority: this.#providerRunningPriority,
        },
      };
      await transaction.put(STATE_KEY, state);
      await transaction.put(TRAFFIC_INDEX_KEY, index);
      await scheduleNextExpiry(transaction, state);
      return { type: "admin-snapshot", snapshot, status: brokerStatus };
    });
  }

  #enqueueProvider(
    priority: ProviderPriority,
    run: () => Promise<TrafficCacheSnapshot>,
  ): Promise<TrafficCacheSnapshot> {
    if (
      priority === 3 &&
      this.#providerRunningPriority !== null &&
      this.#providerRunningPriority < priority
    ) return Promise.reject(new ProviderAllowanceError());
    const promise = new Promise<TrafficCacheSnapshot>((resolve, reject) => {
      this.#providerQueue.push({
        sequence: this.#providerSequence++,
        priority,
        run,
        resolve,
        reject,
      });
    });
    if (!this.#providerDraining) {
      this.#providerDraining = true;
      queueMicrotask(() => void this.#drainProviderQueue());
    }
    return promise;
  }

  async #drainProviderQueue(): Promise<void> {
    try {
      while (this.#providerQueue.length > 0) {
        this.#providerQueue.sort(
          (left, right) => left.priority - right.priority || left.sequence - right.sequence,
        );
        const job = this.#providerQueue.shift();
        if (job === undefined) continue;
        // Ambient traffic is the first feature shed under active contention.
        if (
          job.priority === 3 &&
          this.#providerQueue.some((candidate) => candidate.priority < job.priority)
        ) {
          job.reject(new ProviderAllowanceError());
          continue;
        }
        this.#providerRunningPriority = job.priority;
        try {
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        } finally {
          this.#providerRunningPriority = null;
        }
      }
    } finally {
      this.#providerDraining = false;
      if (this.#providerQueue.length > 0) {
        this.#providerDraining = true;
        queueMicrotask(() => void this.#drainProviderQueue());
      }
    }
  }

  async #claimProviderAttempt(
    settings: ProviderSettings,
    priority: ProviderPriority,
  ): Promise<void> {
    while (true) {
      if (
        priority === 3 &&
        this.#providerQueue.some((candidate) => candidate.priority < priority)
      ) throw new ProviderAllowanceError();

      const nowMs = this[CLOCK].nowMs();
      const waitMs = await this.ctx.storage.transaction(async (transaction) => {
        const state = await loadState(transaction, nowMs);
        rollover(state, nowMs);
        cleanExpiredLeases(state, nowMs);
        if (state.providerRequests >= settings.dailyLimit) throw new ProviderAllowanceError();
        const gate = await loadProviderGate(transaction);
        const wait = Math.max(0, gate.nextAttemptAtMs - nowMs);
        if (wait === 0) {
          state.providerRequests += 1;
          state.health.providerCalls += 1;
          gate.nextAttemptAtMs = nowMs + settings.minimumIntervalMs;
          await transaction.put(PROVIDER_GATE_KEY, gate);
        }
        await transaction.put(STATE_KEY, state);
        await scheduleNextExpiry(transaction, state);
        return wait;
      });
      if (waitMs === 0) return;
      await this[SLEEP](waitMs);
    }
  }

  async #recordProviderFailure(): Promise<void> {
    const nowMs = this[CLOCK].nowMs();
    await this.ctx.storage.transaction(async (transaction) => {
      const state = await loadState(transaction, nowMs);
      rollover(state, nowMs);
      cleanExpiredLeases(state, nowMs);
      state.health.providerFailures += 1;
      await transaction.put(STATE_KEY, state);
      await scheduleNextExpiry(transaction, state);
    });
  }

  async #refreshTrafficRegion(
    region: NormalizedRegion,
    settings: ProviderSettings,
    priority: ProviderPriority,
  ): Promise<TrafficCacheSnapshot> {
    try {
      return await this.#enqueueProvider(priority, async () => {
        const result = await this[TRAFFIC_PROVIDER](
          region,
          settings,
          {
            beforeAttempt: () => this.#claimProviderAttempt(settings, priority),
            attemptFailed: () => this.#recordProviderFailure(),
          },
          () => this[CLOCK].nowMs(),
        );
        return persistTrafficSuccess(
          this.ctx.storage,
          region.regionKey,
          result,
          this[CLOCK].nowMs(),
        );
      });
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        console.error("adsb_provider_refresh_failed", { failures: error.failures });
      }
      return persistTrafficFailure(
        this.ctx.storage,
        region.regionKey,
        this[CLOCK].nowMs(),
      );
    }
  }

  async #traffic(request: TrafficRequest, forceMode: SystemMode): Promise<BrokerCommandResult> {
    const settings = this.#settings();
    const region = normalizeRegion(request.latitude, request.longitude, request.radiusNm, {
      cellDegrees: TRAFFIC_REGION_CELL_DEGREES,
      providerRadiusStepNm: TRAFFIC_PROVIDER_RADIUS_STEP_NM,
      providerMaxRadiusNm: settings.maximumRadiusNm,
    });
    const nowMs = this[CLOCK].nowMs();
    const signedViewers = this.#signedViewerCount(region.regionKey, request, nowMs);
    const brokerStatus = await readBrokerStatus(this.ctx.storage, nowMs, forceMode);
    const nextRefreshSeconds = trafficCadenceSeconds(request.audience, brokerStatus.budgetBand);
    const cached = await readTrafficSnapshot(this.ctx.storage, region.regionKey, nowMs);
    if (freshness(cached.metadata, nowMs) === "FRESH") {
      return {
        type: "traffic",
        traffic: trafficData(
          region,
          cached.metadata,
          cached.body,
          nowMs,
          nextRefreshSeconds,
          "HIT",
        ),
        status: brokerStatus,
      };
    }
    const cacheOnly = brokerStatus.providerCacheOnly ||
      brokerStatus.effectiveMode !== "NORMAL" && request.audience.kind !== "active-ghost";
    if (cacheOnly) {
      return {
        type: "traffic",
        traffic: trafficData(
          region,
          cached.metadata,
          cached.body,
          nowMs,
          nextRefreshSeconds,
          cached.metadata === null ? "EXPIRED" : "STALE",
        ),
        status: brokerStatus,
      };
    }
    if (nowMs < cached.retryAtMs) {
      return {
        type: "traffic",
        traffic: trafficData(
          region,
          cached.metadata,
          cached.body,
          nowMs,
          nextRefreshSeconds,
          "STALE",
        ),
        status: brokerStatus,
      };
    }

    const existing = this.#trafficInFlight.get(region.regionKey);
    if (existing !== undefined) {
      const shared = await existing;
      const responseNow = this[CLOCK].nowMs();
      return {
        type: "traffic",
        traffic: trafficData(
          region,
          shared.metadata,
          shared.body,
          responseNow,
          nextRefreshSeconds,
          "COALESCED",
        ),
        status: await readBrokerStatus(this.ctx.storage, responseNow, forceMode),
      };
    }

    const priority = providerPriority(request.audience, signedViewers);
    const pending = this.#refreshTrafficRegion(region, settings, priority);
    this.#trafficInFlight.set(region.regionKey, pending);
    try {
      const refreshed = await pending;
      const responseNow = this[CLOCK].nowMs();
      return {
        type: "traffic",
        traffic: trafficData(
          region,
          refreshed.metadata,
          refreshed.body,
          responseNow,
          nextRefreshSeconds,
          "MISS",
        ),
        status: await readBrokerStatus(this.ctx.storage, responseNow, forceMode),
      };
    } finally {
      if (this.#trafficInFlight.get(region.regionKey) === pending) {
        this.#trafficInFlight.delete(region.regionKey);
      }
    }
  }

  async #clearTrafficRegion(
    regionKey: string,
    forceMode: SystemMode,
  ): Promise<BrokerCommandResult> {
    const pending = this.#trafficInFlight.get(regionKey);
    if (pending !== undefined) await pending.catch(() => undefined);
    const nowMs = this[CLOCK].nowMs();
    return this.ctx.storage.transaction(async (transaction) => {
      const state = await loadState(transaction, nowMs);
      rollover(state, nowMs);
      cleanExpiredLeases(state, nowMs);
      const index = await loadTrafficIndex(transaction);
      const entryCount = index.entries.length;
      const failureCount = index.failures.length;
      index.entries = index.entries.filter((entry) => entry.regionKey !== regionKey);
      index.failures = index.failures.filter((entry) => entry.regionKey !== regionKey);
      await transaction.delete(trafficBodyKey(regionKey));
      await transaction.put(STATE_KEY, state);
      await transaction.put(TRAFFIC_INDEX_KEY, index);
      await scheduleNextExpiry(transaction, state);
      return {
        type: "cache-cleared",
        regionKey,
        cleared: entryCount !== index.entries.length || failureCount !== index.failures.length,
        status: status(state, forceMode),
      };
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== ADSB_BROKER_COMMAND_PATH) {
      return json(
        { ok: false, error: { code: "NOT_FOUND", message: "Broker command not found" } },
        404,
      );
    }
    if (request.method !== "POST") {
      return json(
        { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } },
        405,
        { allow: "POST" },
      );
    }

    let command: BrokerCommand;
    try {
      command = await readCommand(request);
    } catch (error) {
      if (error instanceof TypeError) {
        return json(
          { ok: false, error: { code: "INVALID_COMMAND", message: "Invalid broker command" } },
          400,
        );
      }
      return json(
        { ok: false, error: { code: "INTERNAL_ERROR", message: "Broker command failed" } },
        500,
      );
    }

    try {
      if (command.type === "traffic") {
        const result = await this.#traffic(command.request, command.forceMode);
        return json({ ok: true, result }, 200);
      }
      if (command.type === "cache-clear-region") {
        const result = await this.#clearTrafficRegion(command.regionKey, command.forceMode);
        return json({ ok: true, result }, 200);
      }
      if (command.type === "admin-snapshot") {
        const result = await this.#adminSnapshot(command.forceMode);
        return json({ ok: true, result }, 200);
      }
      const nowMs = this[CLOCK].nowMs();
      const result = await this.ctx.storage.transaction(async (transaction) => {
        const state = await loadState(transaction, nowMs);
        rollover(state, nowMs);
        cleanExpiredLeases(state, nowMs);
        const commandResult = executeCommand(state, command, nowMs);
        await transaction.put(STATE_KEY, state);
        await scheduleNextExpiry(transaction, state);
        return commandResult;
      });
      return json({ ok: true, result }, 200);
    } catch (error) {
      console.error("adsb_broker_command_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        providerConfiguration: error instanceof ProviderConfigurationError,
      });
      return json(
        { ok: false, error: { code: "INTERNAL_ERROR", message: "Broker command failed" } },
        500,
      );
    }
  }

  async alarm(): Promise<void> {
    const nowMs = this[CLOCK].nowMs();
    await this.ctx.storage.transaction(async (transaction) => {
      const state = await loadState(transaction, nowMs);
      rollover(state, nowMs);
      cleanExpiredLeases(state, nowMs);
      const index = await loadTrafficIndex(transaction);
      await evictExpiredTraffic(transaction, index, nowMs);
      await transaction.put(STATE_KEY, state);
      await transaction.put(TRAFFIC_INDEX_KEY, index);
      await scheduleNextExpiry(transaction, state);
    });
  }
}

export function setBrokerClockForTest(broker: AdsbBroker, clock: Clock): void {
  broker[CLOCK] = clock;
}

export function setBrokerTrafficProviderForTest(
  broker: AdsbBroker,
  provider: BrokerTrafficProvider,
  settings: ProviderSettings,
): void {
  broker[TRAFFIC_PROVIDER] = provider;
  broker[PROVIDER_SETTINGS] = settings;
}

export function setBrokerSleeperForTest(broker: AdsbBroker, sleeper: Sleeper): void {
  broker[SLEEP] = sleeper;
}

export function brokerProviderQueueForTest(broker: AdsbBroker): ProviderPriority[] {
  return broker[PROVIDER_QUEUE_SNAPSHOT]();
}

export function brokerSignedViewerCountForTest(broker: AdsbBroker): number {
  return broker[SIGNED_VIEWER_COUNT]();
}

export async function seedAdmittedRequestsForTest(
  broker: AdsbBroker,
  state: DurableObjectState,
  admittedRequests: number,
): Promise<void> {
  if (
    !Number.isSafeInteger(admittedRequests) ||
    admittedRequests < 0 ||
    admittedRequests > DAILY_ADMITTED_REQUEST_LIMIT
  ) {
    throw new TypeError("Seed count is invalid");
  }
  const nowMs = broker[CLOCK].nowMs();
  await state.storage.transaction(async (transaction) => {
    const stored = await loadState(transaction, nowMs);
    rollover(stored, nowMs);
    cleanExpiredLeases(stored, nowMs);
    stored.admittedRequests = admittedRequests;
    stored.health.admitted = admittedRequests;
    stored.budgetBand = budgetBandFor(admittedRequests);
    stored.automaticMode = automaticModeFor(admittedRequests);
    if (admittedRequests < READ_ONLY_THRESHOLD_REQUESTS) {
      for (const lease of stored.leases) lease.reserveRemaining = 0;
    }
    await transaction.put(STATE_KEY, stored);
    await scheduleNextExpiry(transaction, stored);
  });
}
