/*
 * Nearest ICAO weather station to a position (issue #10). Pure arithmetic over the bundled
 * OurAirports extract, so it is unit-tested rather than eyeballed in flight.
 *
 * "ICAO station" means a four-letter ident (A-Z). aviationweather.gov keys METARs by ICAO id,
 * and in the OurAirports data an airport's four-letter ident IS its ICAO code; the extract also
 * carries local idents like "5A8" or "AR-0744" that are not stations we can query, so those are
 * filtered out here rather than sent to the backend to come back empty.
 */
import type { Airport } from "./airports";
import { rangeNm } from "../dashboard/geoRange";

const ICAO_RE = /^[A-Z]{4}$/;

export function isIcaoStation(a: Airport): boolean {
  return ICAO_RE.test(a.ident);
}

export type NearestStation = { airport: Airport; rangeNm: number };

/**
 * The nearest ICAO-identified airport to (latDeg, lonDeg), with its great-circle range. Returns
 * null only when the list holds no ICAO station at all — an honest "no station", never a nearest
 * pick that isn't really a queryable station.
 */
export function nearestIcaoStation(
  latDeg: number,
  lonDeg: number,
  airports: Airport[],
): NearestStation | null {
  let best: NearestStation | null = null;
  for (const airport of airports) {
    if (!isIcaoStation(airport)) continue;
    const r = rangeNm(latDeg, lonDeg, airport.latDeg, airport.lonDeg);
    if (best === null || r < best.rangeNm) best = { airport, rangeNm: r };
  }
  return best;
}
