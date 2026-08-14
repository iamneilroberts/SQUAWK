import { describe, it, expect } from "vitest";
import {
  CHART_URL, PLACES_URL, SAT_URL, attributionFor,
} from "./mapSources";

describe("imagery sources are keyless Esri REST services", () => {
  it("carry no token, key or secret in the URL", () => {
    for (const url of [SAT_URL, CHART_URL, PLACES_URL]) {
      expect(url.startsWith("https://")).toBe(true);
      expect(url).not.toMatch(/token|api[_-]?key|access[_-]?token|\?/i);
    }
  });
  it("are the exact services the spec names", () => {
    expect(SAT_URL).toBe(
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer");
    expect(CHART_URL).toBe(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer");
    expect(PLACES_URL).toBe(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer");
  });
});

describe("attributionFor", () => {
  const terrainNote = "RE:EARTH TERRAIN · MAPTERHORN CC BY 4.0";

  it("names the satellite basemap and the terrain and the traffic feeds", () => {
    const line = attributionFor({ basemap: "SAT", labelsOn: false, terrainNote });
    expect(line).toContain("IMAGERY © ESRI");
    expect(line).toContain("MAPTERHORN");
    expect(line).toContain("AIRPLANES.LIVE");
  });

  it("changes when the basemap changes, rather than crediting a layer that is not on", () => {
    const chart = attributionFor({ basemap: "CHART", labelsOn: false, terrainNote });
    expect(chart).toContain("DARK GRAY CANVAS");
    expect(chart).not.toContain("IMAGERY © ESRI ·");
  });

  it("credits places and OurAirports ONLY when the labels layer is on", () => {
    const off = attributionFor({ basemap: "SAT", labelsOn: false, terrainNote });
    expect(off).not.toMatch(/OURAIRPORTS/i);
    expect(off).not.toMatch(/PLACES/i);
    const on = attributionFor({ basemap: "SAT", labelsOn: true, terrainNote });
    expect(on).toMatch(/OURAIRPORTS/i);
    expect(on).toMatch(/PLACES/i);
  });

  it("drops the public-domain OurAirports/places credits in compact flight mode, keeps the required ones (#81)", () => {
    const compact = attributionFor({ basemap: "SAT", labelsOn: true, terrainNote, compact: true });
    // Courtesy public-domain credits are dropped to fit the portrait flight strip...
    expect(compact).not.toMatch(/OURAIRPORTS/i);
    expect(compact).not.toMatch(/PLACES/i);
    // ...but the legally-required imagery + CC-BY terrain + traffic credits stay.
    expect(compact).toContain("IMAGERY © ESRI");
    expect(compact).toContain(terrainNote);
    expect(compact).toMatch(/TRAFFIC:/);
  });

  it("says the terrain is still loading rather than crediting a source that has not attached", () => {
    const line = attributionFor({ basemap: "SAT", labelsOn: false, terrainNote: null });
    expect(line).toContain("TERRAIN LOADING…");
  });

  it("keeps the terrain note verbatim, including the honest flat-ellipsoid fallback", () => {
    const line = attributionFor({
      basemap: "SAT", labelsOn: false, terrainNote: "TERRAIN UNAVAILABLE — FLAT ELLIPSOID",
    });
    expect(line).toContain("TERRAIN UNAVAILABLE — FLAT ELLIPSOID");
  });

  it("separates every credit with the same divider", () => {
    const line = attributionFor({ basemap: "SAT", labelsOn: true, terrainNote });
    expect(line.split(" · ").length).toBeGreaterThanOrEqual(5);
  });
});
