import { describe, it, expect } from "vitest";
import { contactColor, contactRotationRad } from "./icons";
import type { Contact } from "../data/types";

const contact = (overrides: Partial<Contact> = {}): Contact => ({
  hex: "abc123", flight: null, t: null, lat: 30, lon: -88, alt_geom: 3500,
  alt_baro: 3400, gs: 120, track: 90, baro_rate: 0, military: false, seen_pos: 1,
  ...overrides,
});

describe("contactColor", () => {
  it("is amber for military contacts", () => {
    expect(contactColor(contact({ military: true }))).toBe("#ffb000");
  });
  it("is cyan for civil contacts", () => {
    expect(contactColor(contact({ military: false }))).toBe("#5fd7e0");
  });
});

describe("contactRotationRad", () => {
  it("converts a compass track to CCW billboard rotation", () => {
    expect(contactRotationRad(90)).toBeCloseTo(-Math.PI / 2);
  });
  it("is 0 when track is null", () => {
    expect(contactRotationRad(null)).toBe(0);
  });
  it("treats track 0 as a valid heading, not missing data", () => {
    // -0 here is mathematically 0 (the sign is an artifact of `-track * ...`); toBeCloseTo
    // treats it as equal, unlike toBe's Object.is which distinguishes -0 from +0.
    expect(contactRotationRad(0)).toBeCloseTo(0);
  });
});
