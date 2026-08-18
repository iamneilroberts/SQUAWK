/*
 * Precipitation-radar (RainViewer) warp + data math for the NavMap overlay (issue #17).
 *
 * The core design call (decisions.md WX-001/WX-002): the NavMap is a north-up, own-ship-centred,
 * LINEAR-range NM polar plot (navMath.navXY). RainViewer tiles are Web-Mercator raster and are
 * NOT pixel-compatible with that polar face. The honest-data ground rule forbids the cheap
 * "treat the tiles as locally planar and flat-paste them" hack — at 50–200 NM that implies a
 * precision the projection does not have. So we REPROJECT: for every output pixel inside the
 * nav circle we go
 *
 *     nav pixel  ->  (range, bearing)      [inverse of navXY]
 *                ->  destination lat/lon    [spherical direct geodesic, inverse of geoRange]
 *                ->  Web-Mercator world px  [standard slippy-map projection]
 *                ->  sample the composited tile canvas.
 *
 * Everything here is PURE (no DOM, no Cesium, no React) and unit-tested the same way navMath is —
 * the impure canvas compositing/sampling that consumes these functions lives in NavWeatherLayer.
 */

// Sphere radius in NM — same figure and same DISPLAY-approximation rationale as geoRange.ts
// (ellipsoidal correction is < 0.3% at radar ranges; the sim itself is ellipsoidal). geoRange
// keeps this private, so we restate it rather than widen that module's surface for one importer.
const EARTH_RADIUS_NM = 3440.065;
// Spherical-mercator earth circumference in metres (WGS84 equatorial radius) — the constant every
// slippy-map ground-resolution formula uses. Only for the zoom-selection heuristic.
const MERCATOR_CIRCUMFERENCE_M = 2 * Math.PI * 6378137;
const M_PER_NM = 1852;

// RainViewer tile parameters (spec §Source): 256 px tiles, colour scheme 2 "Universal Blue",
// smoothing on, snow on. Tunable later; fixed here so the URL builder is total.
export const RADAR_TILE_SIZE = 256;
export const RADAR_COLOR = 2;
export const RADAR_SMOOTH = 1;
export const RADAR_SNOW = 1;
// Cap the Web-Mercator zoom so a small nav range never UPSCALES a coarse tile into false
// precision. 7 keeps ~1 km/px tiles honest; past this the overlay is flagged COARSE, not faked.
export const RADAR_MAX_Z = 7;
// Overlay opacity — reads as an overlay, not a basemap (spec §The projection problem).
export const RADAR_ALPHA = 0.5;
// A frame older than this is called out rather than shown as if current (spec: never stale-silent).
export const RADAR_STALE_MIN = 15;

export const RAINVIEWER_CREDIT = "WEATHER © RAINVIEWER";

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export type LonLat = { latDeg: number; lonDeg: number };
export type WorldPixel = { x: number; y: number };
export type RangeBearing = { rangeNm: number; bearingDeg: number };

/**
 * Inverse of navMath.navXY: a map-face pixel offset from own ship (origin at centre, +x east/
 * right, +y down — SVG axes) back to (range NM, bearing°). Returns null when the pixel is OUTSIDE
 * the nav circle, so the caller draws nothing there rather than sampling wrapped-around sky.
 */
export function navPixelToRangeBearing(
  px: number,
  py: number,
  navRangeNm: number,
  radiusPx: number,
): RangeBearing | null {
  const rPx = Math.hypot(px, py);
  if (rPx > radiusPx) return null;
  const rangeNm = (rPx / radiusPx) * navRangeNm;
  // navXY: x = r·sin(θ), y = −r·cos(θ)  ⇒  θ = atan2(x, −y). North (θ=0) is straight up.
  const bearingDeg = (toDeg(Math.atan2(px, -py)) + 360) % 360;
  return { rangeNm, bearingDeg };
}

/**
 * Spherical direct geodesic: the point `rangeNm` from (ownLat, ownLon) along `bearingDeg`. The
 * exact inverse of geoRange's rangeNm/bearingDeg, on the same sphere, so a round-trip is stable.
 */
export function destPoint(
  ownLatDeg: number,
  ownLonDeg: number,
  rangeNm: number,
  bearingDeg: number,
): LonLat {
  const delta = rangeNm / EARTH_RADIUS_NM; // angular distance
  const theta = toRad(bearingDeg);
  const phi1 = toRad(ownLatDeg);
  const lambda1 = toRad(ownLonDeg);
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * sinPhi2,
    );
  return {
    latDeg: toDeg(phi2),
    lonDeg: ((toDeg(lambda2) + 540) % 360) - 180, // normalise to [-180, 180)
  };
}

/**
 * Standard Web-Mercator projection to a FRACTIONAL global pixel at zoom `z` (origin top-left,
 * +x east, +y south). n = 2^z tiles per axis; the world is n·tileSize px wide. North maps to a
 * SMALLER y — the sign that makes the reprojection right-way-up.
 */
export function lonLatToWorldPixel(
  latDeg: number,
  lonDeg: number,
  z: number,
  tileSize: number = RADAR_TILE_SIZE,
): WorldPixel {
  const scale = Math.pow(2, z) * tileSize;
  const x = ((lonDeg + 180) / 360) * scale;
  const latRad = toRad(latDeg);
  const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / (2 * Math.PI)) * scale;
  return { x, y };
}

/** The whole warp, composed: nav-face pixel → Web-Mercator world pixel (null outside the circle). */
export function navPixelToWorldPixel(o: {
  px: number;
  py: number;
  own: LonLat;
  navRangeNm: number;
  z: number;
  radiusPx: number;
  tileSize?: number;
}): WorldPixel | null {
  const rb = navPixelToRangeBearing(o.px, o.py, o.navRangeNm, o.radiusPx);
  if (rb === null) return null;
  const dest = destPoint(o.own.latDeg, o.own.lonDeg, rb.rangeNm, rb.bearingDeg);
  return lonLatToWorldPixel(dest.latDeg, dest.lonDeg, o.z, o.tileSize);
}

/**
 * Choose the Web-Mercator zoom whose ground resolution matches the map face, so tiles are neither
 * needlessly huge nor upscaled. `capped` is true when the ideal zoom exceeds RADAR_MAX_Z (small
 * range) — the overlay is then genuinely coarser than the face and the chip says COARSE.
 */
export function resolveZoom(
  navRangeNm: number,
  latDeg: number,
  radiusPx: number,
  maxZ: number = RADAR_MAX_Z,
): {
  z: number;
  capped: boolean;
} {
  const navMetersPerPx = (navRangeNm * M_PER_NM) / radiusPx;
  const latRes = MERCATOR_CIRCUMFERENCE_M * Math.cos(toRad(latDeg));
  // want mercatorMetersPerPx = latRes / (tileSize·2^z) <= navMetersPerPx
  const idealZ = Math.log2(latRes / (RADAR_TILE_SIZE * navMetersPerPx));
  const wanted = Math.max(0, Math.ceil(idealZ));
  // `maxZ` defaults to RADAR_MAX_Z so the precip overlay is unchanged; the satellite basemap passes
  // a higher cap for a crisp image (Esri World Imagery goes far deeper than the radar tiles do).
  return { z: Math.min(maxZ, wanted), capped: wanted > maxZ };
}

// ---- RainViewer manifest / tile-URL layer ---------------------------------------------------

export type RadarFrame = { time: number; path: string };
export type RadarManifest = { host: string; frames: RadarFrame[] };

/**
 * Validate the RainViewer weather-maps.json into a flat, trusted shape, or null if it is not the
 * document we expect. We take ONLY `radar.past` — real observed frames — and deliberately ignore
 * `nowcast` (model FORECAST, not an observation): honest-data rule, we never paint predicted
 * precip as if it were measured. A null return drives the honest "NO RADAR FEED" state.
 */
export function parseManifest(raw: unknown): RadarManifest | null {
  if (raw === null || typeof raw !== "object") return null;
  const host = (raw as { host?: unknown }).host;
  const radar = (raw as { radar?: unknown }).radar;
  if (typeof host !== "string" || host === "") return null;
  if (radar === null || typeof radar !== "object") return null;
  const past = (radar as { past?: unknown }).past;
  if (!Array.isArray(past)) return null;
  const frames: RadarFrame[] = [];
  for (const f of past) {
    if (f !== null && typeof f === "object") {
      const time = (f as { time?: unknown }).time;
      const path = (f as { path?: unknown }).path;
      if (typeof time === "number" && typeof path === "string" && path !== "") {
        frames.push({ time, path });
      }
    }
  }
  if (frames.length === 0) return null;
  return { host, frames };
}

/** The newest observed frame (max unix time). null on an empty list → honest "no usable frame". */
export function pickNewestFrame(frames: RadarFrame[]): RadarFrame | null {
  let best: RadarFrame | null = null;
  for (const f of frames) if (best === null || f.time > best.time) best = f;
  return best;
}

/** Standard RainViewer XYZ tile URL. The per-frame path hash makes each frame's URL unique, so a
 *  rebuild keyed to the frame time is its own cache-bust — no query string needed. */
export function buildTileUrl(o: {
  host: string;
  path: string;
  z: number;
  x: number;
  y: number;
  size?: number;
  color?: number;
  smooth?: number;
  snow?: number;
}): string {
  const size = o.size ?? RADAR_TILE_SIZE;
  const color = o.color ?? RADAR_COLOR;
  const smooth = o.smooth ?? RADAR_SMOOTH;
  const snow = o.snow ?? RADAR_SNOW;
  return `${o.host}${o.path}/${size}/${o.z}/${o.x}/${o.y}/${color}/${smooth}_${snow}.png`;
}

/**
 * The Cesium UrlTemplateImageryProvider template for a whole frame: {z}/{x}/{y} are Cesium's own
 * substitution tokens (default WebMercatorTilingScheme matches RainViewer's XYZ), so ONE provider
 * serves every tile of the frame — the globe-drape counterpart to buildTileUrl's per-tile URL.
 * Same host/path/params, so the two stay in lockstep.
 */
export function buildTileUrlTemplate(o: {
  host: string;
  path: string;
  size?: number;
  color?: number;
  smooth?: number;
  snow?: number;
}): string {
  const size = o.size ?? RADAR_TILE_SIZE;
  const color = o.color ?? RADAR_COLOR;
  const smooth = o.smooth ?? RADAR_SMOOTH;
  const snow = o.snow ?? RADAR_SNOW;
  return `${o.host}${o.path}/${size}/{z}/{x}/{y}/${color}/${smooth}_${snow}.png`;
}

// ---- honest-offline state machine (cloned from WeatherPanel's WeatherState idiom) -------------

export type NavWeatherState =
  | { kind: "no-position" }
  | { kind: "loading" }
  | { kind: "unreachable" }
  | { kind: "ok"; host: string; frame: RadarFrame };

/** Real frame age from the frame's unix time — never faked; drives the STALE call-out. */
export function radarFrameAgeMin(timeS: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs / 1000 - timeS) / 60));
}

function ageText(mins: number): string {
  if (mins < 60) return `${mins} MIN`;
  return `${Math.floor(mins / 60)}H ${mins % 60}M`;
}

/**
 * The chip shown in NavMap's status slot while WX is on. Distinct wording from the ADS-B feed's
 * "FEED OFFLINE · TRAFFIC FROZEN" — RainViewer is an independent 3rd-party feed. No non-`ok`
 * state ever implies precipitation data exists.
 */
export function radarChipText(
  state: NavWeatherState,
  nowMs: number,
  coarse = false,
): string | null {
  switch (state.kind) {
    case "no-position":
      return null; // the map already plots nothing without own position; nothing to add
    case "loading":
      return "RADAR…";
    case "unreachable":
      return "NO RADAR FEED";
    case "ok": {
      const mins = radarFrameAgeMin(state.frame.time, nowMs);
      const parts = [`WX ${ageText(mins)}`];
      if (mins >= RADAR_STALE_MIN) parts.push("STALE");
      if (coarse) parts.push("COARSE");
      return parts.join(" · ");
    }
  }
}
