/*
 * Great-circle range and bearing on a sphere, in degrees in / nautical miles out. Shared by the
 * windscreen tags and the radar scope, which is the only reason it is its own module.
 *
 * A sphere, not WGS84: at radar ranges (<= 250 NM) the ellipsoidal correction is under 0.3%,
 * well inside the resolution of a 220-pixel scope, and this keeps the module free of any
 * dependency on the sim's geodesy. The sim itself is ellipsoidal — see decisions.md G-003 — and
 * this is a DISPLAY approximation, deliberately confined to display code.
 */
const EARTH_RADIUS_NM = 3440.065; // 6371.0088 km / 1.852

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function rangeNm(aLatDeg: number, aLonDeg: number, bLatDeg: number, bLonDeg: number): number {
  const dLat = toRad(bLatDeg - aLatDeg);
  const dLon = toRad(bLonDeg - aLonDeg);
  const la1 = toRad(aLatDeg);
  const la2 = toRad(bLatDeg);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing, degrees clockwise from true north, [0, 360). */
export function bearingDeg(
  aLatDeg: number, aLonDeg: number, bLatDeg: number, bLonDeg: number,
): number {
  if (aLatDeg === bLatDeg && aLonDeg === bLonDeg) return 0;
  const la1 = toRad(aLatDeg);
  const la2 = toRad(bLatDeg);
  const dLon = toRad(bLonDeg - aLonDeg);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
