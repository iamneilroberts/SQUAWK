import { describe, it, expect } from "vitest";
import { formatUtcClock, feedChipLabel, terrainChipClass, nextRadius, radiusChipLabel } from "./StatusBar";

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

describe("terrainChipClass", () => {
  it("is nominal cyan for a resolved terrain source, including the ion fallback", () => {
    expect(terrainChipClass("RE:EARTH TERRAIN · MAPTERHORN CC BY 4.0")).toBe("status-chip-live");
    expect(terrainChipClass("TERRAIN: CESIUM ION (FALLBACK)")).toBe("status-chip-live");
  });
  it("is the amber warning for the flat-ellipsoid fallback", () => {
    expect(terrainChipClass("TERRAIN UNAVAILABLE — FLAT ELLIPSOID")).toBe("status-chip-warn");
  });
  it("treats null (not yet attached) as nominal, not a warning", () => {
    expect(terrainChipClass(null)).toBe("status-chip-live");
  });
});

describe("nextRadius", () => {
  it("cycles the preset ladder 40 -> 80 -> 150 -> 250 -> 40", () => {
    expect(nextRadius(40)).toBe(80);
    expect(nextRadius(80)).toBe(150);
    expect(nextRadius(150)).toBe(250);
    expect(nextRadius(250)).toBe(40);
  });
  it("falls back to the first preset for an unrecognized value", () => {
    expect(nextRadius(999)).toBe(40);
  });
});

describe("radiusChipLabel", () => {
  it("formats as RADIUS <n> NM", () => {
    expect(radiusChipLabel(80)).toBe("RADIUS 80 NM");
    expect(radiusChipLabel(250)).toBe("RADIUS 250 NM");
  });
});
