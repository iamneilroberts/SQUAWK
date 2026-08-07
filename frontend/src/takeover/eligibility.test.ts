import { describe, it, expect } from "vitest";
import { resolveClass, checkEligibility, disclosureLine, MAX_SEEN_POS_S } from "./eligibility";
import { loadClassById } from "../sim/params";
import type { Contact } from "../data/types";

function contact(over: Partial<Contact> = {}): Contact {
  return { hex: "abc123", flight: "TEST", t: "C172", alt_geom: 10000, alt_baro: 10000,
    gs: 110, track: 90, lat: 30, lon: -88, military: false, seen_pos: 2, ...over } as Contact;
}

describe("resolveClass", () => {
  it("maps an airliner designator to b738", () => {
    expect(resolveClass(contact({ t: "A320" }))).toEqual({ classId: "b738", matched: true });
  });
  it("maps a fighter designator to f5e — including a military fast-jet", () => {
    expect(resolveClass(contact({ t: "F16", military: true }))).toEqual({ classId: "f5e", matched: true });
  });
  it("maps a GA designator to c172s", () => {
    expect(resolveClass(contact({ t: "PA28" }))).toEqual({ classId: "c172s", matched: true });
  });
  it("falls to c172s (unmatched) for an unknown type", () => {
    expect(resolveClass(contact({ t: "C130" }))).toEqual({ classId: "c172s", matched: false });
  });
  it("falls to c172s (unmatched) for a missing type", () => {
    expect(resolveClass(contact({ t: null }))).toEqual({ classId: "c172s", matched: false });
  });
});

describe("checkEligibility — physical gates only", () => {
  it("no longer refuses a military contact", () => {
    expect(checkEligibility(contact({ t: "F16", military: true }))).toEqual({ eligible: true });
  });
  it("no longer refuses a non-GA type", () => {
    expect(checkEligibility(contact({ t: "A320" }))).toEqual({ eligible: true });
  });
  it("still refuses on the ground", () => {
    expect(checkEligibility(contact({ alt_baro: "ground" })).eligible).toBe(false);
  });
  it("still refuses a stale position", () => {
    expect(checkEligibility(contact({ seen_pos: 40 })).eligible).toBe(false);
  });
  it("still refuses no ground speed / no track / no altitude", () => {
    expect(checkEligibility(contact({ gs: null })).eligible).toBe(false);
    expect(checkEligibility(contact({ track: null })).eligible).toBe(false);
    expect(checkEligibility(contact({ alt_geom: null, alt_baro: null })).eligible).toBe(false);
  });
  it("rejects nothing selected", () => {
    expect(checkEligibility(null)).toEqual({ eligible: false, reason: "NO CONTACT SELECTED" });
  });
  it("names the age in the stale reason", () => {
    const r = checkEligibility(contact({ seen_pos: 40 }));
    if (!r.eligible) expect(r.reason).toContain("40");
  });
  it("missing seen_pos is stale", () => {
    expect(checkEligibility(contact({ seen_pos: null })).eligible).toBe(false);
  });
  it("accepts track 0 and gs 0 as real values, not missing data", () => {
    expect(checkEligibility(contact({ track: 0 })).eligible).toBe(true);
    expect(checkEligibility(contact({ gs: 0 })).eligible).toBe(true);
  });
});

describe("the freshness threshold", () => {
  it("is 15 s", () => {
    expect(MAX_SEEN_POS_S).toBe(15);
  });
  it("accepts exactly 15 s and rejects just past it", () => {
    expect(checkEligibility(contact({ seen_pos: 15 })).eligible).toBe(true);
    expect(checkEligibility(contact({ seen_pos: 15.1 })).eligible).toBe(false);
  });
});

describe("disclosureLine", () => {
  it("shows REAL TYPE → MODEL for a matched class", () => {
    const p = loadClassById("b738");
    expect(disclosureLine(contact({ t: "A320" }), p, true)).toBe("A320 → 737-800 MODEL");
  });
  it("flags an unmatched substitution", () => {
    const p = loadClassById("c172s");
    expect(disclosureLine(contact({ t: "C130" }), p, false)).toBe("C130 → C172 MODEL THIS BUILD (NO MATCHING CLASS)");
  });
  it("renders an em-dash for a missing type", () => {
    const p = loadClassById("c172s");
    expect(disclosureLine(contact({ t: null }), p, false)).toBe("— → C172 MODEL THIS BUILD (NO MATCHING CLASS)");
  });
});
