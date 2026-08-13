/*
 * The bundled Gulf Coast VOR-family navaid label index (VOR / VOR-DME / VORTAC / TACAN). GENERATED
 * and COMMITTED — see scripts/fetch-ournavaids.sh. Never fetched at runtime; public domain
 * (OurAirports), credited when the layer is on. Labeled by IDENT, which is how a VOR appears on an
 * aeronautical chart and how a pilot references it.
 *
 * Cesium-free on purpose: `visibleNavaids` is arithmetic and unit-tested (the data/airports.ts pattern).
 */
import raw from "./navaids-vor.json";
import { rangeNm } from "../dashboard/geoRange";

export type Navaid = {
  ident: string;
  name: string;
  type: string;
  latDeg: number;
  lonDeg: number;
};

export const NAVAID_LABEL_MAX = 24;
/** Navaids are en-route fixes — show a wider ring than towns, but still bounded to the region. */
export const NAVAID_MAX_RANGE_NM = 250;
const NOTHING_ABOVE_M = 500_000;

function fail(msg: string): never {
  throw new Error(`navaids-vor.json: ${msg}`);
}

export function validateNavaids(value: unknown): Navaid[] {
  if (!Array.isArray(value)) fail("must be an array");
  return value.map((r, i) => {
    if (typeof r !== "object" || r === null) fail(`[${i}] must be an object`);
    const o = r as Record<string, unknown>;
    const ident = o.ident;
    const type = o.type;
    const lat = o.latDeg;
    const lon = o.lonDeg;
    if (typeof ident !== "string" || ident.length === 0) fail(`[${i}].ident must be a non-empty string`);
    if (typeof type !== "string" || type.length === 0) fail(`[${i}].type must be a non-empty string`);
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      fail(`[${i}].latDeg must be a latitude`);
    }
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      fail(`[${i}].lonDeg must be a longitude`);
    }
    return { ident, name: typeof o.name === "string" ? o.name : "", type, latDeg: lat, lonDeg: lon };
  });
}

let cached: Navaid[] | null = null;

export function loadNavaids(): Navaid[] {
  if (cached === null) cached = validateNavaids(raw);
  return cached;
}

/** What the label reads: the charted IDENT (uppercased). The glyph is added by the Cesium layer. */
export function navaidLabelText(n: Navaid): string {
  return n.ident.toUpperCase();
}

export function visibleNavaids(o: {
  navaids: Navaid[];
  cameraHeightM: number;
  centerLatDeg: number;
  centerLonDeg: number;
  maxLabels?: number;
  maxRangeNm?: number;
}): Navaid[] {
  const maxLabels = o.maxLabels ?? NAVAID_LABEL_MAX;
  const maxRangeNm = o.maxRangeNm ?? NAVAID_MAX_RANGE_NM;
  if (o.cameraHeightM > NOTHING_ABOVE_M) return [];

  return o.navaids
    .map((n) => ({ n, r: rangeNm(o.centerLatDeg, o.centerLonDeg, n.latDeg, n.lonDeg) }))
    .filter((x) => x.r <= maxRangeNm)
    .sort((x, y) => x.r - y.r)
    .slice(0, maxLabels)
    .map((x) => x.n);
}
