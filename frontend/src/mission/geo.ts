export const EARTH_RADIUS_NM = 3440.065;

export function degToRad(value: number): number {
  return value * Math.PI / 180;
}

export function radToDeg(value: number): number {
  return value * 180 / Math.PI;
}

export function normalizeLongitude(lonDeg: number): number {
  const wrapped = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function normalizeHeading(headingDeg: number): number {
  const wrapped = ((headingDeg % 360) + 360) % 360;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function headingDeltaDeg(aDeg: number, bDeg: number): number {
  const delta = Math.abs(normalizeHeading(aDeg) - normalizeHeading(bDeg));
  return Math.min(delta, 360 - delta);
}

export function greatCircleDistanceNm(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number): number {
  const lat1 = degToRad(lat1Deg);
  const lat2 = degToRad(lat2Deg);
  const dLat = lat2 - lat1;
  const dLon = degToRad(normalizeLongitude(lon2Deg - lon1Deg));
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const haversine = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(Math.max(0, haversine))));
}

export function initialBearingDeg(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number): number {
  const lat1 = degToRad(lat1Deg);
  const lat2 = degToRad(lat2Deg);
  const dLon = degToRad(normalizeLongitude(lon2Deg - lon1Deg));
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  if (Math.abs(x) < 1e-15 && Math.abs(y) < 1e-15) return 0;
  return normalizeHeading(radToDeg(Math.atan2(y, x)));
}

/** Test/data utility: move from a point along a great-circle bearing. */
export function destinationPoint(latDeg: number, lonDeg: number, bearingDeg: number, distanceNm: number): { latDeg: number; lonDeg: number } {
  const angular = distanceNm / EARTH_RADIUS_NM;
  const lat1 = degToRad(latDeg);
  const lon1 = degToRad(lonDeg);
  const bearing = degToRad(bearingDeg);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { latDeg: radToDeg(lat2), lonDeg: normalizeLongitude(radToDeg(lon2)) };
}
