/*
 * METAR lookup: current surface weather for one station, by ICAO id — the Worker port of the
 * retired Python backend/app/feeds/metar.py, same honest-data discipline:
 *
 *   - available:true, metar:null  = aviationweather.gov answered and the station genuinely has
 *     no current report (an honest empty, the panel's NO METAR state);
 *   - available:false             = the lookup itself failed (network/timeout/HTTP error) — we do
 *     NOT know whether a report exists, so the panel must show NO FEED, never "no METAR";
 *   - every shaped field is nullable and a missing input becomes null (the panel's em-dash),
 *     never a substituted or zeroed value. Wind "VRB" is a flag, not a fake heading.
 *
 * Caching: METARs refresh ~hourly and the client polls a station every 8 minutes; the upstream
 * fetch uses Cloudflare's edge cache (cacheTtl 600s) instead of the old in-process dict, which
 * does not exist across Worker isolates. Outages are never cached (a failed fetch bypasses it).
 */

const METAR_BASE = "https://aviationweather.gov/api/data/metar";
const TIMEOUT_MS = 12_000;
const CACHE_TTL_SECONDS = 600;
const ICAO = /^[A-Z]{4}$/;
export const METAR_ATTRIBUTION = "NOAA Aviation Weather Center · aviationweather.gov";

// 1 hPa = 0.0295299830714 inHg — the API reports hectopascals, US altimeters read inches.
const HPA_TO_INHG = 0.0295299830714;
// Cloud covers that constitute a ceiling (broken or worse). SCT/FEW do not.
const CEILING_COVERS = new Set(["BKN", "OVC", "OVX"]);

export type MetarCloud = { cover: string | null; baseFt: number | null };
export type MetarFields = {
  obsTime: number | null;
  windDirDeg: number | null;
  windVariable: boolean;
  windSpeedKt: number | null;
  windGustKt: number | null;
  visibility: string | null;
  tempC: number | null;
  dewpointC: number | null;
  altimInHg: number | null;
  clouds: MetarCloud[];
  ceilingFt: number | null;
  flightCategory: string | null;
  stationName: string | null;
  raw: string | null;
};
export type MetarResponse = {
  icao: string;
  available: boolean;
  metar: MetarFields | null;
  attribution: string;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/** Visibility arrives as statute miles or the API's own "10+" marker — keep the string as-is
 *  (dropping the "+" would assert a precision the report deliberately didn't give). */
function visibility(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  const n = num(v);
  if (n === null) return null;
  return n === Math.trunc(n) ? String(Math.trunc(n)) : String(n);
}

function clouds(raw: unknown): MetarCloud[] {
  if (!Array.isArray(raw)) return [];
  const out: MetarCloud[] = [];
  for (const layer of raw) {
    if (layer !== null && typeof layer === "object") {
      const record = layer as Record<string, unknown>;
      out.push({ cover: str(record.cover), baseFt: int(record.base) });
    }
  }
  return out;
}

/** Lowest broken-or-worse layer base in feet — the aviation definition of a ceiling. A sky of
 *  only FEW/SCT (or clear) has no ceiling: a real null, not a zero. */
function ceilingFt(layers: MetarCloud[]): number | null {
  const bases = layers
    .filter((c) => c.cover !== null && CEILING_COVERS.has(c.cover) && c.baseFt !== null)
    .map((c) => c.baseFt as number);
  return bases.length === 0 ? null : Math.min(...bases);
}

/** One aviationweather.gov JSON record → the flat shape the panel renders. Pure and total. */
export function shapeMetar(rec: Record<string, unknown>): MetarFields {
  const wdirRaw = rec.wdir;
  const windVariable = typeof wdirRaw === "string" && wdirRaw.trim().toUpperCase() === "VRB";
  const altimHpa = num(rec.altim);
  const layers = clouds(rec.clouds);
  return {
    obsTime: int(rec.obsTime),
    windDirDeg: windVariable ? null : int(wdirRaw),
    windVariable,
    windSpeedKt: int(rec.wspd),
    windGustKt: int(rec.wgst),
    visibility: visibility(rec.visib),
    tempC: num(rec.temp),
    dewpointC: num(rec.dewp),
    altimInHg: altimHpa === null ? null : Math.round(altimHpa * HPA_TO_INHG * 100) / 100,
    clouds: layers,
    ceilingFt: ceilingFt(layers),
    flightCategory: str(rec.fltCat),
    stationName: str(rec.name),
    raw: str(rec.rawOb),
  };
}

function shape(icao: string, metar: MetarFields | null, available: boolean): MetarResponse {
  return { icao, available, metar, attribution: METAR_ATTRIBUTION };
}

/**
 * GET {METAR_BASE}?ids={ICAO}&format=json via the injected fetcher. Always returns the same
 * response shape. A non-ICAO id is rejected before any upstream call and treated as a definite
 * local no-METAR (available:true). Outages return available:false and are never edge-cached
 * (Cloudflare only caches successful responses under cacheTtl).
 */
export async function lookupMetar(
  icaoRaw: string,
  fetcher: typeof fetch = fetch,
): Promise<MetarResponse> {
  const icao = icaoRaw.trim().toUpperCase();
  if (!ICAO.test(icao)) return shape(icao, null, true);

  let body: unknown;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetcher(`${METAR_BASE}?ids=${icao}&format=json`, {
        signal: controller.signal,
        cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
      } as RequestInit);
      if (!response.ok) return shape(icao, null, false);
      body = await response.json();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return shape(icao, null, false);
  }

  // The API returns a JSON array; an empty array is a real "no current report for this station".
  const record =
    Array.isArray(body) && body.length > 0 && body[0] !== null && typeof body[0] === "object"
      ? (body[0] as Record<string, unknown>)
      : null;
  return shape(icao, record === null ? null : shapeMetar(record), true);
}
