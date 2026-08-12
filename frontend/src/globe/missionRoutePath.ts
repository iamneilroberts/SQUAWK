/*
 * #50: on final the full original-position → runway polyline reads as pointing "where I came
 * from". The route must always start at the aircraft's CURRENT position so it only ever shows
 * the remaining path. Pure (no Cesium) so it stays unit-testable; the mission parameter is
 * structural so tests don't need a full LockedMissionView.
 */
import { mToFt } from "../sim/units";

export type RoutePoint = { latDeg: number; lonDeg: number; altitudeFt: number };

export function routeStartPoint(
  snapshot: { latDeg: number; lonDeg: number; altitudeM: number } | null,
  mission: {
    contact: {
      lat: number;
      lon: number;
      alt_geom?: number | null;
      alt_baro?: number | string | null;
    };
  },
): RoutePoint {
  if (snapshot !== null) {
    return {
      latDeg: snapshot.latDeg,
      lonDeg: snapshot.lonDeg,
      altitudeFt: mToFt(snapshot.altitudeM),
    };
  }
  const contact = mission.contact;
  const altitudeFt =
    contact.alt_geom ?? (typeof contact.alt_baro === "number" ? contact.alt_baro : 0);
  return { latDeg: contact.lat, lonDeg: contact.lon, altitudeFt };
}
