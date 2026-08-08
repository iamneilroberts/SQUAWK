import { describe, it, expect } from "vitest";
import {
  NAV_RANGE_PRESETS_NM, DEFAULT_NAV_RANGE_NM, NAV_RADIUS_PX, MAX_NAV_AIRPORTS,
  navXY, airportBlips, navContacts, navStatus,
} from "./navMath";
import type { Airport } from "../data/airports";
import type { Contact } from "../data/types";

const own = { latDeg: 30.0, lonDeg: -88.0 };

const ap = (o: Partial<Airport> = {}): Airport => ({
  ident: "KMOB", iata: "MOB", name: "Mobile", latDeg: 30.05, lonDeg: -88.0, size: "large", ...o,
});
const airportsOf = (...xs: Airport[]) => xs;

const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.05, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});
const mapOf = (...cs: Contact[]) => new Map(cs.map((x) => [x.hex, x]));

describe("nav range presets", () => {
  it("offer a zoom ladder with the default on it", () => {
    expect([...NAV_RANGE_PRESETS_NM]).toEqual([10, 25, 50, 100, 200]);
    expect(NAV_RANGE_PRESETS_NM).toContain(DEFAULT_NAV_RANGE_NM);
  });
});

describe("navXY — own-ship centred, NORTH UP (this is what distinguishes it from the radar)", () => {
  it("puts a feature due north at the top", () => {
    const p = navXY({ rangeNm: 25, bearingDeg: 0, navRangeNm: 50 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-NAV_RADIUS_PX / 2, 6);
  });

  it("puts a feature due east on the RIGHT — north-up, so bearing alone places it", () => {
    const p = navXY({ rangeNm: 50, bearingDeg: 90, navRangeNm: 50 });
    expect(p.x).toBeCloseTo(NAV_RADIUS_PX, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("puts a feature due south at the bottom", () => {
    const p = navXY({ rangeNm: 50, bearingDeg: 180, navRangeNm: 50 });
    expect(p.y).toBeCloseTo(NAV_RADIUS_PX, 6);
  });

  it("scales linearly, hitting the rim at the selected range", () => {
    const half = navXY({ rangeNm: 25, bearingDeg: 0, navRangeNm: 50 });
    const rim = navXY({ rangeNm: 50, bearingDeg: 0, navRangeNm: 50 });
    expect(Math.abs(half.y)).toBeCloseTo(NAV_RADIUS_PX / 2, 6);
    expect(Math.abs(rim.y)).toBeCloseTo(NAV_RADIUS_PX, 6);
  });

  it("puts own ship exactly at the centre", () => {
    const p = navXY({ rangeNm: 0, bearingDeg: 0, navRangeNm: 50 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe("airportBlips — the feature that makes this a MAP, not a traffic scope", () => {
  const run = (airports: Airport[], o: Record<string, unknown> = {}) =>
    airportBlips({ airports, own, navRangeNm: 50, ...o });

  it("shows nothing when nothing is in range", () => {
    expect(run(airportsOf())).toEqual([]);
  });

  it("plots an airport inside the selected range and carries its label + size", () => {
    const blips = run(airportsOf(ap()));
    expect(blips).toHaveLength(1);
    expect(blips[0].ident).toBe("KMOB");
    expect(blips[0].label).toBe("MOB"); // IATA where there is one
    expect(blips[0].size).toBe("large");
    expect(blips[0].rangeNm).toBeCloseTo(3, 0);
  });

  it("labels with the ICAO ident when there is no IATA code", () => {
    expect(run(airportsOf(ap({ iata: null, ident: "07FA" })))[0].label).toBe("07FA");
  });

  it("drops an airport beyond the selected range", () => {
    expect(run(airportsOf(ap({ latDeg: 32.0 })), { navRangeNm: 25 })).toEqual([]);
    expect(run(airportsOf(ap({ latDeg: 32.0 })), { navRangeNm: 200 })).toHaveLength(1);
  });

  it("caps the count and keeps the NEAREST when it has to", () => {
    const many = Array.from({ length: MAX_NAV_AIRPORTS + 5 }, (_, i) =>
      ap({ ident: `AP${i}`, iata: null, latDeg: 30.0 + (i + 1) * 0.01 }));
    const blips = run(many, { navRangeNm: 200 });
    expect(blips).toHaveLength(MAX_NAV_AIRPORTS);
    expect(blips[0].ident).toBe("AP0");
    expect(blips.map((b) => b.ident)).not.toContain(`AP${MAX_NAV_AIRPORTS + 4}`);
  });
});

describe("navContacts — same honest traffic as the radar, but NORTH UP", () => {
  const run = (contacts: Map<string, Contact>, o: Record<string, unknown> = {}) =>
    navContacts({ contacts, own, navRangeNm: 50, ghostHex: null, ...o });

  it("shows nothing when the feed has nothing — no residual plots", () => {
    expect(run(new Map())).toEqual([]);
  });

  it("plots a contact due east on the RIGHT — north-up, never rotated by own heading", () => {
    const east = run(mapOf(c({ lat: 30.0, lon: -87.9 })))[0];
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeCloseTo(0, 1);
  });

  it("carries the military and ghost flags through", () => {
    expect(run(mapOf(c({ military: true })))[0].military).toBe(true);
    expect(run(mapOf(c()), { ghostHex: "a1b2c3" })[0].ghost).toBe(true);
  });
});

describe("navStatus — airports are bundled and stay honest; only TRAFFIC can freeze", () => {
  it("says nothing extra when the feed is live", () => {
    expect(navStatus("live")).toEqual({ text: null, dim: false });
  });
  it("states the offline case and that only traffic is frozen (the airports are not a feed)", () => {
    expect(navStatus("offline").text).toBe("FEED OFFLINE · TRAFFIC FROZEN");
    expect(navStatus("offline").dim).toBe(true);
  });
  it("says traffic is frozen when the feed is stale", () => {
    expect(navStatus("stale").text).toBe("FEED STALE · TRAFFIC FROZEN");
    expect(navStatus("stale").dim).toBe(true);
  });
});
