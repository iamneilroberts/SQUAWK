import { describe, it, expect } from "vitest";
import {
  WeatherPanelBody, formatWind, formatVisibility, formatCeiling, formatClouds, formatObsAge,
  type WeatherState,
} from "./WeatherPanel";
import PanelFrame from "./PanelFrame";
import type { Airport } from "../data/airports";
import type { MetarFields, MetarResponse } from "../data/types";
import { EM_DASH } from "../hud/format";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const STATION: Airport = {
  ident: "KMOB", iata: "MOB", name: "Mobile Rgnl", latDeg: 30.69, lonDeg: -88.24, size: "medium",
};

const FULL: MetarFields = {
  obsTime: 1000, windDirDeg: 180, windVariable: false, windSpeedKt: 12, windGustKt: 21,
  visibility: "10+", tempC: 25.6, dewpointC: 22.8, altimInHg: 30.12,
  clouds: [{ cover: "BKN", baseFt: 2500 }], ceilingFt: 2500, flightCategory: "VFR",
  stationName: "Mobile Rgnl, AL, US", raw: "METAR KMOB 080156Z 18012G21KT 10SM BKN025 26/23 A3012",
};

const resp = (metar: MetarFields | null, available = true): MetarResponse => ({
  icao: "KMOB", available, metar, attribution: "NOAA Aviation Weather Center · aviationweather.gov",
});

// obsTime 1000 s + 12 min => age reads "12 MIN" deterministically, no dependence on the clock.
const NOW_MS = (1000 + 12 * 60) * 1000;
const render = (state: WeatherState) => collectText(WeatherPanelBody({ state, nowMs: NOW_MS })).join(" ");

describe("the weather panel shows a real METAR", () => {
  const text = render({ kind: "ok", station: STATION, rangeNm: 12, resp: resp(FULL) });

  it("renders the station id, its range, and each reported field", () => {
    expect(text).toContain("KMOB");
    expect(text).toContain("12 NM");
    expect(text).toContain("180° 12G21 KT"); // wind, padded, with gust
    expect(text).toContain("10+ SM");        // visibility, "+" preserved
    expect(text).toContain("2500 FT");       // ceiling
    expect(text).toContain("30.12 IN");      // altimeter, already converted to inHg
    expect(text).toContain("26°C / 23°C");   // temp / dew, rounded
    expect(text).toContain("12 MIN");        // real observation age from obsTime
  });

  it("shows the NOAA attribution while a report is on screen", () => {
    expect(text).toContain("aviationweather.gov");
  });
});

describe("missing fields render as an em-dash, never a fabricated value", () => {
  const sparse: MetarFields = {
    ...FULL, windGustKt: null, windDirDeg: null, windVariable: true,
    visibility: null, altimInHg: null, ceilingFt: null, tempC: null, dewpointC: null, obsTime: null,
  };
  const text = render({ kind: "ok", station: STATION, rangeNm: 12, resp: resp(sparse) });

  it("em-dashes visibility, altimeter, temp and obs age it does not have", () => {
    expect(text).toContain(EM_DASH);
    expect(text).not.toContain(" SM"); // no fabricated visibility unit on a null value
    expect(text).not.toContain(" IN"); // no fabricated altimeter
  });
  it("shows variable wind as VRB, never as a fake 000° heading", () => {
    expect(formatWind(sparse)).toBe("VRB 12 KT"); // VRB direction, speed kept, no gust
  });
  it("shows no ceiling honestly, not a zero", () => {
    expect(formatCeiling(sparse)).toBe("NONE");
    expect(text).not.toContain("0 FT");
  });
});

describe("honest empty states carry NO digits — a digit here would be a leaked fake reading", () => {
  const states: Record<string, WeatherState> = {
    "no position": { kind: "no-position" },
    "no station": { kind: "no-station" },
    "feed offline (fetch failed)": { kind: "unreachable", station: STATION, rangeNm: 12 },
    "feed offline (upstream down)": { kind: "ok", station: STATION, rangeNm: 12, resp: resp(null, false) },
    "no report for the station": { kind: "ok", station: STATION, rangeNm: 12, resp: resp(null, true) },
  };
  for (const [name, state] of Object.entries(states)) {
    it(`${name} shows an explicit line and not one digit`, () => {
      expect(render(state)).not.toMatch(/\d/);
    });
  }

  it("names the offline and no-report conditions literally so the blank is explained", () => {
    expect(render({ kind: "unreachable", station: STATION, rangeNm: 12 })).toContain("NO FEED");
    expect(render({ kind: "ok", station: STATION, rangeNm: 12, resp: resp(null, false) })).toContain("NO FEED");
    expect(render({ kind: "ok", station: STATION, rangeNm: 12, resp: resp(null, true) })).toContain("NO METAR");
    expect(render({ kind: "no-station" })).toContain("OUT OF COVERAGE");
  });
});

describe("pure formatters", () => {
  it("reads calm wind as CALM, not 000° 0 KT", () => {
    expect(formatWind({ ...FULL, windSpeedKt: 0, windVariable: false, windGustKt: null })).toBe("CALM");
  });
  it("pads the wind direction to three digits and appends the gust", () => {
    expect(formatWind({ ...FULL, windDirDeg: 5, windSpeedKt: 8, windGustKt: null })).toBe("005° 8 KT");
    expect(formatWind({ ...FULL, windDirDeg: 90, windSpeedKt: 8, windGustKt: 15 })).toBe("090° 8G15 KT");
  });
  it("clamps a future/skewed observation age to zero rather than showing a negative", () => {
    expect(formatObsAge(2000, 1000 * 1000)).toBe("0 MIN");
  });
  it("rolls observation age over into hours past sixty minutes", () => {
    expect(formatObsAge(0, 75 * 60 * 1000)).toBe("1H 15M");
  });
  it("reports a clear sky as CLR and layered sky in hundreds of feet", () => {
    expect(formatClouds({ ...FULL, clouds: [] })).toBe("CLR");
    expect(formatClouds({ ...FULL, clouds: [{ cover: "BKN", baseFt: 2500 }] })).toBe("BKN025");
  });
  it("appends the statute-mile unit only to a real visibility value", () => {
    expect(formatVisibility({ ...FULL, visibility: "6" })).toBe("6 SM");
    expect(formatVisibility({ ...FULL, visibility: null })).toBe(EM_DASH);
  });
});

describe("PanelFrame", () => {
  it("shows the title and the contents when open", () => {
    const text = collectText(
      PanelFrame({ title: "WEATHER", collapsed: false, onToggle: () => {}, children: "BODY" }),
    ).join(" ");
    expect(text).toContain("WEATHER");
    expect(text).toContain("BODY");
    expect(text).toContain("[-]");
  });
  it("keeps the title but drops the contents when collapsed", () => {
    const text = collectText(
      PanelFrame({ title: "WEATHER", collapsed: true, onToggle: () => {}, children: "BODY" }),
    ).join(" ");
    expect(text).toContain("WEATHER");
    expect(text).not.toContain("BODY");
    expect(text).toContain("[+]");
  });
});
