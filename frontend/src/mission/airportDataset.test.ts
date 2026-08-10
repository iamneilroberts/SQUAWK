import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DATA_VERSIONS } from "../shared/versions";
import { validateAirportManifest, validateAirportShard } from "./airportData";

const root = resolve(process.cwd(), `public/data/airports/${DATA_VERSIONS.airport}`);
const manifest = validateAirportManifest(JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")));

describe("checked-in airport/runway dataset", () => {
  it("pins official source hashes, attribution, counts, and a bounded regional layout", () => {
    expect(manifest.datasetVersion).toBe(DATA_VERSIONS.airport);
    expect(manifest.source.date).toBe("2026-08-10");
    expect(manifest.source.airportsUrl).toContain("ourairports-data/airports.csv");
    expect(manifest.source.runwaysUrl).toContain("ourairports-data/runways.csv");
    expect(manifest.source.airportsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.source.runwaysSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.attribution).toContain("OurAirports");
    expect(manifest.counts.airports).toBeGreaterThan(40_000);
    expect(manifest.counts.runways).toBeGreaterThan(30_000);
    expect(manifest.counts.bytes).toBeLessThan(16 * 1024 * 1024);
    expect(Math.max(...Object.values(manifest.shards).map((entry) => entry.bytes))).toBeLessThan(1024 * 1024);
  });

  it("decodes a real shard into typed mission records", () => {
    const entry = manifest.shards[Object.keys(manifest.shards).sort()[0]];
    const airports = validateAirportShard(JSON.parse(readFileSync(resolve(root, entry.path), "utf8")));
    expect(airports.length).toBe(entry.airportCount);
    expect(airports.reduce((sum, airport) => sum + airport.runways.length, 0)).toBe(entry.runwayCount);
  });
});
