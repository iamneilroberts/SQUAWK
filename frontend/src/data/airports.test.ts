import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  AIRPORT_LABEL_MAX, airportGlobeLabel, airportLabelText, loadAirports, shortenAirportName,
  validateAirports, visibleAirports, type Airport,
} from "./airports";

const AIRPORTS = loadAirports();
const ap = (o: Partial<Airport> = {}): Airport => ({
  ident: "KMOB", iata: "MOB", name: "Mobile Regional Airport",
  latDeg: 30.6912, lonDeg: -88.2428, size: "medium", ...o,
});

describe("the bundled OurAirports extract", () => {
  it("validates against the schema the app expects", () => {
    expect(() => validateAirports(AIRPORTS)).not.toThrow();
  });

  it("holds a plausible number of airports — large + medium, not the whole 80k file", () => {
    expect(AIRPORTS.length).toBeGreaterThan(3000);
    expect(AIRPORTS.length).toBeLessThan(12000);
  });

  it("contains only large and medium airports", () => {
    expect(new Set(AIRPORTS.map((a) => a.size))).toEqual(new Set(["large", "medium"]));
  });

  it("has a usable ident and an in-range position for every record", () => {
    for (const a of AIRPORTS) {
      expect(a.ident.length).toBeGreaterThan(0);
      expect(Number.isFinite(a.latDeg) && a.latDeg >= -90 && a.latDeg <= 90).toBe(true);
      expect(Number.isFinite(a.lonDeg) && a.lonDeg >= -180 && a.lonDeg <= 180).toBe(true);
    }
  });

  it("is real data, not a stub — the obvious airports are in it", () => {
    const idents = new Set(AIRPORTS.map((a) => a.ident));
    for (const known of ["KJFK", "EGLL", "KMOB"]) expect(idents.has(known)).toBe(true);
  });

  it("stays inside the bundle budget", () => {
    const bytes = readFileSync("src/data/airports-world.json").byteLength;
    expect(bytes).toBeLessThan(600_000);
  });

  it("rejects a malformed record instead of shipping it to Cesium", () => {
    expect(() => validateAirports([{ ident: "X", latDeg: "north" }])).toThrow();
    expect(() => validateAirports([{ ...ap(), size: "tiny" }])).toThrow(/size/);
  });
});

describe("visibleAirports — declutter by camera height", () => {
  const airports = [
    ap({ ident: "KMOB", size: "medium", latDeg: 30.69, lonDeg: -88.24 }),
    ap({ ident: "KATL", size: "large", latDeg: 33.64, lonDeg: -84.43 }),
    ap({ ident: "KPNS", size: "medium", latDeg: 30.47, lonDeg: -87.19 }),
  ];
  const at = (cameraHeightM: number, maxLabels = AIRPORT_LABEL_MAX) =>
    visibleAirports({
      airports, cameraHeightM, centerLatDeg: 30.69, centerLonDeg: -88.24, maxLabels,
    }).map((a) => a.ident);

  it("shows nothing from orbit — a whole-globe label soup is not information", () => {
    expect(at(900_000)).toEqual([]);
  });

  it("shows only the large airports from high up", () => {
    expect(at(300_000)).toEqual(["KATL"]);
  });

  it("brings the medium airports in below the 40 km tier boundary", () => {
    expect(at(30_000).sort()).toEqual(["KATL", "KMOB", "KPNS"]);
  });

  it("still shows large airports only just ABOVE that boundary", () => {
    expect(at(50_000)).toEqual(["KATL"]);
  });

  it("caps the labels, nearest to the camera centre first", () => {
    expect(at(30_000, 2)).toEqual(["KMOB", "KPNS"]);
  });
});

describe("shortenAirportName — readable names, not code soup", () => {
  it("abbreviates the common long words and drops a trailing 'Airport'", () => {
    expect(shortenAirportName("Mobile Regional Airport", "KMOB", "MOB")).toBe("Mobile Rgnl");
    expect(shortenAirportName("Pensacola International Airport", "KPNS", "PNS")).toBe("Pensacola Intl");
    expect(shortenAirportName("Foley Municipal Airport", "5R4", null)).toBe("Foley Muni");
  });
  it("keeps a name that has nothing to abbreviate", () => {
    expect(shortenAirportName("Mobile Downtown", "KBFM", "BFM")).toBe("Mobile Downtown");
  });
  it("collapses the whitespace a dropped word leaves behind", () => {
    expect(shortenAirportName("Louis Armstrong New Orleans International Airport", "KMSY", "MSY"))
      .toBe("Louis Armstrong New Orleans Intl");
  });
  it("falls back to the code when the name is blank or only 'Airport'", () => {
    expect(shortenAirportName("", "KMOB", "MOB")).toBe("MOB");
    expect(shortenAirportName("Airport", "KMOB", null)).toBe("KMOB");
  });
});

describe("airportLabelText — the compact tactical-scope code", () => {
  it("prefers the IATA code, which is what a pilot reads on a chart", () => {
    expect(airportLabelText(ap({ ident: "KMOB", iata: "MOB" }))).toBe("MOB");
  });
  it("falls back to the ICAO ident when there is no IATA code — never to a blank", () => {
    expect(airportLabelText(ap({ ident: "KMOB", iata: null }))).toBe("KMOB");
  });
});

describe("airportGlobeLabel — the shortened name for globe labels", () => {
  it("reads the shortened NAME, uppercased for the terminal look", () => {
    expect(airportGlobeLabel(ap({ name: "Mobile Regional Airport" }))).toBe("MOBILE RGNL");
  });
  it("falls back to the code when there is no usable name", () => {
    expect(airportGlobeLabel(ap({ name: "", iata: "MOB" }))).toBe("MOB");
    expect(airportGlobeLabel(ap({ name: "", iata: null, ident: "KMOB" }))).toBe("KMOB");
  });
});
