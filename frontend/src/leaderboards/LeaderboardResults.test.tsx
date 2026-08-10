import { describe, expect, it } from "vitest";

import LeaderboardResults from "./LeaderboardResults";
import type { LeaderboardPage } from "./types";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) collectText(child, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (value: unknown) => unknown)(props), out);
  const children = props as { children?: unknown } | undefined;
  if (children && "children" in children) collectText(children.children, out);
  return out;
}

const page: LeaderboardPage = {
  schemaVersion: 1,
  partition: { classId: "c172s", highestAssist: "none", scoringVersion: "scoring-v1" },
  entries: [{
    resultId: "90000000-0000-4000-8000-000000000001",
    rank: 1,
    userId: "11111111-1111-4111-8111-111111111111",
    handle: "SkyPilot",
    score: 92.5,
    completedAt: 1_700_000_000_000,
  }],
  nextCursor: "opaque",
  cacheTtlSeconds: 60,
  minimumPollSeconds: 15,
};

describe("LeaderboardResults", () => {
  it("shows rank, privacy-safe handle, score, and exact partition", () => {
    const text = collectText(LeaderboardResults({ page })).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("C172S");
    expect(text).toContain("OFF");
    expect(text).toContain("scoring-v1");
    expect(text).toContain("SkyPilot");
    expect(text).toContain("92.5");
    expect(text).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  it("has an explicit empty partition state", () => {
    const text = collectText(LeaderboardResults({ page: { ...page, entries: [] } })).join(" ");
    expect(text).toContain("NO ELIGIBLE RESULTS");
  });
});
