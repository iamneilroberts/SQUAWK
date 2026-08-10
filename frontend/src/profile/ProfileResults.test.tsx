import { describe, expect, it } from "vitest";

import ProfileResults from "./ProfileResults";
import type { ProfileClassStatistic, ProfileFlightHistoryEntry } from "./results";

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

const history: ProfileFlightHistoryEntry[] = [{
  resultId: "90000000-0000-4000-8000-000000000001",
  missionId: "80000000-0000-4000-8000-000000000001",
  completedAt: 1_700_000_000_000,
  classId: "c172s",
  outcome: "crashed",
  score: null,
  highestAssist: "none",
  evidenceStatus: "verified",
  ranked: false,
  failure: "SINK_RATE_EXCEEDED",
  scoringVersion: "scoring-v1",
}];

const statistics: ProfileClassStatistic[] = [{
  classId: "c172s",
  completedFlights: 3,
  successfulLandings: 2,
  rankedFlights: 1,
  bestScore: 92,
  averageScore: 88.5,
}];

describe("ProfileResults", () => {
  it("shows truthful class statistics and named unranked history failures", () => {
    const text = collectText(ProfileResults({ history, statistics })).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("CLASS STATISTICS");
    expect(text).toContain("C172S");
    expect(text).toContain("3 FLIGHTS");
    expect(text).toContain("BEST 92");
    expect(text).toContain("FLIGHT HISTORY");
    expect(text).toContain("SINK_RATE_EXCEEDED");
    expect(text).toContain("NOT RANKED");
  });

  it("has an explicit empty state", () => {
    const text = collectText(ProfileResults({ history: [], statistics: [] })).join(" ");
    expect(text).toContain("NO COMPLETED FLIGHTS");
  });
});
