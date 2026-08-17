/*
 * Vector coastline + state/province borders for the nav face (owner 2026-08-17). No Esri tile
 * layer carries a clean transparent coastline, and raster lines warp fuzzy — so these are drawn as
 * crisp SVG polylines in a contrasting colour, projected onto the north-up nav circle with the SAME
 * range/bearing math the airports and contacts use (navXY), so they register exactly.
 *
 * Data: a bundled, simplified Natural Earth extract (borders-world.json — ne_50m coastline +
 * admin-1 state/province lines, Douglas-Peucker simplified, committed like airports-world.json;
 * never fetched at runtime). Flat [lon,lat,lon,lat,...] polylines.
 *
 * Cesium-free, React-free, pure + memoised: projecting ~35k vertices every 10 Hz tick would be
 * wasteful, so a bbox cull skips off-view polylines, a per-vertex range gate splits each polyline
 * to just the near part, and a small key cache (own quantised to ~1 km) makes the 10 Hz re-renders
 * free. The circle clip itself is an SVG clipPath in NavMap, not done here.
 */
import raw from "../data/borders-world.json";
import { navXY } from "./navMath";
import { bearingDeg, rangeNm } from "./geoRange";

type LonLat = { latDeg: number; lonDeg: number };
type Poly = {
  pts: number[]; // flat [lon,lat,...]
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

function toPolys(lines: number[][]): Poly[] {
  return lines.map((pts) => {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const lon = pts[i];
      const lat = pts[i + 1];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { pts, minLon, minLat, maxLon, maxLat };
  });
}

const DATA = raw as { coast: number[][]; borders: number[][] };
const COAST = toPolys(DATA.coast);
const BORDERS = toPolys(DATA.borders);

/** Project one polyline set to SVG polyline point-strings (relative to own at 0,0). Culls whole
 *  polylines outside the view box, then splits each to the vertices within ~1.6× range. */
export function projectBorderPolys(
  polys: Poly[],
  own: LonLat,
  navRangeNm: number,
  radiusPx: number,
): string[] {
  const out: string[] = [];
  // Degree window around own (+margin) for the cheap bbox cull. 1 NM ≈ 1/60°; widen lon by latitude.
  const latMargin = (navRangeNm / 60) * 1.7;
  const cosLat = Math.max(0.2, Math.cos((own.latDeg * Math.PI) / 180));
  const lonMargin = latMargin / cosLat;
  const wMinLat = own.latDeg - latMargin;
  const wMaxLat = own.latDeg + latMargin;
  const wMinLon = own.lonDeg - lonMargin;
  const wMaxLon = own.lonDeg + lonMargin;
  const maxR = navRangeNm * 1.6; // keep a little beyond the ring; the SVG clipPath trims to the edge

  for (const p of polys) {
    if (p.maxLat < wMinLat || p.minLat > wMaxLat || p.maxLon < wMinLon || p.minLon > wMaxLon) {
      continue; // whole polyline is off-view
    }
    let seg: string[] = [];
    for (let i = 0; i < p.pts.length; i += 2) {
      const lon = p.pts[i];
      const lat = p.pts[i + 1];
      const r = rangeNm(own.latDeg, own.lonDeg, lat, lon);
      if (r > maxR) {
        if (seg.length >= 2) out.push(seg.join(" "));
        seg = [];
        continue;
      }
      const b = bearingDeg(own.latDeg, own.lonDeg, lat, lon);
      const xy = navXY({ rangeNm: r, bearingDeg: b, navRangeNm, radiusPx });
      seg.push(`${xy.x.toFixed(1)},${xy.y.toFixed(1)}`);
    }
    if (seg.length >= 2) out.push(seg.join(" "));
  }
  return out;
}

// Single small key-cache: own moves slowly, so quantising to ~1 km makes 10 Hz re-renders free.
const cache = new Map<string, string[]>();
function quant(v: number): number {
  return Math.round(v * 100) / 100; // ~1.1 km at these latitudes
}
function cached(tag: string, polys: Poly[], own: LonLat, navRangeNm: number, radiusPx: number): string[] {
  const qOwn = { latDeg: quant(own.latDeg), lonDeg: quant(own.lonDeg) };
  const key = `${tag}|${qOwn.latDeg},${qOwn.lonDeg},${navRangeNm},${radiusPx}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = projectBorderPolys(polys, qOwn, navRangeNm, radiusPx);
  cache.set(key, v);
  if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  return v;
}

/** Coastline polylines for the face (memoised). */
export function coastPolylines(own: LonLat, navRangeNm: number, radiusPx: number): string[] {
  return cached("c", COAST, own, navRangeNm, radiusPx);
}

/** State / province border polylines for the face (memoised). */
export function borderPolylines(own: LonLat, navRangeNm: number, radiusPx: number): string[] {
  return cached("b", BORDERS, own, navRangeNm, radiusPx);
}
