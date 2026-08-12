import { describe, it, expect } from "vitest";

import { navWxChipStatus } from "./MobileNavWx";
import type { WeatherState } from "./WeatherPanel";
import type { Airport } from "../data/airports";
import type { MetarFields, MetarResponse } from "../data/types";

const station: Airport = {
  ident: "KMOB",
  iata: "MOB",
  name: "Mobile Rgnl",
  latDeg: 30.69,
  lonDeg: -88.24,
  size: "medium",
};

function metar(over: Partial<MetarFields> = {}): MetarFields {
  return {
    obsTime: null,
    windDirDeg: null,
    windVariable: false,
    windSpeedKt: null,
    windGustKt: null,
    visibility: null,
    tempC: null,
    dewpointC: null,
    altimInHg: null,
    clouds: [],
    ceilingFt: null,
    flightCategory: null,
    stationName: null,
    raw: null,
    ...over,
  };
}

function resp(over: Partial<MetarResponse> = {}): MetarResponse {
  return { icao: "KMOB", available: true, metar: metar(), attribution: "AVIATIONWEATHER.GOV", ...over };
}

describe("navWxChipStatus", () => {
  it("uses explicit words for every non-report state (never a fake number)", () => {
    expect(navWxChipStatus({ kind: "no-position" })).toBe("—");
    expect(navWxChipStatus({ kind: "no-station" })).toBe("NO STN");
    expect(navWxChipStatus({ kind: "loading", station, rangeNm: 4 })).toBe("…");
    expect(navWxChipStatus({ kind: "unreachable", station, rangeNm: 4 })).toBe("OFF");
  });

  it("treats an unavailable feed as OFF even under an ok envelope", () => {
    const state: WeatherState = { kind: "ok", station, rangeNm: 4, resp: resp({ available: false, metar: null }) };
    expect(navWxChipStatus(state)).toBe("OFF");
  });

  it("shows NO OBS when the station has no current report (available, metar null)", () => {
    const state: WeatherState = { kind: "ok", station, rangeNm: 4, resp: resp({ metar: null }) };
    expect(navWxChipStatus(state)).toBe("NO OBS");
  });

  it("shows CLR when a real report has no cloud layers", () => {
    const state: WeatherState = { kind: "ok", station, rangeNm: 4, resp: resp({ metar: metar({ clouds: [] }) }) };
    expect(navWxChipStatus(state)).toBe("CLR");
  });

  it("shows the real cloud/ceiling code when a report has layers", () => {
    const state: WeatherState = {
      kind: "ok",
      station,
      rangeNm: 4,
      resp: resp({ metar: metar({ clouds: [{ cover: "BKN", baseFt: 3000 }] }) }),
    };
    expect(navWxChipStatus(state)).toBe("BKN030");
  });
});
