import { describe, it, expect } from "vitest";
import HandoffCard from "./HandoffCard";
import { buildSpawnState } from "../takeover/spawn";
import { loadC172 } from "../sim/params";
import type { Contact } from "../data/types";

const P = loadC172();
const ga = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "P28A", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  // Local function components (Row) must be invoked or their text is invisible here.
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const render = (props: Parameters<typeof HandoffCard>[0]) => collectText(HandoffCard(props)).join(" ");

describe("HandoffCard", () => {
  const spawn = buildSpawnState(ga(), P, { terrainHeightM: 20 });

  it("shows the snapshot the flight was built from", () => {
    const text = render({ contact: ga(), spawn, countdown: 3, note: "" });
    expect(text).toContain("N12345");
    expect(text).toContain("3500");
    expect(text).toContain("105");
    expect(text).toContain("270");
  });
  it("shows the REAL type from the feed, not the model that will fly", () => {
    expect(render({ contact: ga({ t: "P28A" }), spawn, countdown: 3, note: "" })).toContain("P28A");
  });
  it("discloses the model actually flying", () => {
    expect(render({ contact: ga(), spawn, countdown: 3, note: "" })).toContain("C172 MODEL THIS BUILD");
  });
  it("shows the synthetic callsign", () => {
    expect(render({ contact: ga(), spawn, countdown: 3, note: "" })).toContain("SIM-A1B2C3");
  });
  it("prints every adjustment verbatim — from, to and reason", () => {
    const clamped = buildSpawnState(ga({ gs: 30 }), P, { terrainHeightM: 20 });
    const text = render({ contact: ga({ gs: 30 }), spawn: clamped, countdown: 3, note: "" });
    expect(clamped.adjustments.length).toBeGreaterThan(0);
    for (const a of clamped.adjustments) {
      expect(text).toContain(a.field);
      expect(text).toContain(a.from);
      expect(text).toContain(a.to);
      expect(text).toContain(a.reason);
    }
  });
  it("says so when nothing was adjusted, instead of leaving an ambiguous blank", () => {
    expect(render({ contact: ga(), spawn, countdown: 3, note: "" })).toContain("NO ADJUSTMENTS");
  });
  it("shows the countdown", () => {
    expect(render({ contact: ga(), spawn, countdown: 2, note: "" })).toContain("2");
  });
  it("shows a status note while the spawn is still being built", () => {
    expect(render({ contact: ga(), spawn: null, countdown: null, note: "ACQUIRING TERRAIN…" }))
      .toContain("ACQUIRING TERRAIN");
  });
  it("discloses that ground speed stands in for true airspeed", () => {
    expect(render({ contact: ga(), spawn, countdown: 3, note: "" })).toMatch(/GROUND SPEED/i);
  });
  it("wraps a heading that rounds up to 360 back to 000, not '360' — 000-359 is the whole range", () => {
    const nearNorth = ga({ track: 359.6 });
    const nearNorthSpawn = buildSpawnState(nearNorth, P, { terrainHeightM: 20 });
    const text = render({ contact: nearNorth, spawn: nearNorthSpawn, countdown: 3, note: "" });
    expect(text).toContain("000");
    expect(text).not.toContain("360");
  });
});
