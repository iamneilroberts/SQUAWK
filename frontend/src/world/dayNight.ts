/*
 * Time-aware lighting, the honest-data way (issue #14): given the real clock and the own-ship
 * position, how high is the sun and therefore is it day, twilight or night. Pure geometry —
 * NO Cesium, NO browser — so it is unit-testable and so the game/HUD layers can import it
 * without pulling the renderer in. The globe layer (globe/dayNightLighting.ts) drives Cesium's
 * built-in sun from the same real clock; this module is the readable, testable classifier.
 *
 * Solar position is the standard low-precision NOAA/Astronomical-Almanac algorithm (accurate to
 * a few arcminutes over this century — far finer than a day/twilight/night decision needs).
 */

const DEG = Math.PI / 180;

/** Sun elevation above the local horizon, in degrees. Negative means below the horizon. */
export function solarElevationDeg(date: Date, latDeg: number, lonDeg: number): number {
  // Days since the J2000.0 epoch (2000-01-01 12:00 UTC). UT is used for TT here; the resulting
  // error is far below the precision a lighting phase cares about.
  const julianDay = date.getTime() / 86_400_000 + 2_440_587.5;
  const n = julianDay - 2_451_545.0;

  const meanLon = (280.46 + 0.985_647_4 * n) * DEG;
  const meanAnom = (357.528 + 0.985_600_3 * n) * DEG;
  const eclipticLon =
    meanLon + (1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * DEG;
  const obliquity = (23.439 - 0.000_000_4 * n) * DEG;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLon),
    Math.cos(eclipticLon),
  );

  // Greenwich mean sidereal time, then the local hour angle of the sun (east longitude positive).
  const gmst = (280.460_618_37 + 360.985_647_366_29 * n) * DEG;
  const hourAngle = gmst + lonDeg * DEG - rightAscension;

  const lat = latDeg * DEG;
  const sinElevation =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);

  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) / DEG;
}

/** Day / civil-twilight / night, keyed off sun elevation (civil twilight is 0 … −6°). */
export type LightPhase = "day" | "civil-twilight" | "night";

export function classifyLightPhase(elevationDeg: number): LightPhase {
  if (elevationDeg >= 0) return "day";
  if (elevationDeg >= -6) return "civil-twilight";
  return "night";
}
