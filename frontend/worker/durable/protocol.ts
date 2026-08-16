import { isSystemMode, type SystemMode } from "../../src/shared/mode";
import {
  ACTIVE_FLIGHT_GLOBAL_LIMIT,
  ACTIVE_FLIGHT_MAX_RESERVE,
} from "../../src/shared/limits";
import type { AdsbBroker } from "./AdsbBroker";
import { isTrafficData, type TrafficRequest } from "../adsb/traffic";
import type { TrafficData } from "../../src/data/types";

export const ADSB_BROKER_OBJECT_NAME = "global-v1";
export const ADSB_BROKER_COMMAND_PATH = "/internal/broker";

export type AdmissionKind = "public-read" | "public-write" | "registration" | "active-flight";
export type BudgetBand = "normal" | "conservation" | "read-only" | "kill-switch";
export type FlightCapacityBand = "normal" | "warning" | "full";
export type AdmissionDenialReason =
  | "daily-limit"
  | "protected-reserve"
  | "read-only"
  | "kill-switch"
  | "registration-disabled"
  | "lease-required"
  | "lease-reserve-exhausted";
export type LeaseDenialReason =
  | "read-only"
  | "kill-switch"
  | "user-limit"
  | "global-limit"
  | "not-found";

export type BrokerTransition = {
  sequence: number;
  kind: "budget" | "flight-capacity";
  from: BudgetBand | FlightCapacityBand;
  to: BudgetBand | FlightCapacityBand;
  atMs: number;
};

export type BrokerHealthCounters = {
  admitted: number;
  admissionRejected: number;
  leaseRejected: number;
  providerCalls: number;
  providerFailures: number;
  componentFailures: number;
};

export type BrokerStatus = {
  utcDay: string;
  admittedRequests: number;
  providerRequests: number;
  automaticMode: SystemMode;
  requestedMode: SystemMode;
  effectiveMode: SystemMode;
  budgetBand: BudgetBand;
  activeFlights: number;
  flightCapacityBand: FlightCapacityBand;
  protectedReserveRemaining: number;
  health: BrokerHealthCounters;
  lastAlertTransition: BrokerTransition | null;
  registrationEnabled: boolean;
  providerCacheOnly: boolean;
};

export type BrokerAdminSnapshot = {
  capturedAtMs: number;
  status: BrokerStatus;
  leases: Array<{
    userId: string;
    missionId: string;
    expiresAtMs: number;
    reserveRemaining: number;
  }>;
  cacheRegions: Array<{
    regionKey: string;
    fetchedAtMs: number | null;
    expiresAtMs: number;
    lastAccessAtMs: number;
    providerAvailable: boolean;
    failureCount: number;
    retryAtMs: number;
    viewerCount: number;
  }>;
  presence: Array<{
    userId: string;
    missionId: string | null;
    regionKey: string;
    lastSeenAtMs: number;
    audience: "signed" | "active-ghost" | "ambient";
  }>;
  providerWork: {
    queuedByPriority: [number, number, number, number];
    inFlightRegions: number;
    runningPriority: number | null;
  };
  /** Read-only per-provider circuit health (adsb-game#19 phase 2a). No mutation path here. */
  trafficSources: {
    providers: Array<{
      providerKey: string;
      state: "closed" | "open" | "half-open";
      consecutiveFailures: number;
      cooldownRemainingMs: number;
      lastOutcome: "success" | "failure" | null;
      /** Null when no outcome has ever been recorded for this provider (honest "no data"). */
      lastOutcomeAtMs: number | null;
    }>;
    budget: {
      band: BudgetBand;
      admittedRequests: { used: number; limit: number };
      /** Provider daily-limit is null when provider settings could not be read. */
      providerRequests: { used: number; limit: number | null };
    };
  };
};

export type BrokerCommand =
  | {
      type: "admit";
      kind: "public-read" | "public-write" | "registration";
      forceMode: SystemMode;
    }
  | {
      type: "admit";
      kind: "active-flight";
      forceMode: SystemMode;
      userId: string;
      missionId: string;
    }
  | {
      type: "lease-acquire" | "lease-renew";
      forceMode: SystemMode;
      userId: string;
      missionId: string;
    }
  | { type: "lease-release"; userId: string; missionId: string }
  | { type: "lease-release-user"; userId: string }
  | { type: "mode-set"; requestedMode: SystemMode; forceMode: SystemMode }
  | {
      type: "settings-set";
      registrationEnabled: boolean;
      providerCacheOnly: boolean;
      forceMode: SystemMode;
    }
  | { type: "cache-clear-region"; regionKey: string; forceMode: SystemMode }
  | { type: "status" | "transitions"; forceMode: SystemMode }
  | { type: "admin-snapshot"; forceMode: SystemMode }
  | { type: "traffic"; forceMode: SystemMode; request: TrafficRequest }
  | { type: "provider-record"; outcome: "success" | "failure" }
  | {
      type: "health-record";
      component: "d1" | "r2" | "email" | "provider";
      outcome: "success" | "failure";
    }
  | {
      type: "request-record";
      outcome: "success" | "failure";
      atMs: number;
      forceMode: SystemMode;
    }
  | {
      type: "alert-admin";
      action: string;
      auditId: string;
      requestId: string;
      atMs: number;
      forceMode: SystemMode;
    }
  | {
      type: "alert-test";
      auditId: string;
      requestId: string;
      atMs: number;
      forceMode: SystemMode;
    }
  | { type: "health-check"; scheduledAtMs: number; forceMode: SystemMode }
  | { type: "recover"; action: "reset-health-counters"; forceMode: SystemMode };

export type AdmissionResult = {
  type: "admission";
  allowed: boolean;
  reason?: AdmissionDenialReason;
  status: BrokerStatus;
};

export type LeaseResult = {
  type: "lease";
  allowed: boolean;
  reason?: LeaseDenialReason;
  lease?: {
    userId: string;
    missionId: string;
    expiresAtMs: number;
    reserveRemaining: number;
  };
  status: BrokerStatus;
};

export type BrokerCommandResult =
  | AdmissionResult
  | LeaseResult
  | { type: "status"; status: BrokerStatus }
  | { type: "transition"; transition: BrokerTransition | null; status: BrokerStatus }
  | { type: "traffic"; traffic: TrafficData; status: BrokerStatus }
  | { type: "cache-cleared"; regionKey: string; cleared: boolean; status: BrokerStatus }
  | { type: "admin-snapshot"; snapshot: BrokerAdminSnapshot; status: BrokerStatus }
  | { type: "recorded"; status: BrokerStatus };

export type BrokerResponse =
  | { ok: true; result: BrokerCommandResult }
  | {
      ok: false;
      error: {
        code: "INVALID_COMMAND" | "METHOD_NOT_ALLOWED" | "NOT_FOUND" | "INTERNAL_ERROR";
        message: string;
      };
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND_TYPES = new Set([
  "admit",
  "lease-acquire",
  "lease-renew",
  "lease-release",
  "lease-release-user",
  "mode-set",
  "settings-set",
  "cache-clear-region",
  "status",
  "transitions",
  "admin-snapshot",
  "traffic",
  "provider-record",
  "health-record",
  "request-record",
  "alert-admin",
  "alert-test",
  "health-check",
  "recover",
]);
const BUDGET_BANDS = new Set<BudgetBand>([
  "normal",
  "conservation",
  "read-only",
  "kill-switch",
]);
const FLIGHT_BANDS = new Set<FlightCapacityBand>(["normal", "warning", "full"]);
const ADMISSION_DENIAL_REASONS = new Set<AdmissionDenialReason>([
  "daily-limit",
  "protected-reserve",
  "read-only",
  "kill-switch",
  "registration-disabled",
  "lease-required",
  "lease-reserve-exhausted",
]);
const LEASE_DENIAL_REASONS = new Set<LeaseDenialReason>([
  "read-only",
  "kill-switch",
  "user-limit",
  "global-limit",
  "not-found",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isRegionKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 96) return false;
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "r1") return false;
  const numeric = parts.slice(1).map(Number);
  if (
    numeric.some((part) => !Number.isFinite(part)) ||
    parts.slice(1).some((part, index) => String(numeric[index]) !== part)
  ) return false;
  const [latitude, longitude, radius] = numeric as [number, number, number];
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 &&
    radius >= 5 && radius <= 300;
}

function isTrafficRequest(value: unknown): value is TrafficRequest {
  if (!isRecord(value) || !exactKeys(value, ["latitude", "longitude", "radiusNm", "audience"])) {
    return false;
  }
  if (
    typeof value.latitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    typeof value.radiusNm !== "number" ||
    !Number.isFinite(value.radiusNm)
  ) return false;
  const audience = value.audience;
  if (!isRecord(audience) || typeof audience.kind !== "string") return false;
  switch (audience.kind) {
    case "anonymous":
      return exactKeys(audience, ["kind"]);
    case "signed":
      return exactKeys(audience, ["kind", "userId"]) && isIdentifier(audience.userId);
    case "active-ghost":
      return (
        exactKeys(audience, ["kind", "userId", "missionId", "selectedHex"]) &&
        isIdentifier(audience.userId) &&
        isIdentifier(audience.missionId) &&
        typeof audience.selectedHex === "string" &&
        /^[0-9a-f]{6}$/i.test(audience.selectedHex)
      );
    case "ambient":
      return (
        exactKeys(audience, ["kind", "userId", "missionId"]) &&
        isIdentifier(audience.userId) &&
        isIdentifier(audience.missionId)
      );
    default:
      return false;
  }
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isTransition(value: unknown): value is BrokerTransition {
  if (!isRecord(value)) return false;
  const from = String(value.from);
  const to = String(value.to);
  const validBands = value.kind === "budget"
    ? BUDGET_BANDS.has(from as BudgetBand) && BUDGET_BANDS.has(to as BudgetBand)
    : value.kind === "flight-capacity"
      ? FLIGHT_BANDS.has(from as FlightCapacityBand) &&
        FLIGHT_BANDS.has(to as FlightCapacityBand)
      : false;
  return (
    isCount(value.sequence) &&
    validBands &&
    isCount(value.atMs)
  );
}

function isHealth(value: unknown): value is BrokerHealthCounters {
  if (!isRecord(value)) return false;
  return [
    value.admitted,
    value.admissionRejected,
    value.leaseRejected,
    value.providerCalls,
    value.providerFailures,
    value.componentFailures,
  ].every(isCount);
}

function isStatus(value: unknown): value is BrokerStatus {
  if (!isRecord(value)) return false;
  return (
    typeof value.utcDay === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.utcDay) &&
    isCount(value.admittedRequests) &&
    isCount(value.providerRequests) &&
    isSystemMode(value.automaticMode) &&
    isSystemMode(value.requestedMode) &&
    isSystemMode(value.effectiveMode) &&
    BUDGET_BANDS.has(value.budgetBand as BudgetBand) &&
    isCount(value.activeFlights) &&
    value.activeFlights <= ACTIVE_FLIGHT_GLOBAL_LIMIT &&
    FLIGHT_BANDS.has(value.flightCapacityBand as FlightCapacityBand) &&
    isCount(value.protectedReserveRemaining) &&
    value.protectedReserveRemaining <= ACTIVE_FLIGHT_MAX_RESERVE &&
    isHealth(value.health) &&
    typeof value.registrationEnabled === "boolean" &&
    typeof value.providerCacheOnly === "boolean" &&
    (value.lastAlertTransition === null || isTransition(value.lastAlertTransition))
  );
}

function isLease(value: unknown): value is NonNullable<LeaseResult["lease"]> {
  if (!isRecord(value)) return false;
  return (
    isIdentifier(value.userId) &&
    isIdentifier(value.missionId) &&
    isCount(value.expiresAtMs) &&
    isCount(value.reserveRemaining)
  );
}

function isAdminSnapshot(value: unknown): value is BrokerAdminSnapshot {
  if (!isRecord(value) || !isCount(value.capturedAtMs) || !isStatus(value.status)) return false;
  if (
    !Array.isArray(value.leases) ||
    value.leases.length > ACTIVE_FLIGHT_GLOBAL_LIMIT ||
    !value.leases.every((lease) => isLease(lease))
  ) return false;
  if (
    !Array.isArray(value.cacheRegions) ||
    value.cacheRegions.length > 32 ||
    !value.cacheRegions.every((region) =>
      isRecord(region) &&
      isRegionKey(region.regionKey) &&
      (region.fetchedAtMs === null || isCount(region.fetchedAtMs)) &&
      isCount(region.expiresAtMs) &&
      isCount(region.lastAccessAtMs) &&
      typeof region.providerAvailable === "boolean" &&
      isCount(region.failureCount) &&
      isCount(region.retryAtMs) &&
      isCount(region.viewerCount)
    )
  ) return false;
  if (
    !Array.isArray(value.presence) ||
    value.presence.length > 200 ||
    !value.presence.every((entry) =>
      isRecord(entry) &&
      isIdentifier(entry.userId) &&
      (entry.missionId === null || isIdentifier(entry.missionId)) &&
      isRegionKey(entry.regionKey) &&
      isCount(entry.lastSeenAtMs) &&
      ["signed", "active-ghost", "ambient"].includes(String(entry.audience))
    )
  ) return false;
  const work = value.providerWork;
  if (
    !isRecord(work) ||
    !Array.isArray(work.queuedByPriority) ||
    work.queuedByPriority.length !== 4 ||
    !work.queuedByPriority.every(isCount) ||
    !isCount(work.inFlightRegions) ||
    (work.runningPriority !== null &&
      !(Number.isInteger(work.runningPriority) && Number(work.runningPriority) >= 0 &&
        Number(work.runningPriority) <= 3))
  ) return false;
  const sources = value.trafficSources;
  if (
    !isRecord(sources) ||
    !Array.isArray(sources.providers) ||
    sources.providers.length > 8 ||
    !sources.providers.every((provider) =>
      isRecord(provider) &&
      typeof provider.providerKey === "string" &&
      provider.providerKey.length > 0 &&
      provider.providerKey.length <= 256 &&
      ["closed", "open", "half-open"].includes(String(provider.state)) &&
      isCount(provider.consecutiveFailures) &&
      isCount(provider.cooldownRemainingMs) &&
      [null, "success", "failure"].includes(provider.lastOutcome as string | null) &&
      (provider.lastOutcomeAtMs === null || isCount(provider.lastOutcomeAtMs))
    )
  ) return false;
  const budget = sources.budget;
  return (
    isRecord(budget) &&
    BUDGET_BANDS.has(budget.band as BudgetBand) &&
    isRecord(budget.admittedRequests) &&
    isCount(budget.admittedRequests.used) &&
    isCount(budget.admittedRequests.limit) &&
    isRecord(budget.providerRequests) &&
    isCount(budget.providerRequests.used) &&
    (budget.providerRequests.limit === null || isCount(budget.providerRequests.limit))
  );
}

function parseBrokerResult(value: unknown): BrokerCommandResult {
  if (!isRecord(value) || typeof value.type !== "string" || !isStatus(value.status)) {
    throw new TypeError("Invalid broker response");
  }
  switch (value.type) {
    case "admission":
      if (
        typeof value.allowed !== "boolean" ||
        (value.allowed && value.reason !== undefined) ||
        (!value.allowed && value.reason === undefined) ||
        (value.reason !== undefined &&
          !ADMISSION_DENIAL_REASONS.has(value.reason as AdmissionDenialReason))
      ) throw new TypeError("Invalid broker response");
      return value as AdmissionResult;
    case "lease":
      if (
        typeof value.allowed !== "boolean" ||
        (value.allowed && value.reason !== undefined) ||
        (!value.allowed && value.reason === undefined) ||
        (value.reason !== undefined && !LEASE_DENIAL_REASONS.has(value.reason as LeaseDenialReason)) ||
        (value.lease !== undefined && !isLease(value.lease))
      ) throw new TypeError("Invalid broker response");
      return value as LeaseResult;
    case "status":
    case "recorded":
      return value as BrokerCommandResult;
    case "cache-cleared":
      if (!isRegionKey(value.regionKey) || typeof value.cleared !== "boolean") {
        throw new TypeError("Invalid broker response");
      }
      return value as BrokerCommandResult;
    case "admin-snapshot":
      if (!isAdminSnapshot(value.snapshot)) {
        throw new TypeError("Invalid broker response");
      }
      return value as BrokerCommandResult;
    case "traffic":
      if (!isTrafficData(value.traffic)) throw new TypeError("Invalid broker response");
      return value as BrokerCommandResult;
    case "transition":
      if (value.transition !== null && !isTransition(value.transition)) {
        throw new TypeError("Invalid broker response");
      }
      return value as BrokerCommandResult;
    default:
      throw new TypeError("Invalid broker response");
  }
}

function invalid(): never {
  throw new TypeError("Invalid broker command");
}

export function parseBrokerCommand(value: unknown): BrokerCommand {
  if (!isRecord(value) || typeof value.type !== "string" || !COMMAND_TYPES.has(value.type)) {
    return invalid();
  }

  switch (value.type) {
    case "admit": {
      if (!isSystemMode(value.forceMode)) return invalid();
      if (value.kind === "active-flight") {
        if (
          !exactKeys(value, ["type", "kind", "forceMode", "userId", "missionId"]) ||
          !isIdentifier(value.userId) ||
          !isIdentifier(value.missionId)
        ) return invalid();
        return value as BrokerCommand;
      }
      if (
        !["public-read", "public-write", "registration"].includes(String(value.kind)) ||
        !exactKeys(value, ["type", "kind", "forceMode"])
      ) return invalid();
      return value as BrokerCommand;
    }
    case "lease-acquire":
    case "lease-renew":
      if (
        !exactKeys(value, ["type", "forceMode", "userId", "missionId"]) ||
        !isSystemMode(value.forceMode) ||
        !isIdentifier(value.userId) ||
        !isIdentifier(value.missionId)
      ) return invalid();
      return value as BrokerCommand;
    case "lease-release":
      if (
        !exactKeys(value, ["type", "userId", "missionId"]) ||
        !isIdentifier(value.userId) ||
        !isIdentifier(value.missionId)
      ) return invalid();
      return value as BrokerCommand;
    case "lease-release-user":
      if (!exactKeys(value, ["type", "userId"]) || !isIdentifier(value.userId)) return invalid();
      return value as BrokerCommand;
    case "mode-set":
      if (
        !exactKeys(value, ["type", "requestedMode", "forceMode"]) ||
        !isSystemMode(value.requestedMode) ||
        !isSystemMode(value.forceMode)
      ) return invalid();
      return value as BrokerCommand;
    case "settings-set":
      if (
        !exactKeys(value, [
          "type",
          "registrationEnabled",
          "providerCacheOnly",
          "forceMode",
        ]) ||
        typeof value.registrationEnabled !== "boolean" ||
        typeof value.providerCacheOnly !== "boolean" ||
        !isSystemMode(value.forceMode)
      ) return invalid();
      return value as BrokerCommand;
    case "cache-clear-region":
      if (
        !exactKeys(value, ["type", "regionKey", "forceMode"]) ||
        !isRegionKey(value.regionKey) ||
        !isSystemMode(value.forceMode)
      ) return invalid();
      return value as BrokerCommand;
    case "status":
    case "transitions":
    case "admin-snapshot":
      if (!exactKeys(value, ["type", "forceMode"]) || !isSystemMode(value.forceMode)) return invalid();
      return value as BrokerCommand;
    case "traffic":
      if (
        !exactKeys(value, ["type", "forceMode", "request"]) ||
        !isSystemMode(value.forceMode) ||
        !isTrafficRequest(value.request)
      ) {
        return invalid();
      }
      return value as BrokerCommand;
    case "provider-record":
      if (
        !exactKeys(value, ["type", "outcome"]) ||
        (value.outcome !== "success" && value.outcome !== "failure")
      ) return invalid();
      return value as BrokerCommand;
    case "health-record":
      if (
        !exactKeys(value, ["type", "component", "outcome"]) ||
        !["d1", "r2", "email", "provider"].includes(String(value.component)) ||
        (value.outcome !== "success" && value.outcome !== "failure")
      ) return invalid();
      return value as BrokerCommand;
    case "request-record":
      if (
        !exactKeys(value, ["type", "outcome", "atMs", "forceMode"]) ||
        (value.outcome !== "success" && value.outcome !== "failure") ||
        !isCount(value.atMs) ||
        !isSystemMode(value.forceMode)
      ) return invalid();
      return value as BrokerCommand;
    case "alert-admin":
      if (
        !exactKeys(value, ["type", "action", "auditId", "requestId", "atMs", "forceMode"]) ||
        typeof value.action !== "string" ||
        !/^[a-z][a-z0-9._-]{0,63}$/.test(value.action) ||
        !isIdentifier(value.auditId) ||
        !isIdentifier(value.requestId) ||
        !isCount(value.atMs) ||
        !isSystemMode(value.forceMode)
      ) return invalid();
      return value as BrokerCommand;
    case "alert-test":
      if (
        !exactKeys(value, ["type", "auditId", "requestId", "atMs", "forceMode"]) ||
        !isIdentifier(value.auditId) ||
        !isIdentifier(value.requestId) ||
        !isCount(value.atMs) ||
        !isSystemMode(value.forceMode)
      ) return invalid();
      return value as BrokerCommand;
    case "health-check":
      if (
        !exactKeys(value, ["type", "scheduledAtMs", "forceMode"]) ||
        !isCount(value.scheduledAtMs) ||
        !isSystemMode(value.forceMode)
      ) return invalid();
      return value as BrokerCommand;
    case "recover":
      if (
        !exactKeys(value, ["type", "action", "forceMode"]) ||
        value.action !== "reset-health-counters" ||
        !isSystemMode(value.forceMode)
      ) return invalid();
      return value as BrokerCommand;
  }
  return invalid();
}

export function parseBrokerResponse(value: unknown): BrokerCommandResult {
  if (!isRecord(value) || value.ok !== true || !("result" in value)) {
    throw new TypeError("Invalid broker response");
  }
  return parseBrokerResult(value.result);
}

export function brokerStub(
  namespace: DurableObjectNamespace<AdsbBroker>,
): DurableObjectStub<AdsbBroker> {
  return namespace.get(namespace.idFromName(ADSB_BROKER_OBJECT_NAME));
}

export async function sendBrokerCommand(
  namespace: DurableObjectNamespace<AdsbBroker>,
  command: BrokerCommand,
): Promise<BrokerCommandResult> {
  const response = await brokerStub(namespace).fetch(
    new Request(`https://adsb-broker.invalid${ADSB_BROKER_COMMAND_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    }),
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error("Broker command failed");
  }
  return parseBrokerResponse(body);
}
