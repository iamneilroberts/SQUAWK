import { describe, it, expect } from "vitest";
import {
  formatUtcClock, feedChipLabel, aisChipLabel, terrainChipClass, nextRadius, radiusChipLabel,
  basemapChipLabel, labelsChipLabel, aircraftChipLabel, nextBasemap, contactsChipLabel,
  statusBarRegions,
} from "./StatusBar";

describe("statusBarRegions (immersive collapse)", () => {
  it("keeps feed-status and attribution in every mode (honesty + attribution rules)", () => {
    expect(statusBarRegions(false).feedStatus).toBe(true);
    expect(statusBarRegions(false).attribution).toBe(true);
    expect(statusBarRegions(true).feedStatus).toBe(true);
    expect(statusBarRegions(true).attribution).toBe(true);
  });
  it("shows the browse controls and clock in normal mode (desktop unchanged)", () => {
    expect(statusBarRegions(false).browseControls).toBe(true);
    expect(statusBarRegions(false).clock).toBe(true);
  });
  it("hides the browse controls and clock in immersive mode", () => {
    // Broken arm: leaving browseControls true in immersive would keep RADIUS/MAP/LABELS chrome.
    expect(statusBarRegions(true).browseControls).toBe(false);
    expect(statusBarRegions(true).clock).toBe(false);
  });
  it("hides the API debug chip only while BOTH immersive and decluttered (#89 follow-up)", () => {
    expect(statusBarRegions(true, true).apiDebug).toBe(false);
    expect(statusBarRegions(true, false).apiDebug).toBe(true);
    expect(statusBarRegions(false, true).apiDebug).toBe(true);
    expect(statusBarRegions(false, false).apiDebug).toBe(true);
  });
  it("never lets decluttered hide feed-status or attribution (honesty + attribution rules)", () => {
    expect(statusBarRegions(true, true).feedStatus).toBe(true);
    expect(statusBarRegions(true, true).attribution).toBe(true);
  });
});

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

describe("aisChipLabel", () => {
  it("shows AIS LIVE plus the active source", () => {
    expect(aisChipLabel("live", "aisstream.io")).toBe("AIS LIVE aisstream.io");
  });
  it("shows an em-dash source rather than inventing one", () => {
    expect(aisChipLabel("live", null)).toBe("AIS LIVE —");
  });
  it("is AIS STALE / AIS OFFLINE otherwise", () => {
    expect(aisChipLabel("stale", "x")).toBe("AIS STALE");
    expect(aisChipLabel("offline", null)).toBe("AIS OFFLINE");
  });
  it("shows AIS NO DATA plus the source when connected but silent", () => {
    // Distinct from both LIVE (confidently flowing) and OFFLINE (socket down) —
    // aisstream's keepalive holds the socket open through an upstream outage.
    expect(aisChipLabel("nodata", "aisstream.io")).toBe("AIS NO DATA aisstream.io");
  });
  it("shows an em-dash source for nodata rather than inventing one", () => {
    expect(aisChipLabel("nodata", null)).toBe("AIS NO DATA —");
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

describe("basemap and labels chips", () => {
  it("names the active basemap", () => {
    expect(basemapChipLabel("SAT")).toBe("MAP SAT");
    expect(basemapChipLabel("CHART")).toBe("MAP CHART");
  });
  it("toggles between the two basemaps", () => {
    expect(nextBasemap("SAT")).toBe("CHART");
    expect(nextBasemap("CHART")).toBe("SAT");
  });
  it("states the labels layer's actual state, both ways", () => {
    expect(labelsChipLabel(true)).toBe("LABELS ON");
    expect(labelsChipLabel(false)).toBe("LABELS OFF");
  });
  it("states the other-aircraft visibility state, both ways (#85)", () => {
    expect(aircraftChipLabel(true)).toBe("AIRCRAFT");
    expect(aircraftChipLabel(false)).toBe("AIRCRAFT HIDDEN");
  });
});

describe("contactsChipLabel", () => {
  it("shows the live count in brackets for the mobile drawer toggle (#13 §2.1)", () => {
    expect(contactsChipLabel(0)).toBe("CONTACTS [0]");
    expect(contactsChipLabel(37)).toBe("CONTACTS [37]");
  });
});
