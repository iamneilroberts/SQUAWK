import { describe, it, expect } from "vitest";
import {
  parseTakeoverHex,
  evaluateTakeover,
  takeoverFallbackMessage,
} from "./urlTakeover";
import { checkEligibility } from "./eligibility";
import type { Contact } from "../data/types";

function contact(over: Partial<Contact> = {}): Contact {
  return {
    hex: "a0b1c2", flight: "TEST", t: "C172", alt_geom: 10000, alt_baro: 10000,
    gs: 110, track: 90, lat: 30, lon: -88, baro_rate: 0, military: false, seen_pos: 2, ...over,
  } as Contact;
}

describe("parseTakeoverHex", () => {
  it("returns null when the param is absent", () => {
    expect(parseTakeoverHex("")).toBeNull();
    expect(parseTakeoverHex("?other=1")).toBeNull();
  });
  it("returns null for an empty takeover value", () => {
    expect(parseTakeoverHex("?takeover=")).toBeNull();
  });
  it("parses a well-formed lowercase hex", () => {
    expect(parseTakeoverHex("?takeover=a0b1c2")).toBe("a0b1c2");
  });
  it("normalizes uppercase to lowercase", () => {
    expect(parseTakeoverHex("?takeover=A0B1C2")).toBe("a0b1c2");
  });
  it("tolerates surrounding whitespace", () => {
    expect(parseTakeoverHex("?takeover=%20A0B1C2%20")).toBe("a0b1c2");
  });
  it("works without a leading question mark", () => {
    expect(parseTakeoverHex("takeover=abcdef")).toBe("abcdef");
  });
  it("picks the param out of a multi-param query", () => {
    expect(parseTakeoverHex("?foo=1&takeover=abcdef&bar=2")).toBe("abcdef");
  });
  it("rejects non-hex garbage", () => {
    expect(parseTakeoverHex("?takeover=zzzzzz")).toBeNull();
    expect(parseTakeoverHex("?takeover=hello")).toBeNull();
  });
  it("rejects a hex of the wrong length", () => {
    expect(parseTakeoverHex("?takeover=abc")).toBeNull();
    expect(parseTakeoverHex("?takeover=abcdef01")).toBeNull();
  });
});

describe("evaluateTakeover", () => {
  it("is absent when the contact is not on the feed", () => {
    expect(evaluateTakeover(null, checkEligibility(null))).toEqual({ status: "absent" });
    expect(evaluateTakeover(undefined, checkEligibility(undefined))).toEqual({ status: "absent" });
  });
  it("takes when the contact is present and eligible", () => {
    const c = contact();
    expect(evaluateTakeover(c, checkEligibility(c))).toEqual({ status: "take", contact: c });
  });
  it("reports ineligible (with the gate's reason) when present but refused", () => {
    const c = contact({ alt_baro: "ground" });
    expect(evaluateTakeover(c, checkEligibility(c))).toEqual({ status: "ineligible", reason: "ON GROUND" });
  });
});

describe("takeoverFallbackMessage", () => {
  it("names a not-in-feed target, hex upper-cased", () => {
    expect(takeoverFallbackMessage("a0b1c2", null, checkEligibility(null)))
      .toBe("TAKEOVER TARGET A0B1C2 NOT IN FEED");
  });
  it("names an ineligible target with its failing gate", () => {
    const c = contact({ seen_pos: 40 });
    expect(takeoverFallbackMessage("a0b1c2", c, checkEligibility(c)))
      .toBe("TAKEOVER TARGET A0B1C2 INELIGIBLE — POSITION STALE (40S)");
  });
  it("is distinct for not-in-feed vs ineligible", () => {
    const c = contact({ alt_baro: "ground" });
    const notInFeed = takeoverFallbackMessage("a0b1c2", null, checkEligibility(null));
    const ineligible = takeoverFallbackMessage("a0b1c2", c, checkEligibility(c));
    expect(notInFeed).not.toBe(ineligible);
  });
});
