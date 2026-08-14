import { describe, expect, it } from "vitest";
import { shouldFaceApproach, setFaceApproach, HEADING_TO_FAF_STORAGE_KEY } from "./headingToFafPreference";

function memStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    _m: m,
  };
}

describe("headingToFafPreference", () => {
  it("defaults to true when unset or storage is null", () => {
    expect(shouldFaceApproach(null)).toBe(true);
    expect(shouldFaceApproach(memStore())).toBe(true);
  });
  it("round-trips a false then true setting", () => {
    const s = memStore();
    setFaceApproach(s, false);
    expect(s._m.get(HEADING_TO_FAF_STORAGE_KEY)).toBe("off");
    expect(shouldFaceApproach(s)).toBe(false);
    setFaceApproach(s, true);
    expect(shouldFaceApproach(s)).toBe(true);
  });
  it("returns true when getItem throws", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); } };
    expect(shouldFaceApproach(throwing)).toBe(true);
  });
});
