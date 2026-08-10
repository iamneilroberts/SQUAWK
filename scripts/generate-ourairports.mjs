#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const SCHEMA_VERSION = 1;
const SHARD_DEGREES = 10;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_SHARD_BYTES = 1024 * 1024;
const AIRPORT_TYPES = new Map([
  ["small_airport", "small"],
  ["medium_airport", "medium"],
  ["large_airport", "large"],
]);

function die(message) {
  throw new Error(`generate-ourairports: ${message}`);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) die(`unexpected argument ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) die(`${key} requires a value`);
    result[key.slice(2)] = value;
    i += 1;
  }
  return result;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) die("unterminated quoted CSV field");
  if (field !== "" || row.length > 0) {
    row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((values) =>
    Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])),
  );
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized === "" ? null : normalized;
}

function finite(value, options = {}) {
  const normalized = text(value);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  const rounded = options.integer ? Math.round(parsed) : Number(parsed.toFixed(options.digits ?? 6));
  if (options.min !== undefined && rounded < options.min) return null;
  if (options.max !== undefined && rounded > options.max) return null;
  return rounded;
}

function flag(value) {
  return String(value ?? "").trim() === "1";
}

export function normalizeSurface(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  const tokens = new Set(raw.split(/[^A-Z0-9]+/).filter(Boolean));
  const has = (...names) => names.some((name) => tokens.has(name) || raw === name);
  if (has("WATER", "WTR", "LAKE", "SEA")) return "WATER";
  if (has("SNOW", "ICE")) return "SNOW_ICE";
  if (has("ASPH", "ASP", "ASPHALT", "CONC", "CON", "CONCRETE", "BIT", "BITUMEN", "PAVED", "PAV", "TARMAC", "PEM")) return "HARD";
  if (has("GRAVEL", "GRVL", "GRV", "GVL")) return "GRAVEL";
  if (has("GRASS", "GRS", "TURF", "SOD")) return "GRASS";
  if (has("DIRT", "EARTH", "CLAY", "SOIL")) return "DIRT";
  if (has("SAND")) return "SAND";
  return "OTHER";
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function compactEnd(end) {
  return end === null ? null : [
    end.ident,
    end.latDeg,
    end.lonDeg,
    end.elevationFt,
    end.headingDeg,
    end.displacedThresholdFt,
  ];
}

function compactAirport(airport) {
  return [
    airport.ident,
    airport.iata,
    airport.name,
    airport.size,
    airport.latDeg,
    airport.lonDeg,
    airport.elevationFt,
    airport.runways.map((runway) => [
      runway.id,
      runway.lengthFt,
      runway.widthFt,
      runway.surface,
      runway.surfaceRaw,
      runway.lighted ? 1 : 0,
      runway.closed ? 1 : 0,
      compactEnd(runway.lowEnd),
      compactEnd(runway.highEnd),
    ]),
  ];
}

function normalizeLongitude(lonDeg) {
  const wrapped = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function shardKey(latDeg, lonDeg) {
  const lat = Math.max(-90, Math.min(89.999999, latDeg));
  const lon = normalizeLongitude(lonDeg);
  const south = Math.floor((lat + 90) / SHARD_DEGREES) * SHARD_DEGREES - 90;
  const west = Math.floor((lon + 180) / SHARD_DEGREES) * SHARD_DEGREES - 180;
  const latitude = `${south < 0 ? "s" : "n"}${String(Math.abs(south)).padStart(2, "0")}`;
  const longitude = `${west < 0 ? "w" : "e"}${String(Math.abs(west)).padStart(3, "0")}`;
  return `${latitude}-${longitude}`;
}

function shardBounds(key) {
  const match = /^([ns])(\d{2})-([ew])(\d{3})$/.exec(key);
  if (!match) die(`invalid shard key ${key}`);
  const south = Number(match[2]) * (match[1] === "s" ? -1 : 1);
  const west = Number(match[4]) * (match[3] === "w" ? -1 : 1);
  return { south, west, north: south + SHARD_DEGREES, east: west + SHARD_DEGREES };
}

function runwayEnd(row, prefix) {
  const ident = text(row[`${prefix}_ident`]);
  const latDeg = finite(row[`${prefix}_latitude_deg`], { min: -90, max: 90 });
  const lonDeg = finite(row[`${prefix}_longitude_deg`], { min: -180, max: 180 });
  const elevationFt = finite(row[`${prefix}_elevation_ft`], { integer: true });
  const headingDeg = finite(row[`${prefix}_heading_degT`], { min: 0, max: 360, digits: 3 });
  const displacedThresholdFt = finite(row[`${prefix}_displaced_threshold_ft`], { integer: true, min: 0 });
  if (ident === null && latDeg === null && lonDeg === null && elevationFt === null && headingDeg === null) {
    return null;
  }
  return { ident, latDeg, lonDeg, elevationFt, headingDeg, displacedThresholdFt };
}

export function buildDataset(airportRows, runwayRows) {
  const airports = new Map();
  for (const row of airportRows) {
    const size = AIRPORT_TYPES.get(text(row.type));
    const ident = text(row.ident);
    const latDeg = finite(row.latitude_deg, { min: -90, max: 90 });
    const lonDeg = finite(row.longitude_deg, { min: -180, max: 180 });
    if (size === undefined || ident === null || latDeg === null || lonDeg === null) continue;
    airports.set(ident, {
      ident,
      iata: text(row.iata_code),
      name: text(row.name) ?? "",
      size,
      latDeg,
      lonDeg: normalizeLongitude(lonDeg),
      elevationFt: finite(row.elevation_ft, { integer: true }),
      runways: [],
    });
  }

  for (const row of runwayRows) {
    const airport = airports.get(text(row.airport_ident));
    const id = text(row.id);
    if (!airport || id === null) continue;
    const surfaceRaw = text(row.surface) ?? "";
    airport.runways.push({
      id,
      lengthFt: finite(row.length_ft, { integer: true, min: 0 }),
      widthFt: finite(row.width_ft, { integer: true, min: 0 }),
      surface: normalizeSurface(surfaceRaw),
      surfaceRaw,
      lighted: flag(row.lighted),
      closed: flag(row.closed),
      lowEnd: runwayEnd(row, "le"),
      highEnd: runwayEnd(row, "he"),
    });
  }

  const sorted = [...airports.values()].sort((a, b) => a.ident.localeCompare(b.ident));
  for (const airport of sorted) {
    airport.runways.sort((a, b) => a.id.localeCompare(b.id));
  }
  return sorted;
}

function writeDataset(options) {
  const version = options.version;
  if (!/^oa-\d{4}-\d{2}-\d{2}-v\d+$/.test(version)) {
    die("--version must match oa-YYYY-MM-DD-vN");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.sourceDate)) {
    die("--source-date must be YYYY-MM-DD");
  }
  const outputRoot = resolve(options.output);
  const outputDir = resolve(outputRoot, version);
  if (dirname(outputDir) !== outputRoot || !outputDir.split(sep).at(-1)?.startsWith("oa-")) {
    die("refusing unsafe output path");
  }

  const airportsBytes = readFileSync(options.airports);
  const runwaysBytes = readFileSync(options.runways);
  const sourceHashes = { airportsSha256: sha256(airportsBytes), runwaysSha256: sha256(runwaysBytes) };
  const previousManifestPath = join(outputDir, "manifest.json");
  if (existsSync(previousManifestPath)) {
    const previous = JSON.parse(readFileSync(previousManifestPath, "utf8"));
    if (previous?.source?.airportsSha256 !== sourceHashes.airportsSha256 ||
        previous?.source?.runwaysSha256 !== sourceHashes.runwaysSha256) {
      die(`dataset version ${version} already exists for different source bytes; increment the version`);
    }
  }
  const airports = buildDataset(parseCsv(airportsBytes.toString("utf8")), parseCsv(runwaysBytes.toString("utf8")));
  if (airports.length === 0) die("source produced no airports");

  const grouped = new Map();
  for (const airport of airports) {
    const key = shardKey(airport.latDeg, airport.lonDeg);
    const bucket = grouped.get(key) ?? [];
    bucket.push(airport);
    grouped.set(key, bucket);
  }

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(join(outputDir, "shards"), { recursive: true });
  const shards = {};
  let totalBytes = 0;
  let runwayCount = 0;
  for (const key of [...grouped.keys()].sort()) {
    const records = grouped.get(key);
    const body = stableJson(records.map(compactAirport));
    const path = `shards/${key}.json`;
    writeFileSync(join(outputDir, path), body);
    const bytes = Buffer.byteLength(body);
    const shardRunways = records.reduce((sum, airport) => sum + airport.runways.length, 0);
    totalBytes += bytes;
    runwayCount += shardRunways;
    shards[key] = {
      path,
      sha256: sha256(body),
      bytes,
      airportCount: records.length,
      runwayCount: shardRunways,
      bounds: shardBounds(key),
    };
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    recordEncoding: "airport-runway-tuples-v1",
    datasetVersion: version,
    shardDegrees: SHARD_DEGREES,
    source: {
      date: options.sourceDate,
      airportsUrl: options.airportsUrl,
      runwaysUrl: options.runwaysUrl,
      ...sourceHashes,
    },
    attribution: "Airport and runway data: OurAirports (public domain)",
    bounds: { south: -90, west: -180, north: 90, east: 180 },
    counts: { airports: airports.length, runways: runwayCount, shards: Object.keys(shards).length, bytes: totalBytes },
    shards,
  };
  writeFileSync(join(outputDir, "manifest.json"), stableJson(manifest));
  return manifest;
}

function assertObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) die(`${label} must be an object`);
  return value;
}

function validateWireAirport(airport, label) {
  if (!Array.isArray(airport) || airport.length !== 8) die(`${label} must be an airport tuple`);
  if (typeof airport[0] !== "string" || airport[0].length === 0) die(`${label} ident is invalid`);
  if (!new Set(["small", "medium", "large"]).has(airport[3])) die(`${label} size is invalid`);
  if (!Number.isFinite(airport[4]) || airport[4] < -90 || airport[4] > 90 ||
      !Number.isFinite(airport[5]) || airport[5] < -180 || airport[5] > 180) {
    die(`${label} position is invalid`);
  }
  if (!Array.isArray(airport[7])) die(`${label} runways must be an array`);
  for (let index = 0; index < airport[7].length; index += 1) {
    const runway = airport[7][index];
    if (!Array.isArray(runway) || runway.length !== 9 || typeof runway[0] !== "string") {
      die(`${label} runway ${index} is invalid`);
    }
    if (!new Set(["HARD", "GRAVEL", "GRASS", "DIRT", "SAND", "WATER", "SNOW_ICE", "OTHER"]).has(runway[3])) {
      die(`${label} runway ${index} surface is invalid`);
    }
    if ((runway[1] !== null && (!Number.isFinite(runway[1]) || runway[1] < 0)) ||
        (runway[2] !== null && (!Number.isFinite(runway[2]) || runway[2] < 0)) ||
        !new Set([0, 1]).has(runway[5]) || !new Set([0, 1]).has(runway[6])) {
      die(`${label} runway ${index} dimensions or flags are invalid`);
    }
    for (const end of [runway[7], runway[8]]) {
      if (end !== null && (!Array.isArray(end) || end.length !== 6)) die(`${label} runway ${index} end is invalid`);
    }
  }
}

function validateDataset(manifestPath, maxBytes = DEFAULT_MAX_BYTES) {
  const absoluteManifest = resolve(manifestPath);
  const root = dirname(absoluteManifest);
  const manifest = assertObject(JSON.parse(readFileSync(absoluteManifest, "utf8")), "manifest");
  if (manifest.schemaVersion !== SCHEMA_VERSION) die(`unsupported schemaVersion ${manifest.schemaVersion}`);
  if (manifest.recordEncoding !== "airport-runway-tuples-v1") die(`unsupported recordEncoding ${manifest.recordEncoding}`);
  if (typeof manifest.datasetVersion !== "string" || manifest.datasetVersion !== root.split(sep).at(-1)) {
    die("manifest datasetVersion must match its directory");
  }
  const shards = assertObject(manifest.shards, "manifest.shards");
  let airports = 0;
  let runways = 0;
  let bytes = 0;
  const expectedFiles = [];
  for (const key of Object.keys(shards).sort()) {
    const entry = assertObject(shards[key], `shards.${key}`);
    const expectedPath = `shards/${key}.json`;
    if (entry.path !== expectedPath) die(`${key} path must be ${expectedPath}`);
    const filePath = resolve(root, expectedPath);
    if (!filePath.startsWith(`${root}${sep}`)) die(`${key} escaped dataset root`);
    const body = readFileSync(filePath);
    if (entry.bytes !== body.byteLength) die(`${key} byte count mismatch`);
    if (body.byteLength > MAX_SHARD_BYTES) die(`${key} is ${body.byteLength} bytes, above ${MAX_SHARD_BYTES}`);
    if (entry.sha256 !== sha256(body)) die(`${key} checksum mismatch`);
    const records = JSON.parse(body.toString("utf8"));
    if (!Array.isArray(records)) die(`${key} must contain an array`);
    records.forEach((airport, index) => validateWireAirport(airport, `${key}[${index}]`));
    const runwayCount = records.reduce((sum, airport) => sum + (Array.isArray(airport?.[7]) ? airport[7].length : 0), 0);
    if (entry.airportCount !== records.length || entry.runwayCount !== runwayCount) die(`${key} record count mismatch`);
    airports += records.length;
    runways += runwayCount;
    bytes += body.byteLength;
    expectedFiles.push(`${key}.json`);
  }
  const actualFiles = readdirSync(join(root, "shards")).filter((name) => statSync(join(root, "shards", name)).isFile()).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) die("unexpected or missing shard files");
  if (bytes > maxBytes) die(`shards use ${bytes} bytes, above ${maxBytes}`);
  const counts = assertObject(manifest.counts, "manifest.counts");
  if (counts.airports !== airports || counts.runways !== runways || counts.shards !== expectedFiles.length || counts.bytes !== bytes) {
    die("manifest total count mismatch");
  }
  return { datasetVersion: manifest.datasetVersion, airports, runways, shards: expectedFiles.length, bytes };
}

function usage() {
  return "generate: --airports FILE --runways FILE --output DIR --version oa-YYYY-MM-DD-vN --source-date YYYY-MM-DD --airports-url URL --runways-url URL\nvalidate: --validate MANIFEST [--max-bytes N]";
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.validate) {
      const result = validateDataset(args.validate, args["max-bytes"] ? Number(args["max-bytes"]) : undefined);
      process.stdout.write(`validated ${result.datasetVersion}: ${result.airports} airports, ${result.runways} runways, ${result.shards} shards, ${result.bytes} bytes\n`);
    } else {
      for (const required of ["airports", "runways", "output", "version", "source-date", "airports-url", "runways-url"]) {
        if (!args[required]) die(`missing --${required}\n${usage()}`);
      }
      const manifest = writeDataset({
        airports: args.airports,
        runways: args.runways,
        output: args.output,
        version: args.version,
        sourceDate: args["source-date"],
        airportsUrl: args["airports-url"],
        runwaysUrl: args["runways-url"],
      });
      process.stdout.write(`wrote ${manifest.datasetVersion}: ${manifest.counts.airports} airports, ${manifest.counts.runways} runways, ${manifest.counts.shards} shards, ${manifest.counts.bytes} bytes\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { validateDataset, writeDataset };
