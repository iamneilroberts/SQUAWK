import type {
  Contact,
  TrafficCacheStatus,
  TrafficData,
  TrafficFreshness,
} from "../../src/data/types";
import {
  ACTIVE_FLIGHT_REFRESH_SECONDS,
  ANONYMOUS_REFRESH_SECONDS,
  CONSERVATION_ANONYMOUS_REFRESH_SECONDS,
  CONSERVATION_SIGNED_BROWSE_REFRESH_SECONDS,
  SIGNED_BROWSE_REFRESH_SECONDS,
  TRAFFIC_EXPIRE_SECONDS,
  TRAFFIC_FRESH_SECONDS,
  TRAFFIC_RETRY_BASE_SECONDS,
  TRAFFIC_RETRY_MAX_SECONDS,
} from "../../src/shared/limits";
import type { BudgetBand } from "../durable/protocol";
import {
  filterContactsToRequestedCircle,
  type NormalizedRegion,
} from "./region";

export type TrafficAudience =
  | { kind: "anonymous" }
  | { kind: "signed"; userId: string }
  | { kind: "active-ghost"; userId: string; missionId: string; selectedHex: string }
  | { kind: "ambient"; userId: string; missionId: string };

export type TrafficRequest = {
  latitude: number;
  longitude: number;
  radiusNm: number;
  audience: TrafficAudience;
};

export type TrafficCacheMetadata = {
  regionKey: string;
  source: string;
  sourceTime: number | null;
  fetchedAt: number;
  expiresAtMs: number;
  lastAccessAtMs: number;
  retryAtMs: number;
  failureCount: number;
  providerAvailable: boolean;
};

export type TrafficCacheBody = {
  version: 1;
  contacts: Contact[];
};

export type ProviderPriority = 0 | 1 | 2 | 3;

function finiteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function contact(value: unknown): value is Contact {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<Contact>;
  return (
    typeof candidate.hex === "string" &&
    nullableText(candidate.flight) &&
    nullableText(candidate.t) &&
    typeof candidate.lat === "number" &&
    Number.isFinite(candidate.lat) &&
    typeof candidate.lon === "number" &&
    Number.isFinite(candidate.lon) &&
    finiteOrNull(candidate.alt_geom) &&
    (candidate.alt_baro === "ground" || finiteOrNull(candidate.alt_baro)) &&
    finiteOrNull(candidate.gs) &&
    finiteOrNull(candidate.track) &&
    finiteOrNull(candidate.baro_rate) &&
    typeof candidate.military === "boolean" &&
    finiteOrNull(candidate.seen_pos)
  );
}

export function isTrafficCacheMetadata(value: unknown): value is TrafficCacheMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TrafficCacheMetadata>;
  return (
    typeof candidate.regionKey === "string" &&
    /^r1:-?\d+(?:\.\d+)?:-?\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(candidate.regionKey) &&
    typeof candidate.source === "string" &&
    candidate.source.length > 0 &&
    finiteOrNull(candidate.sourceTime) &&
    typeof candidate.fetchedAt === "number" &&
    Number.isFinite(candidate.fetchedAt) &&
    Number.isSafeInteger(candidate.expiresAtMs) &&
    Number.isSafeInteger(candidate.lastAccessAtMs) &&
    Number.isSafeInteger(candidate.retryAtMs) &&
    Number.isSafeInteger(candidate.failureCount) &&
    Number(candidate.failureCount) >= 0 &&
    typeof candidate.providerAvailable === "boolean"
  );
}

export function isTrafficCacheBody(value: unknown): value is TrafficCacheBody {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TrafficCacheBody>;
  return candidate.version === 1 && Array.isArray(candidate.contacts) && candidate.contacts.every(contact);
}

export function trafficCadenceSeconds(
  audience: TrafficAudience,
  budgetBand: BudgetBand,
): number {
  if (audience.kind === "active-ghost" || audience.kind === "ambient") {
    return ACTIVE_FLIGHT_REFRESH_SECONDS;
  }
  const conserving = budgetBand !== "normal";
  if (audience.kind === "signed") {
    return conserving
      ? CONSERVATION_SIGNED_BROWSE_REFRESH_SECONDS
      : SIGNED_BROWSE_REFRESH_SECONDS;
  }
  return conserving ? CONSERVATION_ANONYMOUS_REFRESH_SECONDS : ANONYMOUS_REFRESH_SECONDS;
}

export function providerPriority(
  audience: TrafficAudience,
  signedViewers: number,
): ProviderPriority {
  if (audience.kind === "active-ghost") return 0;
  if (audience.kind === "signed" && signedViewers >= 2) return 1;
  if (audience.kind === "ambient") return 3;
  return 2;
}

export function retryDelayMs(failureCount: number): number {
  const exponent = Math.max(0, Math.min(10, Math.trunc(failureCount) - 1));
  return Math.min(
    TRAFFIC_RETRY_MAX_SECONDS * 1_000,
    TRAFFIC_RETRY_BASE_SECONDS * 1_000 * 2 ** exponent,
  );
}

export function freshness(
  metadata: TrafficCacheMetadata | null,
  nowMs: number,
): TrafficFreshness {
  if (metadata === null || nowMs >= metadata.expiresAtMs) return "EXPIRED";
  if (!metadata.providerAvailable) return "STALE";
  return nowMs - metadata.fetchedAt * 1_000 <= TRAFFIC_FRESH_SECONDS * 1_000
    ? "FRESH"
    : "STALE";
}

export function cacheMetadataForSuccess(
  regionKey: string,
  result: { source: string; sourceTime: number | null; fetchedAt: number },
  nowMs: number,
): TrafficCacheMetadata {
  return {
    regionKey,
    source: result.source,
    sourceTime: result.sourceTime,
    fetchedAt: result.fetchedAt,
    expiresAtMs: nowMs + TRAFFIC_EXPIRE_SECONDS * 1_000,
    lastAccessAtMs: nowMs,
    retryAtMs: 0,
    failureCount: 0,
    providerAvailable: true,
  };
}

export function trafficData(
  region: NormalizedRegion,
  metadata: TrafficCacheMetadata | null,
  body: TrafficCacheBody | null,
  nowMs: number,
  nextRefreshSeconds: number,
  cacheStatus: TrafficCacheStatus,
): TrafficData {
  const state = freshness(metadata, nowMs);
  if (state === "EXPIRED" || metadata === null || body === null) {
    return {
      contacts: [],
      source: null,
      sourceTime: null,
      fetchedAt: null,
      cacheAgeSeconds: null,
      freshness: "EXPIRED",
      providerAvailable: false,
      regionKey: region.regionKey,
      nextRefreshSeconds,
      cacheStatus: "EXPIRED",
      radiusNm: region.radiusNm,
    };
  }

  return {
    contacts: filterContactsToRequestedCircle(body.contacts, region),
    source: metadata.source,
    sourceTime: metadata.sourceTime,
    fetchedAt: metadata.fetchedAt,
    cacheAgeSeconds: Math.max(0, (nowMs - metadata.fetchedAt * 1_000) / 1_000),
    freshness: state,
    providerAvailable: metadata.providerAvailable,
    regionKey: region.regionKey,
    nextRefreshSeconds,
    cacheStatus: state === "STALE" && cacheStatus !== "COALESCED" ? "STALE" : cacheStatus,
    radiusNm: region.radiusNm,
  };
}

export function isTrafficData(value: unknown): value is TrafficData {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TrafficData>;
  return (
    Array.isArray(candidate.contacts) &&
    candidate.contacts.every(contact) &&
    nullableText(candidate.source) &&
    finiteOrNull(candidate.sourceTime) &&
    finiteOrNull(candidate.fetchedAt) &&
    finiteOrNull(candidate.cacheAgeSeconds) &&
    ["FRESH", "STALE", "EXPIRED"].includes(String(candidate.freshness)) &&
    typeof candidate.providerAvailable === "boolean" &&
    typeof candidate.regionKey === "string" &&
    Number.isFinite(candidate.nextRefreshSeconds) &&
    ["MISS", "HIT", "COALESCED", "STALE", "EXPIRED"].includes(String(candidate.cacheStatus)) &&
    Number.isFinite(candidate.radiusNm)
  );
}
