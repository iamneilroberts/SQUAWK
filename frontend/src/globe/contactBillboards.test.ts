import { describe, it, expect } from "vitest";
import {
  contactAlpha,
  contactHeightM,
  diffContacts,
  renderableContacts,
} from "./contactBillboards";
import { ftToM } from "../sim/units";
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

describe("contactHeightM", () => {
  it("converts alt_geom feet to metres — Phase A drew everything at height 0, under real terrain", () => {
    expect(contactHeightM(contact("a"))).toBeCloseTo(ftToM(3500), 6);
  });
  it("is null when alt_geom is missing (alt_baro is the wrong datum for a 3D position)", () => {
    expect(contactHeightM({ ...contact("a"), alt_geom: null })).toBeNull();
  });
  it("is null for a contact on the ground", () => {
    expect(contactHeightM({ ...contact("a"), alt_geom: null, alt_baro: "ground" })).toBeNull();
  });
  it("keeps a legitimate negative altitude", () => {
    expect(contactHeightM({ ...contact("a"), alt_geom: -50 })).toBeCloseTo(ftToM(-50), 6);
  });
});

describe("renderableContacts", () => {
  it("skips contacts with no usable height rather than burying them at zero", () => {
    const map = new Map([
      ["a", contact("a")],
      ["b", { ...contact("b"), alt_geom: null }],
    ]);
    expect([...renderableContacts(map).keys()]).toEqual(["a"]);
  });
  it("returns a new map and leaves the input alone", () => {
    const map = new Map([["a", contact("a")]]);
    expect(renderableContacts(map)).not.toBe(map);
    expect(map.size).toBe(1);
  });
});

describe("traffic freshness presentation", () => {
  it("fades frozen ambient traffic and fades the already-translucent ghost further", () => {
    expect(contactAlpha(false, "live")).toBe(1);
    expect(contactAlpha(true, "live")).toBe(0.35);
    expect(contactAlpha(false, "stale")).toBe(0.3);
    expect(contactAlpha(true, "offline")).toBe(0.18);
  });
});
