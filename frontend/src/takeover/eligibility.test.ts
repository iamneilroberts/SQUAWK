import { describe, it, expect } from "vitest";
import { checkEligibility, GA_TYPE_DESIGNATORS, MAX_SEEN_POS_S } from "./eligibility";
import type { Contact } from "../data/types";

const ga = (overrides: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.7, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2,
  ...overrides,
});

describe("checkEligibility — the happy path", () => {
  it("accepts a fresh, airborne, civil GA contact", () => {
    expect(checkEligibility(ga())).toEqual({ eligible: true });
  });
  it("accepts every designator in the allowlist", () => {
    // Assert the list is populated FIRST — iterating an empty set would otherwise make
    // this test pass with zero assertions.
    expect(GA_TYPE_DESIGNATORS.size).toBeGreaterThan(50);
    for (const t of GA_TYPE_DESIGNATORS) {
      expect(checkEligibility(ga({ t })).eligible).toBe(true);
    }
  });
  it("accepts a contact with only alt_baro (no alt_geom)", () => {
    expect(checkEligibility(ga({ alt_geom: null })).eligible).toBe(true);
  });
  it("accepts track 0 (due north is a real heading, not missing data)", () => {
    expect(checkEligibility(ga({ track: 0 })).eligible).toBe(true);
  });
  it("accepts gs 0 as a real value", () => {
    expect(checkEligibility(ga({ gs: 0 })).eligible).toBe(true);
  });
});

describe("checkEligibility — each gate names itself", () => {
  const cases: Array<[string, Partial<Contact> | null, RegExp]> = [
    ["nothing selected", null, /NO CONTACT SELECTED/],
    ["no type in the feed", { t: null }, /NO TYPE IN FEED/],
    ["not a GA piston type", { t: "B738" }, /NOT GA PISTON/],
    ["military", { military: true }, /MILITARY/],
    ["on the ground", { alt_baro: "ground" }, /ON GROUND/],
    ["stale position", { seen_pos: 40 }, /POSITION STALE/],
    ["missing seen_pos", { seen_pos: null }, /POSITION STALE/],
    ["no altitude at all", { alt_geom: null, alt_baro: null }, /NO ALTITUDE/],
    ["no ground speed", { gs: null }, /NO GROUND SPEED/],
    ["no track", { track: null }, /NO TRACK/],
  ];
  for (const [name, overrides, pattern] of cases) {
    it(`rejects: ${name}`, () => {
      const result = checkEligibility(overrides === null ? null : ga(overrides));
      expect(result.eligible).toBe(false);
      if (!result.eligible) expect(result.reason).toMatch(pattern);
    });
  }
  it("names the offending type in the reason so the tooltip is useful", () => {
    const r = checkEligibility(ga({ t: "B738" }));
    if (!r.eligible) expect(r.reason).toContain("B738");
  });
  it("names the age in the stale reason", () => {
    const r = checkEligibility(ga({ seen_pos: 40 }));
    if (!r.eligible) expect(r.reason).toContain("40");
  });
});

describe("the freshness threshold", () => {
  it("is 15 s", () => {
    expect(MAX_SEEN_POS_S).toBe(15);
  });
  it("accepts exactly 15 s and rejects just past it", () => {
    expect(checkEligibility(ga({ seen_pos: 15 })).eligible).toBe(true);
    expect(checkEligibility(ga({ seen_pos: 15.1 })).eligible).toBe(false);
  });
});
