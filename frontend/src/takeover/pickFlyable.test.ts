import { describe, it, expect } from "vitest";
import type { Contact } from "../data/types";
import { nearestFlyableContact } from "./pickFlyable";

// Mobile, AL — the home region the default flight departs from.
const HOME = { lat: 30.694, lon: -88.043 };

const contact = (o: Partial<Contact> = {}): Contact => ({
  hex: "abc123",
  flight: "N123",
  t: "C172", // GA → c172s, supported
  lat: 30.7,
  lon: -88.0,
  alt_geom: 4000,
  alt_baro: 4000,
  gs: 100,
  track: 90,
  baro_rate: 0,
  military: false,
  seen_pos: 1,
  ...(o as object),
}) as Contact;

describe("nearestFlyableContact", () => {
  it("returns null when there are no contacts", () => {
    expect(nearestFlyableContact([], HOME.lat, HOME.lon)).toBeNull();
  });

  it("returns null when nothing is flyable", () => {
    const onGround = contact({ hex: "g", alt_baro: "ground" });
    const stale = contact({ hex: "s", seen_pos: 99 });
    const unsupported = contact({ hex: "u", t: "ZZZZ" });
    expect(nearestFlyableContact([onGround, stale, unsupported], HOME.lat, HOME.lon)).toBeNull();
  });

  it("picks the nearest flyable contact", () => {
    const near = contact({ hex: "near", lat: 30.70, lon: -88.05 });
    const far = contact({ hex: "far", lat: 31.50, lon: -87.00 });
    expect(nearestFlyableContact([far, near], HOME.lat, HOME.lon)?.hex).toBe("near");
  });

  it("skips an ineligible contact even when it is closer", () => {
    const closerButGrounded = contact({ hex: "ground", lat: 30.695, lon: -88.044, alt_baro: "ground" });
    const eligibleFarther = contact({ hex: "ok", lat: 30.80, lon: -88.10 });
    expect(nearestFlyableContact([closerButGrounded, eligibleFarther], HOME.lat, HOME.lon)?.hex).toBe("ok");
  });
});
