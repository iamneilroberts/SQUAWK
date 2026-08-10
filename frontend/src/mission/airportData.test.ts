import { describe, expect, it } from "vitest";
import { loadAirportRegion, shardKeysForRadius, validateAirportManifest, type AirportAssetSource } from "./airportData";
import type { AirportDatasetManifest } from "./types";

const sha = "a".repeat(64);
const manifest: AirportDatasetManifest = {
  schemaVersion: 1,
  recordEncoding: "airport-runway-tuples-v1",
  datasetVersion: "fixture-v1",
  shardDegrees: 10,
  source: { date: "2026-08-10", airportsUrl: "https://example.test/airports", runwaysUrl: "https://example.test/runways", airportsSha256: sha, runwaysSha256: sha },
  attribution: "OurAirports",
  bounds: { south: -90, west: -180, north: 90, east: 180 },
  counts: { airports: 2, runways: 0, shards: 2, bytes: 2 },
  shards: {
    "n00-e170": { path: "shards/n00-e170.json", sha256: sha, bytes: 1, airportCount: 1, runwayCount: 0, bounds: { south: 0, west: 170, north: 10, east: 180 } },
    "n00-w180": { path: "shards/n00-w180.json", sha256: sha, bytes: 1, airportCount: 1, runwayCount: 0, bounds: { south: 0, west: -180, north: 10, east: -170 } },
  },
};

const airport = (ident: string, lonDeg: number): unknown => [ident, null, ident, "small", 5, lonDeg, 0, []];

describe("regional airport data loading", () => {
  it("selects both sides of an antimeridian search without selecting the world", () => {
    expect(shardKeysForRadius(manifest, 5, 179.9, 30)).toEqual(["n00-e170", "n00-w180"]);
  });

  it("includes every longitude when the search circle reaches a pole", () => {
    const polar = structuredClone(manifest);
    polar.shards = {
      "n80-w180": { ...manifest.shards["n00-w180"], path: "shards/n80-w180.json", bounds: { south: 80, west: -180, north: 90, east: -170 } },
      "n80-e000": { ...manifest.shards["n00-e170"], path: "shards/n80-e000.json", bounds: { south: 80, west: 0, north: 90, east: 10 } },
      "n80-e170": { ...manifest.shards["n00-e170"], path: "shards/n80-e170.json", bounds: { south: 80, west: 170, north: 90, east: 180 } },
    };
    expect(shardKeysForRadius(polar, 89, 0, 61)).toEqual(["n80-e000", "n80-e170", "n80-w180"]);
  });

  it("uses the same exact version and paths for any asset source adapter", async () => {
    const requested: string[] = [];
    const values = new Map<string, unknown>([
      ["/data/airports/fixture-v1/manifest.json", manifest],
      ["/data/airports/fixture-v1/shards/n00-e170.json", [airport("EAST", 179.8)]],
      ["/data/airports/fixture-v1/shards/n00-w180.json", [airport("WEST", -179.8)]],
    ]);
    const source: AirportAssetSource = {
      async fetch(path) {
        requested.push(path);
        return { ok: values.has(path), status: values.has(path) ? 200 : 404, async json() { return values.get(path); } };
      },
    };
    const result = await loadAirportRegion({ source, latDeg: 5, lonDeg: 179.9, radiusNm: 30, version: "fixture-v1" });
    expect(result.airports.map((value) => value.ident)).toEqual(["EAST", "WEST"]);
    expect(requested).toEqual([
      "/data/airports/fixture-v1/manifest.json",
      "/data/airports/fixture-v1/shards/n00-e170.json",
      "/data/airports/fixture-v1/shards/n00-w180.json",
    ]);
  });

  it("rejects a manifest from a different dataset version", () => {
    expect(() => validateAirportManifest(manifest, "other-v1")).toThrow(/version mismatch/);
  });
});
