import { describe, expect, it } from "vitest";

import type { Contact } from "../../src/data/types";
import {
  clampTrafficRadiusNm,
  filterContactsToRequestedCircle,
  greatCircleDistanceNm,
  normalizeLongitude,
  normalizeRegion,
  type RegionConfig,
} from "./region";

const config: RegionConfig = {
  cellDegrees: 0.25,
  providerRadiusStepNm: 25,
  providerMaxRadiusNm: 300,
};

function contact(hex: string, lat: number, lon: number): Contact {
  return {
    hex,
    flight: null,
    t: null,
    lat,
    lon,
    alt_geom: null,
    alt_baro: null,
    gs: null,
    track: null,
    baro_rate: null,
    military: false,
    seen_pos: null,
  };
}

describe("normalized ADS-B regions", () => {
  it("shares a cell across both sides of an internal cell edge", () => {
    const left = normalizeRegion(30.124999, -88.124999, 80, config);
    const right = normalizeRegion(30.125001, -88.125001, 80, config);
    expect(left.regionKey).not.toBe(right.regionKey);

    for (const delta of [-0.124, -0.05, 0, 0.05, 0.124]) {
      const region = normalizeRegion(30 + delta, -88 + delta, 80, config);
      expect(region.providerRadiusNm).toBeLessThanOrEqual(config.providerMaxRadiusNm);
      expect(
        greatCircleDistanceNm(
          region.requestedCenter.lat,
          region.requestedCenter.lon,
          region.providerCenter.lat,
          region.providerCenter.lon,
        ) + region.radiusNm,
      ).toBeLessThanOrEqual(region.providerRadiusNm + 1e-9);
    }
  });

  it("wraps the antimeridian and canonicalizes both poles", () => {
    expect(normalizeLongitude(180)).toBe(-180);
    expect(normalizeLongitude(-181)).toBe(179);
    expect(normalizeRegion(90, 179, 20, config).providerCenter).toEqual({ lat: 90, lon: 0 });
    expect(normalizeRegion(-90, -179, 20, config).providerCenter).toEqual({ lat: -90, lon: 0 });
    expect(greatCircleDistanceNm(0, 179.9, 0, -179.9)).toBeLessThan(13);
  });

  it("rejects invalid coordinates and configuration", () => {
    for (const [lat, lon] of [
      [Number.NaN, 0],
      [91, 0],
      [-91, 0],
      [0, 181],
      [0, -181],
    ]) {
      expect(() => normalizeRegion(lat, lon, 80, config)).toThrow();
    }
    expect(() => normalizeRegion(0, 0, 80, { ...config, cellDegrees: 0 })).toThrow();
    expect(() => normalizeRegion(0, 0, 80, { ...config, providerMaxRadiusNm: 5 })).toThrow();
  });

  it("clamps display radii and never exceeds the provider maximum", () => {
    expect(clampTrafficRadiusNm(-1)).toBe(10);
    expect(clampTrafficRadiusNm(999)).toBe(250);
    for (let lat = -90; lat <= 90; lat += 5) {
      for (let lon = -180; lon <= 180; lon += 10) {
        for (const radius of [-50, 10, 80, 250, 999]) {
          const region = normalizeRegion(lat, lon, radius, config);
          expect(region.radiusNm).toBeGreaterThanOrEqual(10);
          expect(region.radiusNm).toBeLessThanOrEqual(250);
          expect(region.providerRadiusNm).toBeLessThanOrEqual(300);
        }
      }
    }
  });

  it("reduces a display radius only when needed to preserve provider coverage", () => {
    const constrained = normalizeRegion(30.124, -88.124, 250, {
      ...config,
      providerMaxRadiusNm: 250,
    });
    expect(constrained.radiusNm).toBeLessThan(250);
    expect(constrained.providerRadiusNm).toBe(250);
  });

  it("filters the normalized provider response back to the requested circle", () => {
    const region = normalizeRegion(0, 179.9, 20, config);
    const filtered = filterContactsToRequestedCircle(
      [contact("inside", 0, -179.9), contact("outside", 0, -170)],
      region,
    );
    expect(filtered.map(({ hex }) => hex)).toEqual(["inside"]);
  });
});
