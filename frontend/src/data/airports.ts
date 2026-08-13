/*
 * The lightweight bundled OurAirports label index and the rules for showing it (spec D-7).
 *
 * `airports-world.json` is GENERATED and COMMITTED — see scripts/fetch-ourairports.sh. It is
 * never fetched at runtime and the CSV is never parsed in the browser, so airport labels work
 * with the backend down and OurAirports unreachable. Public domain; credited anyway when the
 * layer is on.
 *
 * Mission assignment uses the separate versioned regional airport/runway shards under
 * `public/data/airports`; keeping this runway-free index avoids loading every runway just to
 * draw labels. Cesium-free on purpose: `visibleAirports` is the whole declutter policy and it
 * is arithmetic, so it is unit-tested rather than eyeballed on a globe.
 */
import raw from "./airports-world.json";
import { rangeNm } from "../dashboard/geoRange";

export type Airport = {
  /** ICAO or local ident, e.g. "KMOB". Always present. */
  ident: string;
  /** IATA code where one exists, e.g. "MOB". */
  iata: string | null;
  name: string;
  latDeg: number;
  lonDeg: number;
  size: "large" | "medium";
};

export const AIRPORT_LABEL_MAX = 60;

/**
 * Camera-height tiers, metres. Above the top one the globe is a marble and labels are noise;
 * below the bottom one everything we have is legible.
 */
const LARGE_ONLY_ABOVE_M = 40_000;
const NOTHING_ABOVE_M = 500_000;

function fail(msg: string): never {
  throw new Error(`airports-world.json: ${msg}`);
}

export function validateAirports(value: unknown): Airport[] {
  if (!Array.isArray(value)) fail("must be an array");
  return value.map((r, i) => {
    if (typeof r !== "object" || r === null) fail(`[${i}] must be an object`);
    const o = r as Record<string, unknown>;
    const ident = o.ident;
    const lat = o.latDeg;
    const lon = o.lonDeg;
    const size = o.size;
    if (typeof ident !== "string" || ident.length === 0) fail(`[${i}].ident must be a non-empty string`);
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      fail(`[${i}].latDeg must be a latitude`);
    }
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      fail(`[${i}].lonDeg must be a longitude`);
    }
    if (size !== "large" && size !== "medium") fail(`[${i}].size must be "large" or "medium"`);
    return {
      ident,
      iata: typeof o.iata === "string" && o.iata.length > 0 ? o.iata : null,
      name: typeof o.name === "string" ? o.name : "",
      latDeg: lat,
      lonDeg: lon,
      size,
    };
  });
}

let cached: Airport[] | null = null;

export function loadAirports(): Airport[] {
  if (cached === null) cached = validateAirports(raw);
  return cached;
}

/**
 * A chart-length name from a long official one: abbreviate the words that appear on almost every
 * field, drop a trailing "Airport", and fall back to the code if nothing readable is left. Pure and
 * case-preserving; `airportLabelText` uppercases for the terminal look.
 */
export function shortenAirportName(name: string, ident: string, iata: string | null): string {
  const fallback = iata ?? ident;
  const shortened = name
    .replace(/\bInternational\b/gi, "Intl")
    .replace(/\bRegional\b/gi, "Rgnl")
    .replace(/\bMunicipal\b/gi, "Muni")
    .replace(/\bAirport\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return shortened.length > 0 ? shortened : fallback;
}

/** What the label reads: the shortened field name, uppercased; the code only when there is no name. */
export function airportLabelText(a: Airport): string {
  return shortenAirportName(a.name, a.ident, a.iata).toUpperCase();
}

export function visibleAirports(o: {
  airports: Airport[];
  cameraHeightM: number;
  centerLatDeg: number;
  centerLonDeg: number;
  maxLabels?: number;
}): Airport[] {
  const maxLabels = o.maxLabels ?? AIRPORT_LABEL_MAX;
  if (o.cameraHeightM > NOTHING_ABOVE_M) return [];

  const tier =
    o.cameraHeightM > LARGE_ONLY_ABOVE_M
      ? o.airports.filter((a) => a.size === "large")
      : o.airports;

  return tier
    .map((a) => ({ a, r: rangeNm(o.centerLatDeg, o.centerLonDeg, a.latDeg, a.lonDeg) }))
    .sort((x, y) => x.r - y.r)
    .slice(0, maxLabels)
    .map((x) => x.a);
}
