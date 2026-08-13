import { describe, it, expect } from "vitest";
import {
  PLACE_LABEL_MAX, loadPlaces, placeLabelText, validatePlaces, visiblePlaces, type Place,
} from "./places";

const PLACES = loadPlaces();
// Camera centre over Mobile, AL — the home region.
const MOBILE = { centerLatDeg: 30.694, centerLonDeg: -88.043 };

describe("the curated Gulf Coast places", () => {
  it("validates against the schema the app expects", () => {
    expect(() => validatePlaces(PLACES)).not.toThrow();
  });
  it("holds a curated regional set, not an empty stub or a global dump", () => {
    expect(PLACES.length).toBeGreaterThan(40);
    expect(PLACES.length).toBeLessThan(200);
  });
  it("is real data — the obvious Gulf Coast places are in it", () => {
    const names = new Set(PLACES.map((p) => p.name));
    expect(names.has("Mobile")).toBe(true);
    expect(names.has("Pensacola")).toBe(true);
    expect(names.has("Mobile Bay")).toBe(true);
    expect(names.has("Dauphin Island")).toBe(true);
  });
  it("carries both towns and landmarks", () => {
    expect(PLACES.some((p) => p.kind === "town")).toBe(true);
    expect(PLACES.some((p) => p.kind === "landmark")).toBe(true);
  });
  it("sits inside the Gulf Coast bounding box", () => {
    for (const p of PLACES) {
      expect(p.latDeg).toBeGreaterThan(28.5);
      expect(p.latDeg).toBeLessThan(32.0);
      expect(p.lonDeg).toBeGreaterThan(-91.5);
      expect(p.lonDeg).toBeLessThan(-84.5);
    }
  });
  it("rejects a malformed record instead of shipping it to Cesium", () => {
    expect(() => validatePlaces([{ name: "X", kind: "city", latDeg: 30, lonDeg: -88 }])).toThrow();
    expect(() => validatePlaces([{ name: "", kind: "town", latDeg: 30, lonDeg: -88 }])).toThrow();
  });
});

describe("visiblePlaces — declutter", () => {
  it("shows nothing from orbit", () => {
    expect(visiblePlaces({ places: PLACES, cameraHeightM: 600_000, ...MOBILE })).toEqual([]);
  });
  it("shows nearby places when flying over the region", () => {
    const shown = visiblePlaces({ places: PLACES, cameraHeightM: 1_500, ...MOBILE });
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.map((p) => p.name)).toContain("Mobile");
  });
  it("puts the nearest place first", () => {
    const shown = visiblePlaces({ places: PLACES, cameraHeightM: 1_500, ...MOBILE });
    expect(shown[0]?.name).toBe("Mobile");
  });
  it("caps the number of labels", () => {
    const shown = visiblePlaces({ places: PLACES, cameraHeightM: 1_500, ...MOBILE, maxLabels: 5 });
    expect(shown).toHaveLength(5);
    expect(shown.length).toBeLessThanOrEqual(PLACE_LABEL_MAX);
  });
  it("shows nothing when the flight has wandered far from the Gulf Coast", () => {
    // Camera over the Great Lakes — every curated place is well beyond the range gate.
    const shown = visiblePlaces({ places: PLACES, cameraHeightM: 1_500, centerLatDeg: 43.0, centerLonDeg: -87.9 });
    expect(shown).toEqual([]);
  });
});

describe("placeLabelText", () => {
  it("uppercases for the terminal look", () => {
    const p: Place = { name: "Mobile Bay", kind: "landmark", latDeg: 30.4, lonDeg: -88.0 };
    expect(placeLabelText(p)).toBe("MOBILE BAY");
  });
});
