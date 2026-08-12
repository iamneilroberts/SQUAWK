import { describe, it, expect } from "vitest";
import {
  agedContact,
  filterContacts,
  formatAlt,
  formatGs,
  selectionHint,
  sortContacts,
  sortContactsFlyableFirst,
} from "./ContactList";
import { checkEligibility } from "../takeover/eligibility";
import type { Contact } from "../data/types";

const contact = (overrides: Partial<Contact> = {}): Contact => ({
  hex: "abc123", flight: null, t: null, lat: 30, lon: -88, alt_geom: 3500,
  alt_baro: 3400, gs: 120, track: 90, baro_rate: 0, military: false, seen_pos: 1,
  ...overrides,
});

describe("sortContacts", () => {
  it("sorts by callsign, then hex; missing callsigns (empty string) sort before any letter", () => {
    const a = contact({ hex: "b2", flight: "DAL200" });
    const b = contact({ hex: "a1", flight: "AAL100" });
    const c = contact({ hex: "c3", flight: null });
    const d = contact({ hex: "a0", flight: null });
    expect(sortContacts([a, b, c, d]).map((x) => x.hex)).toEqual(["a0", "c3", "a1", "b2"]);
  });
});

describe("agedContact", () => {
  it("advances seen_pos by the elapsed seconds, so a fresh contact goes stale as time passes", () => {
    const c = contact({ t: "C172", seen_pos: 10 });
    expect(agedContact(c, 0).seen_pos).toBe(10);
    expect(checkEligibility(agedContact(c, 4)).eligible).toBe(true); // 14 <= 15
    expect(checkEligibility(agedContact(c, 6)).eligible).toBe(false); // 16 > 15
  });
  it("leaves a null seen_pos untouched — it is already ineligible", () => {
    expect(agedContact(contact({ seen_pos: null }), 30).seen_pos).toBeNull();
  });
  it("never rewinds seen_pos for non-positive elapsed time", () => {
    expect(agedContact(contact({ seen_pos: 5 }), -3).seen_pos).toBe(5);
    expect(agedContact(contact({ seen_pos: 5 }), 0).seen_pos).toBe(5);
  });
  it("does not mutate the original snapshot", () => {
    const c = contact({ t: "C172", seen_pos: 2 });
    agedContact(c, 20);
    expect(c.seen_pos).toBe(2);
  });
});

describe("sortContactsFlyableFirst", () => {
  it("puts flyable contacts first, preserving callsign/hex order within each group", () => {
    const stale = contact({ hex: "a1", flight: "AAA", t: "C172", seen_pos: 40 });
    const flyB = contact({ hex: "b2", flight: "BBB", t: "C172", seen_pos: 1 });
    const flyC = contact({ hex: "c3", flight: "CCC", t: "C172", seen_pos: 1 });
    const missingType = contact({ hex: "d4", flight: "DDD", t: null, seen_pos: 1 });
    expect(sortContactsFlyableFirst([stale, flyB, flyC, missingType]).map((x) => x.hex))
      .toEqual(["b2", "c3", "a1", "d4"]);
  });
  it("reflects aged eligibility when contacts are pre-aged, matching the dimming", () => {
    const fresh = contact({ hex: "f1", flight: "FRESH", t: "C172", seen_pos: 12 });
    const other = contact({ hex: "o1", flight: "OTHER", t: "C172", seen_pos: 5 });
    // Age both past 15 s: neither is flyable, so order falls back to callsign/hex.
    const aged = [fresh, other].map((c) => agedContact(c, 16));
    expect(sortContactsFlyableFirst(aged).map((x) => x.hex)).toEqual(["f1", "o1"]);
    expect(aged.every((c) => !checkEligibility(c).eligible)).toBe(true);
  });
});

describe("formatAlt", () => {
  it("renders GND when alt_baro is the string 'ground'", () => {
    expect(formatAlt(contact({ alt_baro: "ground" }))).toBe("GND");
  });
  it("prefers alt_geom over alt_baro", () => {
    expect(formatAlt(contact({ alt_geom: 5000, alt_baro: 4900 }))).toBe("5000 FT");
  });
  it("falls back to alt_baro when alt_geom is missing", () => {
    expect(formatAlt(contact({ alt_geom: null, alt_baro: 4900 }))).toBe("4900 FT");
  });
  it("renders an em-dash when both altitudes are unknown", () => {
    expect(formatAlt(contact({ alt_geom: null, alt_baro: null }))).toBe("—");
  });
});

describe("formatGs", () => {
  it("appends KT when known", () => {
    expect(formatGs(contact({ gs: 250 }))).toBe("250 KT");
  });
  it("renders an em-dash when unknown", () => {
    expect(formatGs(contact({ gs: null }))).toBe("—");
  });
});

describe("selectionHint", () => {
  it("prompts to select when contacts exist but none is chosen (the discoverability fix)", () => {
    expect(selectionHint(null, 5)).toBe("SELECT A CONTACT FOR MISSION BRIEFING");
  });
  it("shows no hint once a contact is selected — the TAKE CONTROLS button replaces it", () => {
    expect(selectionHint("abc123", 5)).toBeNull();
  });
  it("shows no hint when the list is empty — the NO CONTACTS line already explains the blank", () => {
    expect(selectionHint(null, 0)).toBeNull();
  });
});

describe("filterContacts", () => {
  const all = { query: "", classId: "all", altitude: "all", eligibility: "all" } as const;

  it("searches callsign, hex, and type without changing contact truth", () => {
    const contacts = [
      contact({ hex: "a0b1c2", flight: "DAL123", t: "B738" }),
      contact({ hex: "d0e1f2", flight: "N172", t: "C172" }),
    ];
    expect(filterContacts(contacts, { ...all, query: "dal" }).map((item) => item.hex)).toEqual(["a0b1c2"]);
    expect(filterContacts(contacts, { ...all, query: "D0E1" }).map((item) => item.hex)).toEqual(["d0e1f2"]);
    expect(filterContacts(contacts, { ...all, query: "b738" }).map((item) => item.hex)).toEqual(["a0b1c2"]);
  });

  it("combines class, altitude, and eligibility filters", () => {
    const contacts = [
      contact({ hex: "a0b1c2", t: "B738", alt_geom: 25_000 }),
      contact({ hex: "d0e1f2", t: "C172", alt_geom: 3_000 }),
      contact({ hex: "001122", t: "C130", alt_geom: 10_000 }),
      contact({ hex: "334455", t: "C172", alt_geom: 3_000, seen_pos: 40 }),
    ];
    expect(filterContacts(contacts, { ...all, classId: "b738", altitude: "high", eligibility: "eligible" })
      .map((item) => item.hex)).toEqual(["a0b1c2"]);
    expect(filterContacts(contacts, { ...all, classId: "unsupported" }).map((item) => item.hex)).toEqual(["001122"]);
    expect(filterContacts(contacts, { ...all, eligibility: "ineligible" }).map((item) => item.hex))
      .toEqual(["001122", "334455"]);
  });
});
