import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { banUser } from "../../db/bans";
import { createUser } from "../../db/users";
import type { Env } from "../../env";
import { allowEndpointLimiter, createRouter, type RouterDependencies } from "../router";
import { createLeaderboardRoutes } from "./leaderboards";

const NOW = 1_700_000_000_000;
const ALPHA = "11111111-1111-4111-8111-111111111111";
const BRAVO = "22222222-2222-4222-8222-222222222222";
const CHARLIE = "33333333-3333-4333-8333-333333333333";
const BANNED = "44444444-4444-4444-8444-444444444444";

type TestEnvironment = Cloudflare.Env & { TEST_DB: D1Database; TEST_MIGRATIONS: D1Migration[] };

type CacheDouble = {
  cache: Cache;
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  stored: Map<string, Response>;
};

function cacheDouble(): CacheDouble {
  const stored = new Map<string, Response>();
  const key = (input: RequestInfo | URL) =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const match = vi.fn(async (input: RequestInfo | URL) => stored.get(key(input))?.clone());
  const put = vi.fn(async (input: RequestInfo | URL, response: Response) => {
    stored.set(key(input), response.clone());
  });
  return { cache: { match, put } as unknown as Cache, match, put, stored };
}

function dependencies(): RouterDependencies<Env> {
  return {
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    wallClock: () => new Date(NOW),
    monotonicNow: () => 1,
    digest: async () => "network-digest",
    authorize: async (_boundary, _request, context) => context.actor,
    verifyCsrf: async () => true,
    resolveLimiter: () => allowEndpointLimiter,
    admitRequest: async ({ forceMode }) => ({ allowed: true, mode: forceMode }),
    observe: vi.fn(),
  };
}

function runtime(): Env {
  return { APP_ENV: "local", DB: (env as TestEnvironment).TEST_DB } as Env;
}

async function seedResult(options: {
  resultId: string;
  missionId: string;
  userId: string;
  classId?: "c172s" | "b738" | "f5e" | "biz";
  assist?: "none" | "low" | "medium" | "high";
  scoring?: string;
  score?: number;
  createdAt?: number;
  ranked?: boolean;
  outcome?: "landed" | "crashed" | "invalid";
  evidenceStatus?: "verified" | "partial" | "rejected";
}) {
  const db = (env as TestEnvironment).TEST_DB;
  const createdAt = options.createdAt ?? NOW;
  await db.prepare(
    `INSERT INTO missions
       (id, user_id, aircraft_hex, aircraft_class, adsb_snapshot_json,
        airport_icao, runway_ident, scoring_version, physics_version,
        assists_json, status, created_at, locked_at, finalized_at)
     VALUES (?, ?, 'abc123', ?, '{"schemaVersion":2}', 'KMOB', '09', ?,
             'physics-v1', '{"schemaVersion":1}', 'finalized', ?, ?, ?)`,
  ).bind(
    options.missionId,
    options.userId,
    options.classId ?? "c172s",
    options.scoring ?? "scoring-v1",
    createdAt - 1_000,
    createdAt - 500,
    createdAt,
  ).run();
  await db.prepare(
    `INSERT INTO flight_results
       (id, mission_id, outcome, measurements_json, score, highest_assist,
        evidence_status, evidence_summary_json, created_at)
     VALUES (?, ?, ?, '{"schemaVersion":1}', ?, ?, ?, ?, ?)`,
  ).bind(
    options.resultId,
    options.missionId,
    options.outcome ?? "landed",
    options.score ?? 90_000,
    options.assist ?? "none",
    options.evidenceStatus ?? "verified",
    JSON.stringify({
      schemaVersion: 1,
      ranked: options.ranked ?? true,
      failure: options.outcome === "crashed" ? "SINK_RATE_EXCEEDED" : null,
    }),
    createdAt,
  ).run();
}

function resultId(suffix: string) {
  return `90000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

function missionId(suffix: string) {
  return `80000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

async function getLeaderboard(
  query: string,
  cache = cacheDouble(),
) {
  const router = createRouter(
    createLeaderboardRoutes({ cache: () => cache.cache }),
    dependencies(),
  );
  const response = await router.fetch(
    new Request(`https://fly.voygent.app/api/leaderboards?${query}`),
    runtime(),
  );
  return { response, cache };
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(
    (env as TestEnvironment).TEST_DB,
    (env as TestEnvironment).TEST_MIGRATIONS,
  );
  await Promise.all([
    createUser((env as TestEnvironment).TEST_DB, {
      id: ALPHA, emailKey: "a".repeat(64), handle: "AlphaPilot", createdAt: NOW - 10, updatedAt: NOW - 10,
    }),
    createUser((env as TestEnvironment).TEST_DB, {
      id: BRAVO, emailKey: "b".repeat(64), handle: "BravoPilot", createdAt: NOW - 10, updatedAt: NOW - 10,
    }),
    createUser((env as TestEnvironment).TEST_DB, {
      id: CHARLIE, emailKey: "c".repeat(64), handle: "CharliePilot", createdAt: NOW - 10, updatedAt: NOW - 10,
    }),
    createUser((env as TestEnvironment).TEST_DB, {
      id: BANNED, emailKey: "d".repeat(64), handle: "BannedPilot", createdAt: NOW - 10, updatedAt: NOW - 10,
    }),
  ]);
});

describe("partitioned public leaderboards", () => {
  it("requires one bounded class/assist/scoring partition before touching cache", async () => {
    for (const query of [
      "class=c172s&assist=none",
      "class=c172s&assist=none&scoring=scoring-v1&extra=1",
      "class=unknown&assist=none&scoring=scoring-v1",
      "class=c172s&assist=none&assist=low&scoring=scoring-v1",
      "class=c172s&assist=none&scoring=scoring-v1&limit=500",
      "class=c172s&assist=none&scoring=scoring-v1&cursor=not-a-cursor",
    ]) {
      const cache = cacheDouble();
      const { response } = await getLeaderboard(query, cache);
      expect(response.status).toBe(400);
      expect(cache.match).not.toHaveBeenCalled();
      expect(cache.put).not.toHaveBeenCalled();
    }
  });

  it("accepts the biz class partition (regression guard for CLASS_IDS)", async () => {
    const { response } = await getLeaderboard("class=biz&assist=none&scoring=scoring-v1");
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { entries: unknown[] } };
    expect(body.data.entries).toEqual([]);
  });

  it("keeps ties and page boundaries stable while isolating every partition", async () => {
    await seedResult({ resultId: resultId("1"), missionId: missionId("1"), userId: ALPHA, score: 90_000, createdAt: NOW - 100 });
    await seedResult({ resultId: resultId("2"), missionId: missionId("2"), userId: BRAVO, score: 90_000, createdAt: NOW - 100 });
    await seedResult({ resultId: resultId("3"), missionId: missionId("3"), userId: CHARLIE, score: 80_000, createdAt: NOW - 200 });
    await seedResult({ resultId: resultId("4"), missionId: missionId("4"), userId: ALPHA, assist: "low", score: 99_000 });
    await seedResult({ resultId: resultId("5"), missionId: missionId("5"), userId: BRAVO, classId: "b738", score: 99_000 });
    await seedResult({ resultId: resultId("6"), missionId: missionId("6"), userId: CHARLIE, scoring: "scoring-v2", score: 99_000 });

    const first = await getLeaderboard("scoring=scoring-v1&limit=2&assist=none&class=c172s");
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get("cache-control")).toBe("public, max-age=15, s-maxage=60");
    expect(first.response.headers.get("x-minimum-poll-seconds")).toBe("15");
    const firstBody = await first.response.json() as {
      code: string;
      data: { entries: { resultId: string; rank: number; handle: string }[]; nextCursor: string | null };
    };
    expect(firstBody.code).toBe("LEADERBOARD_READ");
    expect(firstBody.data.entries).toEqual([
      { resultId: resultId("1"), rank: 1, userId: ALPHA, handle: "AlphaPilot", score: 90, completedAt: NOW - 100 },
      { resultId: resultId("2"), rank: 2, userId: BRAVO, handle: "BravoPilot", score: 90, completedAt: NOW - 100 },
    ]);
    expect(firstBody.data.nextCursor).toBeTruthy();
    expect(firstBody.data.nextCursor).not.toContain(resultId("2"));

    const second = await getLeaderboard(
      `class=c172s&assist=none&scoring=scoring-v1&limit=2&cursor=${encodeURIComponent(firstBody.data.nextCursor ?? "")}`,
    );
    const secondBody = await second.response.json() as {
      data: { entries: { resultId: string; rank: number }[]; nextCursor: string | null };
    };
    expect(secondBody.data.entries).toEqual([
      expect.objectContaining({ resultId: resultId("3"), rank: 3 }),
    ]);
    expect(secondBody.data.nextCursor).toBeNull();
  });

  it("excludes every unranked, failed-safety, rejected, and actively banned result", async () => {
    await seedResult({ resultId: resultId("10"), missionId: missionId("10"), userId: ALPHA, score: 75_000 });
    await seedResult({ resultId: resultId("11"), missionId: missionId("11"), userId: BRAVO, score: 99_000, ranked: false });
    await seedResult({ resultId: resultId("12"), missionId: missionId("12"), userId: CHARLIE, score: 99_000, outcome: "crashed" });
    await seedResult({ resultId: resultId("13"), missionId: missionId("13"), userId: CHARLIE, score: 99_000, evidenceStatus: "rejected" });
    await seedResult({ resultId: resultId("14"), missionId: missionId("14"), userId: BANNED, score: 100_000 });
    await banUser((env as TestEnvironment).TEST_DB, {
      id: "70000000-0000-4000-8000-000000000001",
      userId: BANNED,
      emailKey: null,
      scope: "permanent",
      reason: "fixture",
      actor: "test",
      expiresAt: null,
      createdAt: NOW - 1,
    });

    const { response } = await getLeaderboard("class=c172s&assist=none&scoring=scoring-v1");
    const body = await response.json() as { data: { entries: { resultId: string }[] } };
    expect(body.data.entries.map((entry) => entry.resultId)).toEqual([resultId("10")]);
    expect(JSON.stringify(body.data)).not.toContain("@example");
    expect(JSON.stringify(body.data)).not.toContain("center_lat");
  });

  it("uses one canonical key and serves the permitted stale page until the 60-second entry expires", async () => {
    await seedResult({ resultId: resultId("20"), missionId: missionId("20"), userId: ALPHA, score: 80_000 });
    const cache = cacheDouble();
    const first = await getLeaderboard("scoring=scoring-v1&class=c172s&assist=none", cache);
    expect(first.response.headers.get("x-leaderboard-cache")).toBe("MISS");
    expect(cache.put).toHaveBeenCalledOnce();
    const cachedResponse = cache.put.mock.calls[0]?.[1] as Response;
    expect(cachedResponse.headers.get("cache-control")).toBe("public, s-maxage=60");

    await seedResult({ resultId: resultId("21"), missionId: missionId("21"), userId: BRAVO, score: 95_000 });
    const second = await getLeaderboard("assist=none&class=c172s&scoring=scoring-v1", cache);
    expect(second.response.headers.get("x-leaderboard-cache")).toBe("HIT");
    const body = await second.response.json() as { data: { entries: { resultId: string }[] } };
    expect(body.data.entries.map((entry) => entry.resultId)).toEqual([resultId("20")]);
    expect(cache.match.mock.calls[0]?.[0].url).toBe(cache.match.mock.calls[1]?.[0].url);
  });

  it("rejects a cached page from a different partition and falls back to D1", async () => {
    await seedResult({ resultId: resultId("30"), missionId: missionId("30"), userId: ALPHA, score: 88_000 });
    const cache = cacheDouble();
    const first = await getLeaderboard("class=c172s&assist=none&scoring=scoring-v1", cache);
    expect(first.response.status).toBe(200);
    const key = cache.put.mock.calls[0]?.[0] as Request;
    cache.stored.set(key.url, Response.json({
      schemaVersion: 1,
      partition: { classId: "b738", highestAssist: "none", scoringVersion: "scoring-v1" },
      entries: [],
      nextCursor: null,
      cacheTtlSeconds: 60,
      minimumPollSeconds: 15,
    }));

    const second = await getLeaderboard("class=c172s&assist=none&scoring=scoring-v1", cache);
    expect(second.response.headers.get("x-leaderboard-cache")).toBe("MISS");
    const body = await second.response.json() as { data: { entries: { resultId: string }[] } };
    expect(body.data.entries).toEqual([expect.objectContaining({ resultId: resultId("30") })]);
    expect(cache.put).toHaveBeenCalledTimes(2);
  });
});
