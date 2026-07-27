import { describe, it, expect } from "vitest";
import { diffContacts } from "./contactBillboards";
import type { Contact } from "../data/types";

const contact = (hex: string): Contact => ({
  hex, flight: null, t: null, lat: 30, lon: -88, alt_geom: 3500,
  alt_baro: 3400, gs: 120, track: 90, baro_rate: 0, military: false, seen_pos: 1,
});

describe("diffContacts", () => {
  it("everything is added when prev is empty", () => {
    const next = new Map([["a", contact("a")], ["b", contact("b")]]);
    expect(diffContacts(new Set(), next)).toEqual({ added: ["a", "b"], removed: [], kept: [] });
  });
  it("everything is removed when next is empty", () => {
    const prev = new Set(["a", "b"]);
    expect(diffContacts(prev, new Map())).toEqual({ added: [], removed: ["a", "b"], kept: [] });
  });
  it("partitions added, removed and kept on partial overlap", () => {
    const prev = new Set(["a", "b"]);
    const next = new Map([["b", contact("b")], ["c", contact("c")]]);
    expect(diffContacts(prev, next)).toEqual({ added: ["c"], removed: ["a"], kept: ["b"] });
  });
});
