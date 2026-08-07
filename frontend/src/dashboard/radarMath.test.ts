import { describe, it, expect } from "vitest";
import {
  RANGE_PRESETS_NM, DEFAULT_RANGE_NM, SCOPE_RADIUS_PX, MAX_BLIPS,
  scopeXY, ringsFor, blipsFor, scopeStatus,
} from "./radarMath";
import type { Contact } from "../data/types";

const own = { latDeg: 30.0, lonDeg: -88.0 };
const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.05, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});
const mapOf = (...cs: Contact[]) => new Map(cs.map((x) => [x.hex, x]));

describe("range presets", () => {
  it("are exactly the ladder the spec asks for", () => {
    expect([...RANGE_PRESETS_NM]).toEqual([10, 40, 80, 150, 250]);
    expect(RANGE_PRESETS_NM).toContain(DEFAULT_RANGE_NM);
  });
});

describe("scopeXY — own-ship centred, heading up", () => {
  it("puts a contact dead ahead at the top of the scope", () => {
    const p = scopeXY({ rangeNm: 20, bearingDeg: 0, ownHeadingDeg: 0, scopeRangeNm: 40 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-SCOPE_RADIUS_PX / 2, 6);
  });

  it("is HEADING UP: flying east, a contact to the east is still dead ahead", () => {
    const p = scopeXY({ rangeNm: 20, bearingDeg: 90, ownHeadingDeg: 90, scopeRangeNm: 40 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-SCOPE_RADIUS_PX / 2, 6);
  });

  it("puts a contact 90 degrees right on the right-hand side", () => {
    const p = scopeXY({ rangeNm: 40, bearingDeg: 90, ownHeadingDeg: 0, scopeRangeNm: 40 });
    expect(p.x).toBeCloseTo(SCOPE_RADIUS_PX, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("puts a contact behind at the bottom", () => {
    const p = scopeXY({ rangeNm: 40, bearingDeg: 180, ownHeadingDeg: 0, scopeRangeNm: 40 });
    expect(p.y).toBeCloseTo(SCOPE_RADIUS_PX, 6);
  });

  it("scales linearly with range, hitting the rim at the selected range", () => {
    const half = scopeXY({ rangeNm: 40, bearingDeg: 0, ownHeadingDeg: 0, scopeRangeNm: 80 });
    const rim = scopeXY({ rangeNm: 80, bearingDeg: 0, ownHeadingDeg: 0, scopeRangeNm: 80 });
    expect(Math.abs(half.y)).toBeCloseTo(SCOPE_RADIUS_PX / 2, 6);
    expect(Math.abs(rim.y)).toBeCloseTo(SCOPE_RADIUS_PX, 6);
  });

  it("puts own ship exactly at the centre", () => {
    const p = scopeXY({ rangeNm: 0, bearingDeg: 0, ownHeadingDeg: 123, scopeRangeNm: 40 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe("ringsFor", () => {
  it("draws three rings at thirds of the selected range", () => {
    const rings = ringsFor(150);
    expect(rings).toHaveLength(3);
    expect(rings.map((r) => r.labelNm)).toEqual([50, 100, 150]);
  });
  it("puts the outer ring on the scope's own radius", () => {
    expect(ringsFor(40)[2].radiusPx).toBeCloseTo(SCOPE_RADIUS_PX, 6);
  });
  it("labels a range that does not divide evenly without inventing precision", () => {
    expect(ringsFor(10).map((r) => r.labelNm)).toEqual([3, 7, 10]);
  });
});

describe("blipsFor", () => {
  const run = (contacts: Map<string, Contact>, o: Record<string, unknown> = {}) =>
    blipsFor({ contacts, own, ownHeadingDeg: 0, scopeRangeNm: 40, ghostHex: null, ...o });

  it("shows nothing when the feed has nothing — no residual plots", () => {
    expect(run(new Map())).toEqual([]);
  });

  it("plots a contact inside the selected range", () => {
    const blips = run(mapOf(c()));
    expect(blips).toHaveLength(1);
    expect(blips[0].hex).toBe("a1b2c3");
    expect(blips[0].rangeNm).toBeCloseTo(3, 0);
  });

  it("drops a contact beyond the selected range", () => {
    expect(run(mapOf(c({ lat: 32.0 })), { scopeRangeNm: 10 })).toEqual([]);
    expect(run(mapOf(c({ lat: 32.0 })), { scopeRangeNm: 250 })).toHaveLength(1);
  });

  it("keeps a contact whose ALTITUDE is unknown — a PPI plot needs position, not altitude", () => {
    expect(run(mapOf(c({ alt_geom: null })))).toHaveLength(1);
  });

  it("carries the military flag and the ghost flag through", () => {
    expect(run(mapOf(c({ military: true })))[0].military).toBe(true);
    expect(run(mapOf(c()), { ghostHex: "a1b2c3" })[0].ghost).toBe(true);
  });

  it("rotates the picture with own heading", () => {
    const north = run(mapOf(c()))[0];             // contact due north, flying north
    const east = run(mapOf(c()), { ownHeadingDeg: 90 })[0]; // same contact, flying east
    expect(north.y).toBeLessThan(0);
    expect(east.x).toBeLessThan(0); // north is now off the left wing
  });

  it("caps the plot count so a 250 NM sweep cannot flood the scope", () => {
    const many = Array.from({ length: MAX_BLIPS + 20 }, (_, i) =>
      c({ hex: `hex${i}`, lat: 30.0 + i * 0.002 }));
    expect(run(mapOf(...many), { scopeRangeNm: 250 }).length).toBe(MAX_BLIPS);
  });

  it("keeps the NEAREST when it has to cap", () => {
    const many = Array.from({ length: MAX_BLIPS + 5 }, (_, i) =>
      c({ hex: `hex${i}`, lat: 30.0 + (i + 1) * 0.01 }));
    const blips = run(mapOf(...many), { scopeRangeNm: 250 });
    expect(blips[0].hex).toBe("hex0");
    expect(blips.map((b) => b.hex)).not.toContain(`hex${MAX_BLIPS + 4}`);
  });
});

describe("scopeStatus", () => {
  it("says nothing extra when the feed is live", () => {
    expect(scopeStatus("live")).toEqual({ text: null, dim: false });
  });
  it("states the offline case explicitly and discloses that any blips shown are frozen — the store keeps last-known contacts around while offline, so the label must say so, not just NO FEED", () => {
    expect(scopeStatus("offline").text).toBe("RADAR OFFLINE · BLIPS FROZEN");
    expect(scopeStatus("offline").dim).toBe(true);
  });
  it("says the plots are frozen when the feed is stale", () => {
    expect(scopeStatus("stale").text).toBe("FEED STALE · BLIPS FROZEN");
    expect(scopeStatus("stale").dim).toBe(true);
  });
});
