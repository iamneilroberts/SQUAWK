import {
  LEADERBOARD_CACHE_TTL_SECONDS,
  LEADERBOARD_DEFAULT_LIMIT,
  LEADERBOARD_MINIMUM_POLL_SECONDS,
  type LeaderboardEntry,
  type LeaderboardPage,
  type LeaderboardRequest,
} from "./types";

export class LeaderboardClientError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super("Leaderboard request failed");
    this.name = "LeaderboardClientError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validEntry(value: unknown): value is LeaderboardEntry {
  return isRecord(value) &&
    typeof value.resultId === "string" &&
    typeof value.rank === "number" && Number.isSafeInteger(value.rank) && value.rank > 0 &&
    typeof value.userId === "string" &&
    typeof value.handle === "string" &&
    typeof value.score === "number" && Number.isFinite(value.score) &&
    typeof value.completedAt === "number" && Number.isSafeInteger(value.completedAt);
}

function parsePage(value: unknown, request: LeaderboardRequest): LeaderboardPage | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.partition)) return null;
  if (
    value.partition.classId !== request.classId ||
    value.partition.highestAssist !== request.highestAssist ||
    value.partition.scoringVersion !== request.scoringVersion ||
    !Array.isArray(value.entries) || !value.entries.every(validEntry) ||
    !(value.nextCursor === null || typeof value.nextCursor === "string") ||
    value.cacheTtlSeconds !== LEADERBOARD_CACHE_TTL_SECONDS ||
    value.minimumPollSeconds !== LEADERBOARD_MINIMUM_POLL_SECONDS
  ) return null;
  return value as LeaderboardPage;
}

export async function loadLeaderboard(request: LeaderboardRequest): Promise<LeaderboardPage> {
  const search = new URLSearchParams();
  search.set("class", request.classId);
  search.set("assist", request.highestAssist);
  search.set("scoring", request.scoringVersion);
  search.set("limit", String(request.limit ?? LEADERBOARD_DEFAULT_LIMIT));
  if (request.cursor !== undefined) search.set("cursor", request.cursor);
  const response = await fetch(`/api/leaderboards?${search.toString()}`, {
    credentials: "same-origin",
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LeaderboardClientError(response.status, null);
  }
  const code = isRecord(body) && typeof body.code === "string" ? body.code : null;
  const page = isRecord(body) && body.ok === true ? parsePage(body.data, request) : null;
  if (!response.ok || page === null) throw new LeaderboardClientError(response.status, code);
  return page;
}
