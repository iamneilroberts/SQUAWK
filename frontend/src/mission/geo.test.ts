import { describe, expect, it } from "vitest";
import { destinationPoint, greatCircleDistanceNm, headingDeltaDeg, initialBearingDeg, normalizeLongitude } from "./geo";

describe("mission geodesy", () => {
  it("uses the short path across the antimeridian", () => {
    expect(greatCircleDistanceNm(10, 179.9, 10, -179.9)).toBeLessThan(12);
    expect(normalizeLongitude(181)).toBe(-179);
  });

  it("stays finite near the poles", () => {
    for (const longitude of [-179, -90, 0, 90, 179]) {
      const distance = greatCircleDistanceNm(89.999, 0, 89.999, longitude);
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeGreaterThanOrEqual(0);
    }
  });

  it("round-trips generated points over representative bearings and ranges", () => {
    for (const latitude of [-80, -10, 0, 45, 80]) {
      for (const bearing of [0, 45, 90, 179, 270, 359]) {
        for (const distance of [0.1, 5, 60, 200]) {
          const point = destinationPoint(latitude, 179.5, bearing, distance);
          expect(greatCircleDistanceNm(latitude, 179.5, point.latDeg, point.lonDeg)).toBeCloseTo(distance, 8);
        }
      }
    }
  });

  it("normalizes heading comparisons at north", () => {
    expect(headingDeltaDeg(359, 1)).toBe(2);
    expect(initialBearingDeg(0, 179, 0, -179)).toBeCloseTo(90, 8);
  });
});
