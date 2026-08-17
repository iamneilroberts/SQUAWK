import { describe, it, expect } from "vitest";
import { diffShips } from "./shipBillboards";
import { shipRotationRad } from "./icons";
import type { ShipContact } from "../data/types";

const ship = (mmsi: string, overrides: Partial<ShipContact> = {}): ShipContact => ({
  mmsi, name: "X", ship_type: null, lat: 30.7, lon: -88, cog: null, sog: null,
  heading: null, nav_status: null, length_m: null, beam_m: null, draught_m: null,
  destination: null, callsign: null, seen: 0,
  ...overrides,
});

describe("diffShips", () => {
  it("everything is added when prev is empty", () => {
    const next = new Map([["111", ship("111")], ["222", ship("222")]]);
    expect(diffShips(new Set(), next)).toEqual({ added: ["111", "222"], removed: [], kept: [] });
  });
  it("everything is removed when next is empty", () => {
    const prev = new Set(["111", "222"]);
    expect(diffShips(prev, new Map())).toEqual({ added: [], removed: ["111", "222"], kept: [] });
  });
  it("partitions added, removed and kept on partial overlap", () => {
    const prev = new Set(["111", "222"]);
    const next = new Map([["222", ship("222")], ["333", ship("333")]]);
    expect(diffShips(prev, next)).toEqual({ added: ["333"], removed: ["111"], kept: ["222"] });
  });
});

describe("shipRotationRad", () => {
  it("uses heading when present", () => {
    expect(shipRotationRad(90, null)).toBeCloseTo(-Math.PI / 2);
  });
  it("falls back to cog when heading is null", () => {
    expect(shipRotationRad(null, 180)).toBeCloseTo(-Math.PI);
  });
  it("prefers heading over cog when both present", () => {
    expect(shipRotationRad(90, 180)).toBeCloseTo(-Math.PI / 2);
  });
  it("is the same upright sentinel as contactRotationRad when both are null", () => {
    expect(shipRotationRad(null, null)).toBe(0);
  });
  it("treats heading 0 as a valid heading, not missing data", () => {
    expect(shipRotationRad(0, 180)).toBeCloseTo(0);
  });
  it("treats cog 0 as a valid course, not missing data, when heading is null", () => {
    expect(shipRotationRad(null, 0)).toBeCloseTo(0);
  });
});
