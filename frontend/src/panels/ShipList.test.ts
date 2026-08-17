import { describe, it, expect } from "vitest";
import { sortShips, formatSog, formatNavStatus } from "./ShipList";
import type { ShipContact } from "../data/types";

const ship = (overrides: Partial<ShipContact> = {}): ShipContact => ({
  mmsi: "111111111", name: null, ship_type: null, lat: 30, lon: -88,
  cog: null, sog: null, heading: null, nav_status: null, length_m: null,
  beam_m: null, draught_m: null, destination: null, callsign: null, seen: 1,
  ...overrides,
});

describe("sortShips", () => {
  it("sorts by name, then mmsi; missing names (empty string) sort before any letter", () => {
    const a = ship({ mmsi: "222", name: "DELTA" });
    const b = ship({ mmsi: "111", name: "ALPHA" });
    const c = ship({ mmsi: "333", name: null });
    const d = ship({ mmsi: "000", name: null });
    expect(sortShips([a, b, c, d]).map((x) => x.mmsi)).toEqual(["000", "333", "111", "222"]);
  });
});

describe("formatSog", () => {
  it("appends KT when known", () => {
    expect(formatSog(ship({ sog: 12.3 }))).toBe("12.3 KT");
  });
  it("renders an em-dash when unknown", () => {
    expect(formatSog(ship({ sog: null }))).toBe("—");
  });
});

describe("formatNavStatus", () => {
  it("passes through a known status", () => {
    expect(formatNavStatus(ship({ nav_status: "under way using engine" }))).toBe(
      "under way using engine",
    );
  });
  it("renders an em-dash when unknown", () => {
    expect(formatNavStatus(ship({ nav_status: null }))).toBe("—");
  });
});
