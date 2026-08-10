import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(process.cwd(), "../scripts/generate-ourairports.mjs");
const fixtures = resolve(process.cwd(), "../scripts/fixtures/ourairports");

function generate(root: string): string {
  execFileSync(process.execPath, [
    script,
    "--airports", join(fixtures, "airports.csv"),
    "--runways", join(fixtures, "runways.csv"),
    "--output", root,
    "--version", "oa-2026-08-10-v1",
    "--source-date", "2026-08-10",
    "--airports-url", "https://example.test/airports.csv",
    "--runways-url", "https://example.test/runways.csv",
  ], { stdio: "pipe" });
  return join(root, "oa-2026-08-10-v1");
}

describe("OurAirports generator", () => {
  it("is deterministic, retains small airports, and normalizes runway truth", () => {
    const temp = mkdtempSync(join(tmpdir(), "adsb-airports-"));
    try {
      const first = generate(join(temp, "first"));
      const second = generate(join(temp, "second"));
      expect(readFileSync(join(first, "manifest.json"), "utf8")).toBe(readFileSync(join(second, "manifest.json"), "utf8"));
      const firstFiles = readdirSync(join(first, "shards")).sort();
      expect(firstFiles).toEqual(readdirSync(join(second, "shards")).sort());
      for (const file of firstFiles) {
        expect(readFileSync(join(first, "shards", file), "utf8")).toBe(readFileSync(join(second, "shards", file), "utf8"));
      }
      const manifest = JSON.parse(readFileSync(join(first, "manifest.json"), "utf8"));
      expect(manifest.counts).toMatchObject({ airports: 3, runways: 4 });
      expect(manifest.attribution).toContain("OurAirports");
      const airports = firstFiles.flatMap((file) => JSON.parse(readFileSync(join(first, "shards", file), "utf8")));
      expect(airports.map((airport: unknown[]) => airport[0]).sort()).toEqual(["KAAA", "KBBB", "KCCC"]);
      const alpha = airports.find((airport: unknown[]) => airport[0] === "KAAA");
      expect(alpha[3]).toBe("small");
      expect(alpha[2]).toBe("Alpha, Field");
      expect(alpha[7].map((value: unknown[]) => value[3])).toEqual(["GRASS", "HARD"]);
      expect(alpha[7][1].slice(5, 7)).toEqual([1, 1]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("fails validation after a checked shard is modified", () => {
    const temp = mkdtempSync(join(tmpdir(), "adsb-airports-"));
    try {
      const generated = generate(temp);
      const manifest = JSON.parse(readFileSync(join(generated, "manifest.json"), "utf8"));
      const first = Object.values(manifest.shards)[0] as { path: string };
      writeFileSync(join(generated, first.path), "[]\n");
      expect(() => execFileSync(process.execPath, [script, "--validate", join(generated, "manifest.json")], { stdio: "pipe" })).toThrow();
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
