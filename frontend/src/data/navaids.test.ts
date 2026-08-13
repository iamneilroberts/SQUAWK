import { describe, it, expect } from "vitest";
import {
  NAVAID_LABEL_MAX, loadNavaids, navaidLabelText, validateNavaids, visibleNavaids, type Navaid,
} from "./navaids";

const NAVAIDS = loadNavaids();
const MOBILE = { centerLatDeg: 30.694, centerLonDeg: -88.043 };

describe("the bundled Gulf Coast VOR-family navaids", () => {
  it("validates against the schema the app expects", () => {
    expect(() => validateNavaids(NAVAIDS)).not.toThrow();
  });
  it("holds a regional set, not empty and not the whole global file", () => {
    expect(NAVAIDS.length).toBeGreaterThan(20);
    expect(NAVAIDS.length).toBeLessThan(500);
  });
  it("is VOR family only — no NDBs or other types slipped through", () => {
    const allowed = new Set(["VOR", "VOR-DME", "VORTAC", "TACAN"]);
    for (const n of NAVAIDS) expect(allowed.has(n.type)).toBe(true);
  });
  it("sits inside the Gulf Coast region", () => {
    for (const n of NAVAIDS) {
      expect(n.latDeg).toBeGreaterThan(26);
      expect(n.latDeg).toBeLessThan(34);
      expect(n.lonDeg).toBeGreaterThan(-95.5);
      expect(n.lonDeg).toBeLessThan(-81.5);
    }
  });
  it("rejects a malformed record instead of shipping it to Cesium", () => {
    expect(() => validateNavaids([{ ident: "", type: "VOR", latDeg: 30, lonDeg: -88 }])).toThrow();
    expect(() => validateNavaids([{ ident: "X", type: "", latDeg: 30, lonDeg: -88 }])).toThrow();
  });
});

describe("visibleNavaids — declutter", () => {
  it("shows nothing from orbit", () => {
    expect(visibleNavaids({ navaids: NAVAIDS, cameraHeightM: 600_000, ...MOBILE })).toEqual([]);
  });
  it("shows nearby navaids when flying over the region", () => {
    const shown = visibleNavaids({ navaids: NAVAIDS, cameraHeightM: 3_000, ...MOBILE });
    expect(shown.length).toBeGreaterThan(0);
  });
  it("puts the nearest navaid first and caps the count", () => {
    const shown = visibleNavaids({ navaids: NAVAIDS, cameraHeightM: 3_000, ...MOBILE, maxLabels: 4 });
    expect(shown).toHaveLength(4);
    expect(shown.length).toBeLessThanOrEqual(NAVAID_LABEL_MAX);
    const nearestOfAll = [...NAVAIDS]
      .map((n) => ({ n, r: Math.hypot(n.latDeg - MOBILE.centerLatDeg, n.lonDeg - MOBILE.centerLonDeg) }))
      .sort((a, b) => a.r - b.r)[0]?.n.ident;
    expect(shown[0]?.ident).toBe(nearestOfAll);
  });
  it("shows nothing when the flight is far from the region", () => {
    const shown = visibleNavaids({ navaids: NAVAIDS, cameraHeightM: 3_000, centerLatDeg: 43.0, centerLonDeg: -87.9 });
    expect(shown).toEqual([]);
  });
});

describe("navaidLabelText", () => {
  it("reads the charted ident, uppercased", () => {
    const n: Navaid = { ident: "sji", name: "Semmes", type: "VORTAC", latDeg: 30.7, lonDeg: -88.35 };
    expect(navaidLabelText(n)).toBe("SJI");
  });
});
