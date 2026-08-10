import { describe, it, expect } from "vitest";
import { filterContacts, sortContacts, formatAlt, formatGs, selectionHint } from "./ContactList";
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
