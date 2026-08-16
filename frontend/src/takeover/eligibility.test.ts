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
    expect(resolveClass(contact({ t: "A320" }))).toEqual({ supported: true, classId: "b738", matched: true });
  });
  it("maps a fighter designator to f5e — including a military fast-jet", () => {
    expect(resolveClass(contact({ t: "F16", military: true }))).toEqual({ supported: true, classId: "f5e", matched: true });
  });
  it("maps a GA designator to c172s", () => {
    expect(resolveClass(contact({ t: "PA28" }))).toEqual({ supported: true, classId: "c172s", matched: true });
  });
  it("maps a business-jet designator to biz", () => {
    expect(resolveClass(contact({ t: "C25A" }))).toEqual({ supported: true, classId: "biz", matched: true });
    expect(resolveClass(contact({ t: "GLF6" }))).toEqual({ supported: true, classId: "biz", matched: true });
  });
  it("maps a light/mid turboprop designator to tprop", () => {
    expect(resolveClass(contact({ t: "B350" }))).toEqual({ supported: true, classId: "tprop", matched: true });
    expect(resolveClass(contact({ t: "PC12" }))).toEqual({ supported: true, classId: "tprop", matched: true });
    expect(resolveClass(contact({ t: "C208" }))).toEqual({ supported: true, classId: "tprop", matched: true });
  });
  it("keeps regional turboprops in the airliner bucket (decision B)", () => {
    expect(resolveClass(contact({ t: "DH8D" }))).toEqual({ supported: true, classId: "b738", matched: true });
    expect(resolveClass(contact({ t: "AT72" }))).toEqual({ supported: true, classId: "b738", matched: true });
  });
  it("maps a T-6 Texan II designator to t6", () => {
    expect(resolveClass(contact({ t: "T6" }))).toEqual({ supported: true, classId: "t6", matched: true });
    expect(resolveClass(contact({ t: "TEX2" }))).toEqual({ supported: true, classId: "t6", matched: true });
  });
  it("maps a C-130 Hercules designator to c130", () => {
    expect(resolveClass(contact({ t: "C130" }))).toEqual({ supported: true, classId: "c130", matched: true });
    expect(resolveClass(contact({ t: "L100" }))).toEqual({ supported: true, classId: "c130", matched: true });
  });
  it("keeps the C-17 (a jet, not a turboprop) in the airliner bucket", () => {
    expect(resolveClass(contact({ t: "C17" }))).toEqual({ supported: true, classId: "b738", matched: true });
  });
  it("returns explicit unsupported for an unknown type", () => {
    expect(resolveClass(contact({ t: "V22" }))).toEqual({ supported: false, classId: null, matched: false, reason: "UNSUPPORTED AIRCRAFT TYPE" });
  });
  it("returns explicit unsupported for a missing type", () => {
    expect(resolveClass(contact({ t: null }))).toEqual({ supported: false, classId: null, matched: false, reason: "MISSING AIRCRAFT TYPE" });
  });
});

describe("checkEligibility — physical and supported-class gates", () => {
  it("no longer refuses a military contact", () => {
    expect(checkEligibility(contact({ t: "F16", military: true }))).toEqual({ eligible: true });
  });
  it("allows every supported class", () => {
    expect(checkEligibility(contact({ t: "A320" }))).toEqual({ eligible: true });
    expect(checkEligibility(contact({ t: "F16" }))).toEqual({ eligible: true });
  });
  it("refuses unsupported and missing types with explicit reasons", () => {
    expect(checkEligibility(contact({ t: "V22" }))).toEqual({ eligible: false, reason: "UNSUPPORTED AIRCRAFT TYPE" });
    expect(checkEligibility(contact({ t: null }))).toEqual({ eligible: false, reason: "MISSING AIRCRAFT TYPE" });
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
  it("names an unsupported type without substituting a model", () => {
    const p = loadClassById("c172s");
    expect(disclosureLine(contact({ t: "V22" }), p, false)).toBe("V22 → UNSUPPORTED");
  });
  it("renders an em-dash for a missing type", () => {
    const p = loadClassById("c172s");
    expect(disclosureLine(contact({ t: null }), p, false)).toBe("— → UNSUPPORTED");
  });
});
