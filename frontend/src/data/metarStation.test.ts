import { describe, it, expect } from "vitest";
import { isIcaoStation, nearestIcaoStation, MAX_STATION_NM } from "./metarStation";
import { loadAirports, type Airport } from "./airports";
import { rangeNm } from "../dashboard/geoRange";

/** Latitude (deg) north of the equator whose great-circle range from (0,0) is `nm` — the exact
 *  inverse of rangeNm along a meridian, used to place a station just inside / outside the cap. */
const latAtNm = (nm: number) => (nm / 3440.065) * (180 / Math.PI);

const ap = (o: Partial<Airport> = {}): Airport => ({
  ident: "KMOB", iata: "MOB", name: "Mobile Rgnl", latDeg: 30.69, lonDeg: -88.24,
  size: "medium", ...o,
});

describe("isIcaoStation", () => {
  it("accepts a four-letter ICAO ident", () => {
    expect(isIcaoStation(ap({ ident: "KMOB" }))).toBe(true);
    expect(isIcaoStation(ap({ ident: "EGLL" }))).toBe(true);
  });
  it("rejects the OurAirports local idents that are not queryable ICAO stations", () => {
    for (const ident of ["5A8", "AR-0744", "07FA", "AXF"]) {
      expect(isIcaoStation(ap({ ident }))).toBe(false);
    }
  });
});

describe("nearestIcaoStation", () => {
  it("returns the closest ICAO station and its range", () => {
    const airports = [
      ap({ ident: "KMOB", latDeg: 30.69, lonDeg: -88.24 }),
      ap({ ident: "KPNS", latDeg: 30.47, lonDeg: -87.19 }),
      ap({ ident: "KATL", latDeg: 33.64, lonDeg: -84.43 }),
    ];
    const near = nearestIcaoStation(30.7, -88.2, airports)!;
    expect(near.airport.ident).toBe("KMOB");
    expect(near.rangeNm).toBeGreaterThan(0);
    expect(near.rangeNm).toBeLessThan(10);
  });

  it("skips a closer NON-ICAO ident in favour of the nearest real station", () => {
    // The local strip is right underneath us but is not an ICAO station we can pull a METAR for;
    // the honest pick is the queryable one a little further out, never the nearer un-queryable id.
    const airports = [
      ap({ ident: "5A8", latDeg: 30.70, lonDeg: -88.20 }),   // nearest by distance, not ICAO
      ap({ ident: "KMOB", latDeg: 30.69, lonDeg: -88.24 }),  // the real station
    ];
    expect(nearestIcaoStation(30.7, -88.2, airports)!.airport.ident).toBe("KMOB");
  });

  it("returns null when there is no ICAO station at all — an honest no-station, not a bad pick", () => {
    expect(nearestIcaoStation(0, 0, [ap({ ident: "5A8" }), ap({ ident: "AR-0744" })])).toBeNull();
  });

  it("selects a station just INSIDE the max-distance cap", () => {
    const lat = latAtNm(MAX_STATION_NM - 1); // ~1 NM inside the cap
    expect(rangeNm(0, 0, lat, 0)).toBeLessThan(MAX_STATION_NM); // guard: placement really is inside
    const airports = [ap({ ident: "KFAR", latDeg: lat, lonDeg: 0 })];
    const near = nearestIcaoStation(0, 0, airports)!;
    expect(near.airport.ident).toBe("KFAR");
    expect(near.rangeNm).toBeLessThan(MAX_STATION_NM);
  });

  it("treats a station just BEYOND the max-distance cap as out of coverage (no-station)", () => {
    const lat = latAtNm(MAX_STATION_NM + 1); // ~1 NM beyond the cap
    expect(rangeNm(0, 0, lat, 0)).toBeGreaterThan(MAX_STATION_NM); // guard: placement really is beyond
    const airports = [ap({ ident: "KFAR", latDeg: lat, lonDeg: 0 })];
    // A far station is a less-accurate reading, so beyond the cap the honest answer is "no station",
    // never a distant report shown as if it were local.
    expect(nearestIcaoStation(0, 0, airports)).toBeNull();
  });

  it("finds a real nearby station in the bundled data from a known position", () => {
    // Mobile, AL — KMOB is the field there, so the nearest ICAO station must be close.
    const near = nearestIcaoStation(30.6912, -88.2428, loadAirports())!;
    expect(near).not.toBeNull();
    expect(near.airport.ident).toBe("KMOB");
  });
});
