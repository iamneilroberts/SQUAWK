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

/**
 * Maximum range at which a station's METAR is treated as representative of the aircraft's position
 * (issue #10, resolving the deferred owner-input item). A METAR nominally describes conditions
 * within ~5 statute miles of the field, but in flight the aircraft covers ground fast and regional
 * conditions stay coherent over a wider area, so a modestly larger radius keeps the panel useful
 * without misrepresenting a far report as local. Beyond this the honest answer is "no station
 * nearby" (out of coverage) — never a distant, less-accurate reading shown as if it were local.
 * Owner-tunable — see decisions.md #10.
 */
export const MAX_STATION_NM = 50;

export function isIcaoStation(a: Airport): boolean {
  return ICAO_RE.test(a.ident);
}

export type NearestStation = { airport: Airport; rangeNm: number };

/**
 * The nearest ICAO-identified airport to (latDeg, lonDeg), with its great-circle range. Returns
 * null when the list holds no ICAO station at all, OR when the nearest one is farther than
 * MAX_STATION_NM — both are an honest "no station nearby", never a distant pick shown as if it
 * were local weather.
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
  if (best !== null && best.rangeNm > MAX_STATION_NM) return null;
  return best;
}
