import { describe, it, expect } from "vitest";
import { sortContacts, formatAlt, formatGs } from "./ContactList";
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
