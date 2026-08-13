import {
  LEADERBOARD_CACHE_TTL_SECONDS,
  LEADERBOARD_DEFAULT_LIMIT,
  LEADERBOARD_MAX_LIMIT,
  LEADERBOARD_MINIMUM_POLL_SECONDS,
  type LeaderboardAssist,
  type LeaderboardPage,
  type LeaderboardPartition,
} from "../../../src/leaderboards/types";
import type { AircraftClassId } from "../../../src/mission/types";
import {
  listLeaderboardResults,
  type LeaderboardDatabaseCursor,
} from "../../db/results";
import type { Env } from "../../env";
import { defineRoute, type RouteDefinition } from "../router";
import { ValidationError } from "../validation";

const CLASS_IDS: readonly AircraftClassId[] = ["c172s", "b738", "f5e", "biz"];
const ASSISTS: readonly LeaderboardAssist[] = ["none", "low", "medium", "high"];
const SCORING_VERSION = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_MAX_LENGTH = 512;
const QUERY_KEYS = new Set(["class", "assist", "scoring", "limit", "cursor"]);

type ParsedLeaderboardQuery = {
  partition: LeaderboardPartition;
  cursor: LeaderboardDatabaseCursor | null;
  encodedCursor: string | null;
  limit: number;
};

export type LeaderboardRouteDependencies = {
  cache: () => Cache | null;
  now: () => number;
  list: typeof listLeaderboardResults;
};

const DEFAULT_DEPENDENCIES: LeaderboardRouteDependencies = {
  cache: () => typeof caches === "undefined" ? null : caches.default,
  now: () => Date.now(),
  list: listLeaderboardResults,
};

function invalid(): never {
  throw new ValidationError(400, "INVALID_REQUEST", "Leaderboard query is invalid");
}

function base64UrlEncode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > CURSOR_MAX_LENGTH) invalid();
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(padded);
    return JSON.parse(new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    ));
  } catch {
    return invalid();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function encodeCursor(
  partition: LeaderboardPartition,
  cursor: LeaderboardDatabaseCursor,
): string {
  return base64UrlEncode({
    schemaVersion: 1,
    partition,
    score: cursor.score,
    completedAt: cursor.completedAt,
    resultId: cursor.resultId,
    offset: cursor.offset,
  });
}

function decodeCursor(
  encoded: string,
  partition: LeaderboardPartition,
): LeaderboardDatabaseCursor {
  const value = base64UrlDecode(encoded);
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.partition)) invalid();
  const cursorPartition = value.partition;
  if (
    cursorPartition.classId !== partition.classId ||
    cursorPartition.highestAssist !== partition.highestAssist ||
    cursorPartition.scoringVersion !== partition.scoringVersion ||
    typeof value.score !== "number" || !Number.isInteger(value.score) ||
    value.score < 0 || value.score > 100_000 ||
    typeof value.completedAt !== "number" || !Number.isSafeInteger(value.completedAt) ||
    value.completedAt < 0 ||
    typeof value.resultId !== "string" || !UUID.test(value.resultId) ||
    typeof value.offset !== "number" || !Number.isSafeInteger(value.offset) || value.offset < 1
  ) invalid();
  return {
    score: value.score,
    completedAt: value.completedAt,
    resultId: value.resultId,
    offset: value.offset,
  };
}

function parseQuery(request: Request): ParsedLeaderboardQuery {
  const search = new URL(request.url).searchParams;
  const keys = [...new Set(search.keys())];
  if (
    keys.some((key) => !QUERY_KEYS.has(key)) ||
    ["class", "assist", "scoring"].some((key) => search.getAll(key).length !== 1) ||
    ["limit", "cursor"].some((key) => search.getAll(key).length > 1)
  ) invalid();
  const classId = search.get("class");
  const highestAssist = search.get("assist");
  const scoringVersion = search.get("scoring");
  if (
    !CLASS_IDS.includes(classId as AircraftClassId) ||
    !ASSISTS.includes(highestAssist as LeaderboardAssist) ||
    scoringVersion === null || !SCORING_VERSION.test(scoringVersion)
  ) invalid();
  const partition: LeaderboardPartition = {
    classId: classId as AircraftClassId,
    highestAssist: highestAssist as LeaderboardAssist,
    scoringVersion,
  };
  const rawLimit = search.get("limit");
  const limit = rawLimit === null ? LEADERBOARD_DEFAULT_LIMIT : Number(rawLimit);
  if (
    !Number.isInteger(limit) || limit < 1 || limit > LEADERBOARD_MAX_LIMIT ||
    (rawLimit !== null && String(limit) !== rawLimit)
  ) invalid();
  const encodedCursor = search.get("cursor");
  const cursor = encodedCursor === null ? null : decodeCursor(encodedCursor, partition);
  return { partition, cursor, encodedCursor, limit };
}

function cacheKey(request: Request, query: ParsedLeaderboardQuery): Request {
  const url = new URL("/api/leaderboards", request.url);
  url.search = "";
  url.searchParams.set("class", query.partition.classId);
  url.searchParams.set("assist", query.partition.highestAssist);
  url.searchParams.set("scoring", query.partition.scoringVersion);
  url.searchParams.set("limit", String(query.limit));
  if (query.encodedCursor !== null) url.searchParams.set("cursor", query.encodedCursor);
  return new Request(url.toString(), { method: "GET" });
}

function publicHeaders(cacheStatus: "HIT" | "MISS" | "BYPASS"): HeadersInit {
  return {
    "cache-control": `public, max-age=${LEADERBOARD_MINIMUM_POLL_SECONDS}, s-maxage=${LEADERBOARD_CACHE_TTL_SECONDS}`,
    "x-minimum-poll-seconds": String(LEADERBOARD_MINIMUM_POLL_SECONDS),
    "x-leaderboard-cache": cacheStatus,
  };
}

async function readCachedPage(
  cache: Cache,
  key: Request,
  partition: LeaderboardPartition,
): Promise<LeaderboardPage | null> {
  try {
    const response = await cache.match(key);
    if (response === undefined) return null;
    const page = await response.json() as LeaderboardPage;
    return page.schemaVersion === 1 &&
      page.partition?.classId === partition.classId &&
      page.partition.highestAssist === partition.highestAssist &&
      page.partition.scoringVersion === partition.scoringVersion &&
      page.cacheTtlSeconds === LEADERBOARD_CACHE_TTL_SECONDS &&
      page.minimumPollSeconds === LEADERBOARD_MINIMUM_POLL_SECONDS &&
      Array.isArray(page.entries)
      ? page
      : null;
  } catch {
    return null;
  }
}

async function writeCachedPage(cache: Cache, key: Request, page: LeaderboardPage): Promise<void> {
  try {
    await cache.put(key, Response.json(page, {
      headers: { "cache-control": `public, s-maxage=${LEADERBOARD_CACHE_TTL_SECONDS}` },
    }));
  } catch {
    // D1 remains authoritative; a cache failure only changes the performance path.
  }
}

export function createLeaderboardRoutes(
  overrides: Partial<LeaderboardRouteDependencies> = {},
): readonly RouteDefinition[] {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  return [defineRoute({
    method: "GET",
    path: "/api/leaderboards",
    family: "leaderboards",
    boundary: "public",
    admission: "public-read",
    security: {
      sameOrigin: "not-required",
      csrf: "not-required",
      idempotency: "not-required",
      body: { kind: "none" },
    },
    limiter: { name: "leaderboards", retryAfterSeconds: LEADERBOARD_MINIMUM_POLL_SECONDS },
    validate: ({ request }) => parseQuery(request),
    handler: async ({ request, validated, env }) => {
      const query = validated as ParsedLeaderboardQuery;
      const cache = dependencies.cache();
      const key = cache === null ? null : cacheKey(request, query);
      const cached = cache === null || key === null
        ? null
        : await readCachedPage(cache, key, query.partition);
      if (cached !== null) {
        return { code: "LEADERBOARD_READ", data: cached, headers: publicHeaders("HIT") };
      }
      const result = await dependencies.list((env as Env).DB, {
        partition: query.partition,
        cursor: query.cursor,
        limit: query.limit,
        now: dependencies.now(),
      });
      const offset = query.cursor?.offset ?? 0;
      const entries = result.entries.map((entry, index) => ({ ...entry, rank: offset + index + 1 }));
      const last = entries.at(-1);
      const nextCursor = result.hasMore && last !== undefined
        ? encodeCursor(query.partition, {
            score: Math.round(last.score * 1_000),
            completedAt: last.completedAt,
            resultId: last.resultId,
            offset: last.rank,
          })
        : null;
      const page: LeaderboardPage = {
        schemaVersion: 1,
        partition: query.partition,
        entries,
        nextCursor,
        cacheTtlSeconds: LEADERBOARD_CACHE_TTL_SECONDS,
        minimumPollSeconds: LEADERBOARD_MINIMUM_POLL_SECONDS,
      };
      if (cache !== null && key !== null) await writeCachedPage(cache, key, page);
      return {
        code: "LEADERBOARD_READ",
        data: page,
        headers: publicHeaders(cache === null ? "BYPASS" : "MISS"),
      };
    },
  })];
}
