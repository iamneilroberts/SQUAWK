import { describe, expect, it } from "vitest";

import {
  cacheMetadataForSuccess,
  freshness,
  providerPriority,
  retryDelayMs,
  trafficCadenceSeconds,
  trafficData,
} from "./traffic";
import { normalizeRegion } from "./region";

const region = normalizeRegion(30, -88, 80, {
  cellDegrees: 0.25,
  providerRadiusStepNm: 25,
  providerMaxRadiusNm: 300,
});

describe("traffic policy", () => {
  it("uses the approved normal and conservation cadences", () => {
    expect(trafficCadenceSeconds({ kind: "anonymous" }, "normal")).toBe(15);
    expect(trafficCadenceSeconds({ kind: "signed", userId: "u" }, "normal")).toBe(8);
    expect(trafficCadenceSeconds({ kind: "anonymous" }, "conservation")).toBe(30);
    expect(trafficCadenceSeconds({ kind: "signed", userId: "u" }, "read-only")).toBe(15);
    expect(
      trafficCadenceSeconds(
        { kind: "active-ghost", userId: "u", missionId: "m", selectedHex: "abc123" },
        "read-only",
      ),
    ).toBe(12);
  });

  it("orders active ghost, multi-viewer signed, anonymous, then ambient", () => {
    expect(providerPriority({ kind: "active-ghost", userId: "u", missionId: "m", selectedHex: "a" }, 1)).toBe(0);
    expect(providerPriority({ kind: "signed", userId: "u" }, 2)).toBe(1);
    expect(providerPriority({ kind: "anonymous" }, 0)).toBe(2);
    expect(providerPriority({ kind: "ambient", userId: "u", missionId: "m" }, 0)).toBe(3);
  });

  it("backs off exponentially within the configured bound", () => {
    expect([1, 2, 3, 4, 20].map(retryDelayMs)).toEqual([15_000, 30_000, 60_000, 60_000, 60_000]);
  });

  it("never presents failed or expired cache data as live", () => {
    const nowMs = 1_000_000;
    const metadata = cacheMetadataForSuccess(
      region.regionKey,
      { source: "fake.test", sourceTime: 990, fetchedAt: 1_000 },
      nowMs,
    );
    expect(freshness(metadata, nowMs)).toBe("FRESH");
    expect(freshness({ ...metadata, providerAvailable: false }, nowMs)).toBe("STALE");
    expect(freshness(metadata, metadata.expiresAtMs)).toBe("EXPIRED");
    expect(
      trafficData(region, null, null, nowMs, 15, "MISS"),
    ).toMatchObject({ contacts: [], freshness: "EXPIRED", providerAvailable: false, cacheStatus: "EXPIRED" });
  });
});
