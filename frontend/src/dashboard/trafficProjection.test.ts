import { describe, it, expect } from "vitest";
import {
  TAG_MARGIN_PX, TAG_MAX_COUNT, TAG_MAX_RANGE_NM, TAG_MIN_SPACING_PX,
  projectTraffic, tagAltLine, tagLabel, tagTypeLine, type ProjectFn,
} from "./trafficProjection";
import type { Contact } from "../data/types";
import { EM_DASH } from "../hud/format";

const own = { latDeg: 30.0, lonDeg: -88.0 };
const viewport = { widthPx: 1000, heightPx: 700 };

const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.05, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

const mapOf = (...cs: Contact[]) => new Map(cs.map((x) => [x.hex, x]));
/** Everything lands dead centre unless a test says otherwise. */
const centre: ProjectFn = () => ({ x: 500, y: 350 });
const at = (x: number, y: number): ProjectFn => () => ({ x, y });

const run = (contacts: Map<string, Contact>, project: ProjectFn, o: Partial<Parameters<typeof projectTraffic>[0]> = {}) =>
  projectTraffic({ contacts, own, project, viewport, ghostHex: null, ...o });

describe("projectTraffic", () => {
  it("produces nothing at all when the feed has nothing — no cached tags, ever", () => {
    expect(run(new Map(), centre)).toEqual([]);
  });

  it("drops a contact the projector puts behind the camera", () => {
    expect(run(mapOf(c()), () => null)).toEqual([]);
  });

  it("drops a contact projected off the edge, margin included", () => {
    expect(run(mapOf(c()), at(TAG_MARGIN_PX - 1, 350))).toEqual([]);
    expect(run(mapOf(c()), at(viewport.widthPx - TAG_MARGIN_PX + 1, 350))).toEqual([]);
    expect(run(mapOf(c()), at(500, -5))).toEqual([]);
  });

  it("drops a contact with no alt_geom — the same rule the globe billboards follow", () => {
    expect(run(mapOf(c({ alt_geom: null })), centre)).toEqual([]);
  });

  it("drops a contact beyond the tag range", () => {
    // ~2 degrees of latitude is ~120 NM, well past the 40 NM default.
    expect(run(mapOf(c({ lat: 32.0 })), centre)).toEqual([]);
  });

  it("keeps a contact in frame, with its screen position and its range", () => {
    const [tag] = run(mapOf(c()), at(420, 300));
    expect(tag.hex).toBe("a1b2c3");
    expect(tag.x).toBe(420);
    expect(tag.y).toBe(300);
    expect(tag.rangeNm).toBeCloseTo(3, 0); // 0.05 deg of latitude
  });

  it("orders tags nearest first", () => {
    const near = c({ hex: "aaa111", lat: 30.02 });
    const far = c({ hex: "bbb222", lat: 30.2 });
    // Distinct screen positions (not the shared `at(...)` helper): the ordering rule is what
    // this test proves, and identical positions would instead exercise the declutter rule
    // (covered separately below), dropping the far tag for the wrong reason.
    const apart: ProjectFn = (_lon, lat) => ({ x: lat > 30.1 ? 700 : 400, y: 200 });
    const tags = run(mapOf(far, near), apart);
    expect(tags.map((t) => t.hex)).toEqual(["aaa111", "bbb222"]);
  });

  it("caps the number of tags so the windscreen stays readable", () => {
    const many = Array.from({ length: TAG_MAX_COUNT + 8 }, (_, i) =>
      c({ hex: `hex${i}`, lat: 30.01 + i * 0.001 }));
    // Spread them apart so the CAP is what bites, not the declutter. Exact, not
    // toBeLessThanOrEqual — that would pass just as happily if the function returned nothing.
    let n = 0;
    const spread: ProjectFn = () => {
      const i = n++;
      return { x: 80 + (i % 8) * 105, y: 80 + Math.floor(i / 8) * 120 };
    };
    expect(run(mapOf(...many), spread)).toHaveLength(TAG_MAX_COUNT);
  });

  it("declutters overlapping tags, keeping the nearer one", () => {
    const near = c({ hex: "aaa111", lat: 30.02 });
    const far = c({ hex: "bbb222", lat: 30.2 });
    const stacked: ProjectFn = (_lon, lat) => ({ x: 500, y: lat > 30.1 ? 352 : 350 });
    const tags = run(mapOf(near, far), stacked);
    expect(TAG_MIN_SPACING_PX).toBeGreaterThan(2);
    expect(tags.map((t) => t.hex)).toEqual(["aaa111"]);
  });

  it("marks the ghost so the player's own origin aircraft is distinguishable", () => {
    const [tag] = run(mapOf(c()), centre, { ghostHex: "a1b2c3" });
    expect(tag.ghost).toBe(true);
  });

  it("carries the feed's military flag through untouched", () => {
    expect(run(mapOf(c({ military: true })), centre)[0].military).toBe(true);
  });

  it("respects an explicit range override", () => {
    // 0.05 deg of latitude is ~3 NM, so a 1 NM limit must reject it and a 5 NM limit must not.
    expect(run(mapOf(c()), centre, { maxRangeNm: 1 })).toEqual([]);
    expect(run(mapOf(c()), centre, { maxRangeNm: 5 })).toHaveLength(1);
    expect(TAG_MAX_RANGE_NM).toBe(40);
  });

  it("respects an explicit count override", () => {
    const three = [0, 1, 2].map((i) => c({ hex: `hex${i}`, lat: 30.01 + i * 0.001 }));
    let n = 0;
    const spread: ProjectFn = () => ({ x: 200 + n++ * 120, y: 300 });
    expect(run(mapOf(...three), spread, { maxCount: 2 })).toHaveLength(2);
  });
});

describe("tag text", () => {
  it("prefers the callsign and falls back to the uppercase hex", () => {
    expect(tagLabel(c({ flight: "N12345" }))).toBe("N12345");
    expect(tagLabel(c({ flight: null }))).toBe("A1B2C3");
    expect(tagLabel(c({ flight: "   " }))).toBe("A1B2C3");
  });
  it("em-dashes an unknown type rather than guessing one", () => {
    expect(tagTypeLine(c({ t: null }))).toBe(EM_DASH);
    expect(tagTypeLine(c({ t: "B738" }))).toBe("B738");
  });
  it("reads altitude in whole feet from alt_geom", () => {
    expect(tagAltLine(c({ alt_geom: 3500 }))).toBe("3500 FT");
    expect(tagAltLine(c({ alt_geom: null }))).toBe(EM_DASH);
  });
});
