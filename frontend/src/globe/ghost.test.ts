import { describe, it, expect } from "vitest";
import { ghostLabelText } from "./ghost";
import { GHOST_ALPHA } from "./contactBillboards";
import type { Contact } from "../data/types";

const contact = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30, lon: -88,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 4, ...o,
});

describe("ghostLabelText", () => {
  it("shows the age of the real contact's last position", () => {
    expect(ghostLabelText(contact({ seen_pos: 34 }), "live")).toBe("GHOST · AGE 34S");
  });
  it("rounds a fractional age to whole seconds", () => {
    expect(ghostLabelText(contact({ seen_pos: 3.7 }), "live")).toBe("GHOST · AGE 4S");
  });
  it("reads NO DATA when the contact has left the feed", () => {
    expect(ghostLabelText(undefined, "live")).toBe("GHOST · NO DATA");
  });
  it("reads NO DATA when the feed itself is stale or offline — an old age would be a lie", () => {
    expect(ghostLabelText(contact({ seen_pos: 2 }), "stale")).toBe("GHOST · NO DATA");
    expect(ghostLabelText(contact({ seen_pos: 2 }), "offline")).toBe("GHOST · NO DATA");
  });
  it("reads NO DATA when seen_pos itself is missing", () => {
    expect(ghostLabelText(contact({ seen_pos: null }), "live")).toBe("GHOST · NO DATA");
  });
});

describe("ghost styling", () => {
  it("is dimmed, not hidden — the real aircraft is still real", () => {
    expect(GHOST_ALPHA).toBeGreaterThan(0);
    expect(GHOST_ALPHA).toBeLessThan(1);
  });
});
