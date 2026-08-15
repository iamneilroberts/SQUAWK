import { describe, it, expect } from "vitest";
import { contactColor, contactRotationRad, contactShape, INELIGIBLE_COLOR } from "./icons";
import type { Contact } from "../data/types";

// t defaults to a resolvable GA designator so the base contact is takeover-eligible;
// override to null (or another ineligible field) for the ineligible case.
const contact = (overrides: Partial<Contact> = {}): Contact => ({
  hex: "abc123", flight: null, t: "C172", lat: 30, lon: -88, alt_geom: 3500,
  alt_baro: 3400, gs: 120, track: 90, baro_rate: 0, military: false, seen_pos: 1,
  ...overrides,
});

describe("contactColor", () => {
  it("is amber for an eligible military contact", () => {
    expect(contactColor(contact({ military: true, t: "F16" }))).toBe("#ffb000");
  });
  it("is cyan for an eligible civil contact", () => {
    expect(contactColor(contact({ military: false }))).toBe("#5fd7e0");
  });
  it("is a muted gray for an ineligible contact, distinct from either bright color", () => {
    const color = contactColor(contact({ t: null }));
    expect(color).toBe(INELIGIBLE_COLOR);
    expect(color).not.toBe("#5fd7e0");
    expect(color).not.toBe("#ffb000");
  });
});

describe("contactShape", () => {
  it("maps c172s (GA) to light", () => {
    expect(contactShape(contact({ t: "C172" }))).toBe("light");
  });
  it("maps b738 (airliner) to narrowbody", () => {
    expect(contactShape(contact({ t: "A320" }))).toBe("narrowbody");
  });
  it("maps biz to regional", () => {
    expect(contactShape(contact({ t: "C25A" }))).toBe("regional");
  });
  it("maps tprop to turboprop", () => {
    expect(contactShape(contact({ t: "BE20" }))).toBe("turboprop");
  });
  it("maps f5e (fighter) to fighter", () => {
    expect(contactShape(contact({ t: "F16" }))).toBe("fighter");
  });
  it("maps an unsupported/unknown type to generic", () => {
    expect(contactShape(contact({ t: "ZZZZ" }))).toBe("generic");
  });
  it("maps a missing type to generic", () => {
    expect(contactShape(contact({ t: null }))).toBe("generic");
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
