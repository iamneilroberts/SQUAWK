import type { Contact } from "../../src/data/types";
import {
  TRAFFIC_MAX_RADIUS_NM,
  TRAFFIC_MIN_RADIUS_NM,
} from "../../src/shared/limits";

const EARTH_RADIUS_NM = 3_440.065;

export type RegionConfig = {
  cellDegrees: number;
  providerRadiusStepNm: number;
  providerMaxRadiusNm: number;
};

export type NormalizedRegion = {
  regionKey: string;
  requestedCenter: { lat: number; lon: number };
  providerCenter: { lat: number; lon: number };
  radiusNm: number;
  providerRadiusNm: number;
};

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function validConfig(config: RegionConfig): void {
  if (!Number.isFinite(config.cellDegrees) || config.cellDegrees <= 0 || config.cellDegrees > 5) {
    throw new TypeError("cellDegrees is invalid");
  }
  if (
    !Number.isFinite(config.providerRadiusStepNm) ||
    config.providerRadiusStepNm <= 0 ||
    config.providerRadiusStepNm > config.providerMaxRadiusNm
  ) {
    throw new TypeError("providerRadiusStepNm is invalid");
  }
  if (
    !Number.isFinite(config.providerMaxRadiusNm) ||
    config.providerMaxRadiusNm < TRAFFIC_MIN_RADIUS_NM
  ) {
    throw new TypeError("providerMaxRadiusNm is invalid");
  }
}

export function normalizeLongitude(longitude: number): number {
  const value = finite(longitude, "longitude");
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function greatCircleDistanceNm(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): number {
  const toRadians = Math.PI / 180;
  const aLat = finite(latA, "latitude") * toRadians;
  const bLat = finite(latB, "latitude") * toRadians;
  const deltaLat = bLat - aLat;
  const deltaLon = normalizeLongitude(lonB - lonA) * toRadians;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const haversine = sinLat * sinLat + Math.cos(aLat) * Math.cos(bLat) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

export function clampTrafficRadiusNm(radiusNm: number): number {
  const radius = finite(radiusNm, "radiusNm");
  return Math.min(TRAFFIC_MAX_RADIUS_NM, Math.max(TRAFFIC_MIN_RADIUS_NM, radius));
}

function canonical(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function normalizeRegion(
  latitude: number,
  longitude: number,
  radiusNm: number,
  config: RegionConfig,
): NormalizedRegion {
  validConfig(config);
  const lat = finite(latitude, "latitude");
  const lonInput = finite(longitude, "longitude");
  if (lat < -90 || lat > 90) throw new TypeError("latitude is out of range");
  if (lonInput < -180 || lonInput > 180) throw new TypeError("longitude is out of range");
  const lon = normalizeLongitude(lonInput);

  const snappedLat = Math.min(
    90,
    Math.max(-90, Math.round(lat / config.cellDegrees) * config.cellDegrees),
  );
  const snappedLon = Math.abs(snappedLat) === 90
    ? 0
    : normalizeLongitude(Math.round(lon / config.cellDegrees) * config.cellDegrees);
  const centerOffsetNm = greatCircleDistanceNm(lat, lon, snappedLat, snappedLon);
  const maxDisplayRadius = config.providerMaxRadiusNm - centerOffsetNm;
  if (maxDisplayRadius < TRAFFIC_MIN_RADIUS_NM) {
    throw new TypeError("providerMaxRadiusNm cannot cover the normalized cell");
  }
  const displayRadius = Math.min(clampTrafficRadiusNm(radiusNm), maxDisplayRadius);
  const coverageRadius = displayRadius + centerOffsetNm;
  const steppedRadius =
    Math.ceil(coverageRadius / config.providerRadiusStepNm) * config.providerRadiusStepNm;
  const providerRadius = Math.min(config.providerMaxRadiusNm, steppedRadius);
  const decimals = Math.max(0, Math.ceil(-Math.log10(config.cellDegrees)) + 2);
  const regionKey = [
    "r1",
    canonical(snappedLat, decimals),
    canonical(snappedLon, decimals),
    canonical(providerRadius, 3),
  ].join(":");

  return {
    regionKey,
    requestedCenter: { lat, lon },
    providerCenter: { lat: snappedLat, lon: snappedLon },
    radiusNm: displayRadius,
    providerRadiusNm: providerRadius,
  };
}

export function filterContactsToRequestedCircle(
  contacts: readonly Contact[],
  region: NormalizedRegion,
): Contact[] {
  return contacts.filter((contact) => {
    if (
      !Number.isFinite(contact.lat) ||
      !Number.isFinite(contact.lon) ||
      contact.lat < -90 ||
      contact.lat > 90 ||
      contact.lon < -180 ||
      contact.lon > 180
    ) return false;
    return greatCircleDistanceNm(
      region.requestedCenter.lat,
      region.requestedCenter.lon,
      contact.lat,
      contact.lon,
    ) <= region.radiusNm;
  });
}
