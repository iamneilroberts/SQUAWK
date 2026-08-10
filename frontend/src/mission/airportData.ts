import { DATA_VERSIONS } from "../shared/versions";
import { EARTH_RADIUS_NM, normalizeLongitude, radToDeg } from "./geo";
import type {
  AirportDatasetManifest,
  AirportShardManifestEntry,
  AirportSize,
  MissionAirport,
  Runway,
  RunwayEnd,
  RunwaySurface,
} from "./types";

export type AirportAssetResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type AirportAssetSource = {
  fetch(path: string): Promise<AirportAssetResponse>;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} is invalid`);
  return value;
}

export function validateAirportManifest(value: unknown, expectedVersion: string = DATA_VERSIONS.airport): AirportDatasetManifest {
  const manifest = object(value, "airport manifest") as AirportDatasetManifest;
  if (manifest.schemaVersion !== 1) throw new Error("airport manifest schemaVersion is unsupported");
  if (manifest.recordEncoding !== "airport-runway-tuples-v1") throw new Error("airport record encoding is unsupported");
  if (manifest.datasetVersion !== expectedVersion) throw new Error(`airport dataset version mismatch: ${manifest.datasetVersion}`);
  if (manifest.shardDegrees !== 10) throw new Error("airport shard size is unsupported");
  object(manifest.source, "airport manifest source");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.source.date) ||
      !manifest.source.airportsUrl.startsWith("https://") || !manifest.source.runwaysUrl.startsWith("https://") ||
      !/^[a-f0-9]{64}$/.test(manifest.source.airportsSha256) || !/^[a-f0-9]{64}$/.test(manifest.source.runwaysSha256)) {
    throw new Error("airport manifest source is invalid");
  }
  object(manifest.counts, "airport manifest counts");
  for (const [key, count] of Object.entries(manifest.counts)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`airport manifest count ${key} is invalid`);
  }
  object(manifest.shards, "airport manifest shards");
  for (const [key, rawEntry] of Object.entries(manifest.shards)) {
    const entry = object(rawEntry, `airport shard ${key}`) as AirportShardManifestEntry;
    if (entry.path !== `shards/${key}.json` || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`airport shard ${key} metadata is invalid`);
    for (const [label, count] of Object.entries({ bytes: entry.bytes, airportCount: entry.airportCount, runwayCount: entry.runwayCount })) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error(`airport shard ${key} ${label} is invalid`);
    }
    finite(entry.bounds.south, `${key}.south`, -90, 90);
    finite(entry.bounds.north, `${key}.north`, -90, 90);
    finite(entry.bounds.west, `${key}.west`, -180, 180);
    finite(entry.bounds.east, `${key}.east`, -180, 180);
  }
  return manifest;
}

function nullableFinite(value: unknown, label: string, min: number, max: number): number | null {
  return value === null ? null : finite(value, label, min, max);
}

function decodeEnd(value: unknown, label: string): RunwayEnd | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 6) throw new Error(`${label} is invalid`);
  const ident = value[0];
  if (ident !== null && typeof ident !== "string") throw new Error(`${label}.ident is invalid`);
  return {
    ident,
    latDeg: nullableFinite(value[1], `${label}.latDeg`, -90, 90),
    lonDeg: nullableFinite(value[2], `${label}.lonDeg`, -180, 180),
    elevationFt: nullableFinite(value[3], `${label}.elevationFt`, -2000, 30000),
    headingDeg: nullableFinite(value[4], `${label}.headingDeg`, 0, 360),
    displacedThresholdFt: nullableFinite(value[5], `${label}.displacedThresholdFt`, 0, 30000),
  };
}

function decodeRunway(value: unknown, label: string): Runway {
  if (!Array.isArray(value) || value.length !== 9) throw new Error(`${label} is invalid`);
  const [id, lengthFt, widthFt, surface, surfaceRaw, lighted, closed, lowEnd, highEnd] = value;
  if (typeof id !== "string" || typeof surfaceRaw !== "string") throw new Error(`${label} text fields are invalid`);
  if (!(["HARD", "GRAVEL", "GRASS", "DIRT", "SAND", "WATER", "SNOW_ICE", "OTHER"] as const).includes(surface as RunwaySurface)) {
    throw new Error(`${label}.surface is invalid`);
  }
  if ((lighted !== 0 && lighted !== 1) || (closed !== 0 && closed !== 1)) throw new Error(`${label} flags are invalid`);
  return {
    id,
    lengthFt: nullableFinite(lengthFt, `${label}.lengthFt`, 0, 100000),
    widthFt: nullableFinite(widthFt, `${label}.widthFt`, 0, 10000),
    surface: surface as RunwaySurface,
    surfaceRaw,
    lighted: lighted === 1,
    closed: closed === 1,
    lowEnd: decodeEnd(lowEnd, `${label}.lowEnd`),
    highEnd: decodeEnd(highEnd, `${label}.highEnd`),
  };
}

export function validateAirportShard(value: unknown): MissionAirport[] {
  if (!Array.isArray(value)) throw new Error("airport shard must be an array");
  return value.map((raw, index) => {
    if (!Array.isArray(raw) || raw.length !== 8) throw new Error(`airport[${index}] is invalid`);
    const [ident, iata, name, size, latDeg, lonDeg, elevationFt, runways] = raw;
    if (typeof ident !== "string" || ident.length === 0 || (iata !== null && typeof iata !== "string") || typeof name !== "string") {
      throw new Error(`airport[${index}] text fields are invalid`);
    }
    if (!(["small", "medium", "large"] as const).includes(size as AirportSize)) throw new Error(`airport[${index}].size is invalid`);
    if (!Array.isArray(runways)) throw new Error(`airport[${index}].runways is invalid`);
    return {
      ident,
      iata,
      name,
      size: size as AirportSize,
      latDeg: finite(latDeg, `airport[${index}].latDeg`, -90, 90),
      lonDeg: finite(lonDeg, `airport[${index}].lonDeg`, -180, 180),
      elevationFt: nullableFinite(elevationFt, `airport[${index}].elevationFt`, -2000, 30000),
      runways: runways.map((runway, runwayIndex) => decodeRunway(runway, `airport[${index}].runways[${runwayIndex}]`)),
    };
  });
}

function manifestPath(version: string): string {
  return `/data/airports/${version}/manifest.json`;
}

function intersectsLongitude(west: number, east: number, minLon: number, maxLon: number): boolean {
  if (minLon <= maxLon) return east >= minLon && west <= maxLon;
  return east >= minLon || west <= maxLon;
}

export function shardKeysForRadius(manifest: AirportDatasetManifest, latDeg: number, lonDeg: number, radiusNm: number): string[] {
  finite(latDeg, "airport search latitude", -90, 90);
  finite(lonDeg, "airport search longitude", -180, 180);
  if (!Number.isFinite(radiusNm) || radiusNm <= 0 || radiusNm > 1000) throw new Error("airport search radius is invalid");
  const angularRadius = radiusNm / EARTH_RADIUS_NM;
  const latDelta = radToDeg(angularRadius);
  const south = Math.max(-90, latDeg - latDelta);
  const north = Math.min(90, latDeg + latDelta);
  const latitudeRad = latDeg * Math.PI / 180;
  const coversAllLongitude = north >= 90 || south <= -90;
  const ratio = Math.sin(angularRadius) / Math.max(Number.EPSILON, Math.cos(latitudeRad));
  const lonDelta = coversAllLongitude ? 180 : radToDeg(Math.asin(Math.min(1, Math.max(-1, ratio))));
  const minLon = normalizeLongitude(lonDeg - lonDelta);
  const maxLon = normalizeLongitude(lonDeg + lonDelta);
  return Object.entries(manifest.shards)
    .filter(([, entry]) => entry.bounds.north >= south && entry.bounds.south <= north)
    .filter(([, entry]) => coversAllLongitude || intersectsLongitude(entry.bounds.west, entry.bounds.east, minLon, maxLon))
    .map(([key]) => key)
    .sort();
}

async function fetchJson(source: AirportAssetSource, path: string): Promise<unknown> {
  const response = await source.fetch(path);
  if (!response.ok) throw new Error(`airport asset ${path} returned ${response.status}`);
  return response.json();
}

export async function loadAirportManifest(source: AirportAssetSource, version: string = DATA_VERSIONS.airport): Promise<AirportDatasetManifest> {
  return validateAirportManifest(await fetchJson(source, manifestPath(version)), version);
}

export async function loadAirportRegion(options: {
  source: AirportAssetSource;
  latDeg: number;
  lonDeg: number;
  radiusNm: number;
  version?: string;
}): Promise<{ manifest: AirportDatasetManifest; airports: MissionAirport[]; shardKeys: string[] }> {
  const version = options.version ?? DATA_VERSIONS.airport;
  const manifest = await loadAirportManifest(options.source, version);
  const shardKeys = shardKeysForRadius(manifest, options.latDeg, options.lonDeg, options.radiusNm);
  const shards = await Promise.all(shardKeys.map(async (key) => {
    const path = `/data/airports/${version}/${manifest.shards[key].path}`;
    return validateAirportShard(await fetchJson(options.source, path));
  }));
  const airports = shards.flat().sort((a, b) => a.ident.localeCompare(b.ident));
  return { manifest, airports, shardKeys };
}
