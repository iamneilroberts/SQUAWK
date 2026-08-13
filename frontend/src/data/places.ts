/*
 * Curated Gulf Coast place labels — towns and landmarks (bays, islands, rivers, keys) to help the
 * flyer orient. Hand-picked (real coordinates, not synthesized) and COMMITTED as `places-gulf.json`;
 * never fetched at runtime, so labels work with the backend down. The Esri place raster still covers
 * the rest of the world; this is the local detail set.
 *
 * Cesium-free on purpose: `visiblePlaces` is the whole declutter policy and it is arithmetic, so it
 * is unit-tested rather than eyeballed on a globe (the `data/airports.ts` pattern).
 */
import raw from "./places-gulf.json";
import { rangeNm } from "../dashboard/geoRange";

export type PlaceKind = "town" | "landmark";
export type Place = {
  name: string;
  kind: PlaceKind;
  latDeg: number;
  lonDeg: number;
};

export const PLACE_LABEL_MAX = 40;
/** Beyond this the curated Gulf set is nowhere near the camera — show nothing rather than a smear
 *  of far-south labels when the flight has wandered out of the region. */
export const PLACE_MAX_RANGE_NM = 300;
/** Above this camera height the region is a marble; labels would be noise. */
const NOTHING_ABOVE_M = 500_000;

function fail(msg: string): never {
  throw new Error(`places-gulf.json: ${msg}`);
}

export function validatePlaces(value: unknown): Place[] {
  if (!Array.isArray(value)) fail("must be an array");
  return value.map((r, i) => {
    if (typeof r !== "object" || r === null) fail(`[${i}] must be an object`);
    const o = r as Record<string, unknown>;
    const name = o.name;
    const kind = o.kind;
    const lat = o.latDeg;
    const lon = o.lonDeg;
    if (typeof name !== "string" || name.length === 0) fail(`[${i}].name must be a non-empty string`);
    if (kind !== "town" && kind !== "landmark") fail(`[${i}].kind must be "town" or "landmark"`);
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      fail(`[${i}].latDeg must be a latitude`);
    }
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      fail(`[${i}].lonDeg must be a longitude`);
    }
    return { name, kind, latDeg: lat, lonDeg: lon };
  });
}

let cached: Place[] | null = null;

export function loadPlaces(): Place[] {
  if (cached === null) cached = validatePlaces(raw);
  return cached;
}

/** What the label reads. Uppercased for the terminal look; the glyph is added by the Cesium layer. */
export function placeLabelText(p: Place): string {
  return p.name.toUpperCase();
}

export function visiblePlaces(o: {
  places: Place[];
  cameraHeightM: number;
  centerLatDeg: number;
  centerLonDeg: number;
  maxLabels?: number;
  maxRangeNm?: number;
}): Place[] {
  const maxLabels = o.maxLabels ?? PLACE_LABEL_MAX;
  const maxRangeNm = o.maxRangeNm ?? PLACE_MAX_RANGE_NM;
  if (o.cameraHeightM > NOTHING_ABOVE_M) return [];

  return o.places
    .map((p) => ({ p, r: rangeNm(o.centerLatDeg, o.centerLonDeg, p.latDeg, p.lonDeg) }))
    .filter((x) => x.r <= maxRangeNm)
    .sort((x, y) => x.r - y.r)
    .slice(0, maxLabels)
    .map((x) => x.p);
}
