import { describe, expect, it } from "vitest";

import { METAR_ATTRIBUTION, lookupMetar, shapeMetar } from "./metar";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("shapeMetar", () => {
  it("maps a full record, converting altimeter hPa to inHg and deriving the ceiling", () => {
    const shaped = shapeMetar({
      obsTime: 1_754_960_000,
      wdir: 140,
      wspd: 9,
      wgst: 17,
      visib: "10+",
      temp: 27.2,
      dewp: 23.3,
      altim: 1017.3,
      clouds: [
        { cover: "FEW", base: 1800 },
        { cover: "BKN", base: 3000 },
        { cover: "OVC", base: 4600 },
      ],
      fltCat: "VFR",
      name: "Mobile Rgnl",
      rawOb: "KMOB 120553Z 14009G17KT 10SM FEW018 BKN030 OVC046 27/23 A3004",
    });
    expect(shaped.windDirDeg).toBe(140);
    expect(shaped.windVariable).toBe(false);
    expect(shaped.windGustKt).toBe(17);
    expect(shaped.visibility).toBe("10+");
    expect(shaped.altimInHg).toBeCloseTo(30.04, 2);
    // Ceiling = lowest broken-or-worse layer; the FEW at 1800 does not count.
    expect(shaped.ceilingFt).toBe(3000);
    expect(shaped.raw).toContain("KMOB");
  });

  it("carries VRB wind as a flag, never a fake heading, and empties become null", () => {
    const shaped = shapeMetar({ wdir: "VRB", wspd: 3, name: " ", clouds: [] });
    expect(shaped.windVariable).toBe(true);
    expect(shaped.windDirDeg).toBeNull();
    expect(shaped.stationName).toBeNull();
    expect(shaped.ceilingFt).toBeNull();
    expect(shaped.tempC).toBeNull();
  });
});

describe("lookupMetar", () => {
  it("reports an upstream failure as available:false (NO FEED), never as no-METAR", async () => {
    const outage = await lookupMetar("KMOB", async () => {
      throw new Error("network down");
    });
    expect(outage).toEqual({
      icao: "KMOB",
      available: false,
      metar: null,
      attribution: METAR_ATTRIBUTION,
    });
    const httpError = await lookupMetar("KMOB", async () => jsonResponse([], 502));
    expect(httpError.available).toBe(false);
  });

  it("reports an empty array as a real no-METAR (available:true, metar:null)", async () => {
    const result = await lookupMetar("KMOB", async () => jsonResponse([]));
    expect(result.available).toBe(true);
    expect(result.metar).toBeNull();
  });

  it("shapes the first record of a real answer", async () => {
    const result = await lookupMetar("kmob", async () =>
      jsonResponse([{ wdir: 90, wspd: 5, altim: 1013.25 }]),
    );
    expect(result.icao).toBe("KMOB");
    expect(result.available).toBe(true);
    expect(result.metar?.windDirDeg).toBe(90);
    expect(result.metar?.altimInHg).toBeCloseTo(29.92, 2);
  });

  it("rejects a non-ICAO id locally as a definite no-METAR without calling upstream", async () => {
    let called = false;
    const result = await lookupMetar("NOT-A-STATION", async () => {
      called = true;
      return jsonResponse([]);
    });
    expect(called).toBe(false);
    expect(result).toEqual({
      icao: "NOT-A-STATION",
      available: true,
      metar: null,
      attribution: METAR_ATTRIBUTION,
    });
  });
});
