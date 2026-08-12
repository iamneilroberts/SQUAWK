import { describe, expect, it } from "vitest";
import { routeStartPoint } from "./missionRoutePath";

const mission = {
  contact: { lat: 30.5, lon: -88.1, alt_geom: 4500, alt_baro: 4400 },
};

describe("routeStartPoint", () => {
  it("uses the live snapshot position when flying", () => {
    const snapshot = { latDeg: 30.7, lonDeg: -88.0, altitudeM: 914.4 };
    expect(routeStartPoint(snapshot, mission)).toEqual({
      latDeg: 30.7,
      lonDeg: -88.0,
      altitudeFt: 3000,
    });
  });

  it("falls back to the contact position before the sim publishes a snapshot", () => {
    expect(routeStartPoint(null, mission)).toEqual({
      latDeg: 30.5,
      lonDeg: -88.1,
      altitudeFt: 4500,
    });
  });

  it("prefers alt_geom, tolerates the readsb string alt_baro, and never fabricates", () => {
    expect(
      routeStartPoint(null, { contact: { lat: 1, lon: 2, alt_geom: null, alt_baro: 4400 } })
        .altitudeFt,
    ).toBe(4400);
    expect(
      routeStartPoint(null, { contact: { lat: 1, lon: 2, alt_geom: null, alt_baro: "ground" } })
        .altitudeFt,
    ).toBe(0);
  });
});
