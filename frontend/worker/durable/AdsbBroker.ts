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
} from "../../src/shared/limits";
import { mostRestrictiveMode, type SystemMode } from "../../src/shared/mode";
import type { Env } from "../env";
import { systemClock, type Clock } from "./clock";
import {
  ADSB_BROKER_COMMAND_PATH,
  parseBrokerCommand,
  type AdmissionDenialReason,
  type AdmissionResult,
  type BrokerCommand,
  type BrokerCommandResult,
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
const CLOCK = Symbol("AdsbBroker.clock");
const MAX_COMMAND_BYTES = 8_192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LeaseRecord = {
  userId: string;
  missionId: string;
  expiresAtMs: number;
  reserveRemaining: number;
};

type StoredBrokerState = {
  version: 1;
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
};

type StorageView = Pick<
  DurableObjectTransaction,
  "get" | "put" | "setAlarm" | "deleteAlarm"
>;

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
    version: 1,
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
    state.version === 1 &&
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
    isSafeCount(state.transitionSequence) &&
    validTransition
  );
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
  };
}

async function loadState(storage: StorageView, nowMs: number): Promise<StoredBrokerState> {
  const stored = await storage.get<unknown>(STATE_KEY);
  if (stored === undefined) return initialState(nowMs);
  if (!isStoredState(stored)) throw new Error("Broker storage is invalid");
  return stored;
}

async function scheduleNextExpiry(storage: StorageView, state: StoredBrokerState): Promise<void> {
  const earliest = state.leases.reduce<number | null>(
    (current, lease) => current === null || lease.expiresAtMs < current ? lease.expiresAtMs : current,
    null,
  );
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
  if (command.kind === "public-write" && effectiveMode === "READ_ONLY") {
    return rejectAdmission(state, command.forceMode, "read-only");
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

export class AdsbBroker extends DurableObject<Env> {
  [CLOCK]: Clock = systemClock;

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
    } catch {
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
      await transaction.put(STATE_KEY, state);
      await scheduleNextExpiry(transaction, state);
    });
  }
}

export function setBrokerClockForTest(broker: AdsbBroker, clock: Clock): void {
  broker[CLOCK] = clock;
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
