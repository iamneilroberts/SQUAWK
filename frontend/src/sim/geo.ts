/*
 * WGS84 geodesy, hand-rolled so sim/ keeps ZERO Cesium imports (module rule, spec §3).
 * Same ellipsoid constants Cesium's Ellipsoid.WGS84 uses, so ECEF positions produced here
 * hand straight to Cesium's Cartesian3 without a datum shift.
 *
 * Earth rotation is deliberately ignored: no Coriolis, no transport rate. At C172 speeds
 * over a few minutes of flight the omitted terms are far below the terrain resolution this
 * game collides against (parent spec §6). Documented, not forgotten.
 */
import type { Vec3 } from "./types";
import { vCross, vLength, vNormalize } from "./vec3";

export const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - WGS84_F);
const E2 = WGS84_F * (2 - WGS84_F);
const EP2 = E2 / (1 - E2);

export function geodeticToEcef(latRad: number, lonRad: number, heightM: number): Vec3 {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return {
    x: (n + heightM) * cosLat * Math.cos(lonRad),
    y: (n + heightM) * cosLat * Math.sin(lonRad),
    z: (n * (1 - E2) + heightM) * sinLat,
  };
}

/**
 * Bowring's closed-form solution — accurate to well under a millimetre for terrestrial
 * heights and, unlike the naive `r / cos(lat) - N` height form, stable at the poles.
 */
export function ecefToGeodetic(p: Vec3): { latRad: number; lonRad: number; heightM: number } {
  const lonRad = Math.atan2(p.y, p.x);
  const r = Math.hypot(p.x, p.y);
  const theta = Math.atan2(p.z * WGS84_A, r * WGS84_B);
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const latRad = Math.atan2(
    p.z + EP2 * WGS84_B * sinT * sinT * sinT,
    r - E2 * WGS84_A * cosT * cosT * cosT,
  );
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const heightM = r * cosLat + p.z * sinLat - n * (1 - E2 * sinLat * sinLat);
  return { latRad, lonRad, heightM };
}

/** The ellipsoid normal — "up". Matches Cesium's Ellipsoid.geodeticSurfaceNormal. */
export function geodeticSurfaceNormal(p: Vec3): Vec3 {
  return vNormalize({
    x: p.x / (WGS84_A * WGS84_A),
    y: p.y / (WGS84_A * WGS84_A),
    z: p.z / (WGS84_B * WGS84_B),
  });
}

/** East-north-up unit vectors in ECEF at the given position. */
export function enuBasis(p: Vec3): { east: Vec3; north: Vec3; up: Vec3 } {
  const up = geodeticSurfaceNormal(p);
  const lonRad = Math.atan2(p.y, p.x);
  const east: Vec3 = { x: -Math.sin(lonRad), y: Math.cos(lonRad), z: 0 };
  // At the exact pole `east` degenerates; fall back to the prime meridian's east.
  const eastSafe = vLength(east) < 1e-9 ? { x: 0, y: 1, z: 0 } : vNormalize(east);
  return { east: eastSafe, north: vNormalize(vCross(up, eastSafe)), up };
}
