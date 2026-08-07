import { describe, it, expect } from "vitest";
import { resyncDecision } from "./resync";
import { loadC172 } from "../sim/params";
import { ecefToGeodetic } from "../sim/geo";
import { radToDeg } from "../sim/units";
import type { Contact } from "../data/types";

const P = loadC172();

const ga = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

describe("resyncDecision — accept path", () => {
  it("re-runs the takeover against a fresh, eligible contact and returns a spawn there", () => {
    const d = resyncDecision(ga({ lat: 31.2, lon: -87.5 }), P, { terrainHeightM: null });
    expect(d.ok).toBe(true);
    if (!d.ok) throw new Error("unreachable");
    const g = ecefToGeodetic(d.spawn.state.position);
    expect(radToDeg(g.latRad)).toBeCloseTo(31.2, 4);
    expect(radToDeg(g.lonRad)).toBeCloseTo(-87.5, 4);
  });
});

describe("resyncDecision — refuse honestly (no synthesized position)", () => {
  it("refuses a stale contact with the eligibility gate's own reason", () => {
    const d = resyncDecision(ga({ seen_pos: 60 }), P, { terrainHeightM: null });
    expect(d.ok).toBe(false);
    if (d.ok) throw new Error("expected refusal");
    expect(d.reason).toContain("STALE");
  });
  it("refuses when the contact has dropped off the feed (offline)", () => {
    const d = resyncDecision(undefined, P, { terrainHeightM: null });
    expect(d.ok).toBe(false);
    if (d.ok) throw new Error("expected refusal");
    expect(d.reason).toBe("NO CONTACT SELECTED");
  });
  it("refuses a contact that is no longer eligible (e.g. now on the ground)", () => {
    const d = resyncDecision(ga({ alt_baro: "ground" }), P, { terrainHeightM: null });
    expect(d.ok).toBe(false);
    if (d.ok) throw new Error("expected refusal");
    expect(d.reason).toBe("ON GROUND");
  });
});
