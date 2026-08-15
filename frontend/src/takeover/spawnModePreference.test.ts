import { describe, expect, it } from "vitest";
import { readSpawnMode, writeSpawnMode, isRepositionMode, SPAWN_MODE_STORAGE_KEY } from "./spawnModePreference";

function mem(init: Record<string,string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), _m: m };
}
describe("spawnModePreference", () => {
  it("defaults to faceApproach when unset or null", () => {
    expect(readSpawnMode(null)).toBe("faceApproach");
    expect(readSpawnMode(mem())).toBe("faceApproach");
  });
  it("round-trips each mode", () => {
    const s = mem();
    for (const mode of ["real","faceApproach","base","final"] as const) {
      writeSpawnMode(s, mode); expect(readSpawnMode(s)).toBe(mode);
    }
  });
  it("migrates the old heading-to-FAF key", () => {
    expect(readSpawnMode(mem({ "adsb.handoff-heading-to-faf.v1": "off" }))).toBe("real");
    expect(readSpawnMode(mem({ "adsb.handoff-heading-to-faf.v1": "on" }))).toBe("faceApproach");
  });
  it("flags reposition modes", () => {
    expect(isRepositionMode("base")).toBe(true);
    expect(isRepositionMode("final")).toBe(true);
    expect(isRepositionMode("real")).toBe(false);
    expect(isRepositionMode("faceApproach")).toBe(false);
  });
  it("returns default when getItem throws", () => {
    expect(readSpawnMode({ getItem: () => { throw new Error("x"); } })).toBe("faceApproach");
  });
});
