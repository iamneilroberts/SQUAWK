import { describe, it, expect } from "vitest";
import { rangeNm, bearingDeg } from "./geoRange";

describe("rangeNm", () => {
  it("makes one degree of latitude 60 nautical miles — that is the definition", () => {
    expect(rangeNm(30, -88, 31, -88)).toBeCloseTo(60, 0);
  });
  it("is zero for the same point", () => {
    expect(rangeNm(30.6944, -88.0399, 30.6944, -88.0399)).toBeCloseTo(0, 6);
  });
  it("is symmetric", () => {
    expect(rangeNm(30, -88, 41, -74)).toBeCloseTo(rangeNm(41, -74, 30, -88), 6);
  });
  it("agrees with a known long leg (JFK -> LHR is about 3000 NM)", () => {
    expect(rangeNm(40.64, -73.78, 51.47, -0.45)).toBeGreaterThan(2900);
    expect(rangeNm(40.64, -73.78, 51.47, -0.45)).toBeLessThan(3050);
  });
});

describe("bearingDeg", () => {
  it("is 000 due north and 180 due south", () => {
    expect(bearingDeg(30, -88, 31, -88)).toBeCloseTo(0, 3);
    expect(bearingDeg(30, -88, 29, -88)).toBeCloseTo(180, 3);
  });
  it("is 090 due east and 270 due west", () => {
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 3);
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 3);
  });
  it("always lands in [0, 360)", () => {
    for (const [la, lo] of [[31, -87], [29, -89], [30, -89], [31, -89]] as const) {
      const b = bearingDeg(30, -88, la, lo);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
  it("is 000 for the same point rather than NaN", () => {
    expect(bearingDeg(30, -88, 30, -88)).toBe(0);
  });
});
