import { describe, expect, it } from "vitest";
import { evaluateTakeover, parseTakeoverHex, takeoverFallbackMessage } from "./urlTakeover";
import type { Contact } from "../data/types";

function contact(over: Partial<Contact> = {}): Contact {
  return {
    hex: "a0b1c2", flight: "TEST", t: "C172", alt_geom: 10000, alt_baro: 10000,
    gs: 110, track: 90, lat: 30, lon: -88, baro_rate: 0, military: false, seen_pos: 2, ...over,
  };
}

describe("parseTakeoverHex", () => {
  it("returns null when the param is absent or empty", () => {
    expect(parseTakeoverHex("")).toBeNull();
    expect(parseTakeoverHex("?other=1")).toBeNull();
    expect(parseTakeoverHex("?takeover=")).toBeNull();
  });

  it("normalizes one strict ICAO hex", () => {
    expect(parseTakeoverHex("?takeover=a0b1c2")).toBe("a0b1c2");
    expect(parseTakeoverHex("?takeover=%20A0B1C2%20")).toBe("a0b1c2");
    expect(parseTakeoverHex("takeover=abcdef")).toBe("abcdef");
    expect(parseTakeoverHex("?foo=1&takeover=abcdef&bar=2")).toBe("abcdef");
  });

  it("rejects malformed and wrong-length values", () => {
    expect(parseTakeoverHex("?takeover=zzzzzz")).toBeNull();
    expect(parseTakeoverHex("?takeover=abc")).toBeNull();
    expect(parseTakeoverHex("?takeover=abcdef01")).toBeNull();
  });
});

describe("evaluateTakeover", () => {
  it("waits while the contact is absent", () => {
    expect(evaluateTakeover(null)).toEqual({ status: "absent" });
    expect(evaluateTakeover(undefined)).toEqual({ status: "absent" });
  });

  it("selects eligible and ineligible contacts for the same briefing path", () => {
    const eligible = contact();
    const ineligible = contact({ alt_baro: "ground" });
    expect(evaluateTakeover(eligible)).toEqual({ status: "select", contact: eligible });
    expect(evaluateTakeover(ineligible)).toEqual({ status: "select", contact: ineligible });
  });
});

describe("takeoverFallbackMessage", () => {
  it("names an absent target and defensively reports an opened briefing", () => {
    expect(takeoverFallbackMessage("a0b1c2", null)).toBe("TAKEOVER TARGET A0B1C2 NOT IN FEED");
    expect(takeoverFallbackMessage("a0b1c2", contact()))
      .toBe("TAKEOVER TARGET A0B1C2 BRIEFING OPENED");
  });
});
