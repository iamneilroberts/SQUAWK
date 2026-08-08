import { describe, it, expect } from "vitest";
import { isIcaoStation, nearestIcaoStation } from "./metarStation";
import { loadAirports, type Airport } from "./airports";

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

  it("finds a real nearby station in the bundled data from a known position", () => {
    // Mobile, AL — KMOB is the field there, so the nearest ICAO station must be close.
    const near = nearestIcaoStation(30.6912, -88.2428, loadAirports())!;
    expect(near).not.toBeNull();
    expect(near.airport.ident).toBe("KMOB");
  });
});
