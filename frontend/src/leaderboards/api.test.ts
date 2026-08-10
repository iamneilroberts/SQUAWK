import { afterEach, describe, expect, it, vi } from "vitest";

import { LeaderboardClientError, loadLeaderboard } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("leaderboard client", () => {
  it("requests one canonical bounded partition and reads the cadence contract", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "/api/leaderboards?class=c172s&assist=none&scoring=scoring-v1&limit=20",
      );
      return Response.json({
        ok: true,
        data: {
          schemaVersion: 1,
          partition: { classId: "c172s", highestAssist: "none", scoringVersion: "scoring-v1" },
          entries: [],
          nextCursor: null,
          cacheTtlSeconds: 60,
          minimumPollSeconds: 15,
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(loadLeaderboard({
      classId: "c172s",
      highestAssist: "none",
      scoringVersion: "scoring-v1",
    })).resolves.toMatchObject({ minimumPollSeconds: 15, cacheTtlSeconds: 60 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("refuses a malformed successful response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, data: { entries: [] } })));
    await expect(loadLeaderboard({
      classId: "c172s",
      highestAssist: "none",
      scoringVersion: "scoring-v1",
    })).rejects.toBeInstanceOf(LeaderboardClientError);
  });
});
