import { describe, it, expect } from "vitest";
import { formatUtcClock, feedChipLabel } from "./StatusBar";

describe("formatUtcClock", () => {
  it("renders HH:MM:SSZ from a UTC instant", () => {
    expect(formatUtcClock(new Date("2026-07-27T03:04:05.000Z"))).toBe("03:04:05Z");
  });
});

describe("feedChipLabel", () => {
  it("shows LIVE plus the active source", () => {
    expect(feedChipLabel("live", "airplanes.live")).toBe("LIVE airplanes.live");
  });
  it("shows an em-dash source rather than inventing one", () => {
    expect(feedChipLabel("live", null)).toBe("LIVE —");
  });
  it("is bare STALE / OFFLINE otherwise", () => {
    expect(feedChipLabel("stale", "x")).toBe("STALE");
    expect(feedChipLabel("offline", "x")).toBe("OFFLINE");
  });
});
