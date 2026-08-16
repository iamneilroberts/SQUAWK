import { describe, it, expect } from "vitest";
import HandoffCard from "./HandoffCard";
import { buildSpawnState } from "../takeover/spawn";
import { loadC172, loadClassById } from "../sim/params";
import type { Contact } from "../data/types";
import type { RunwayAssignment } from "../mission/types";

const P = loadC172();
const ga = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "P28A", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});
// A jet-cruise contact for the airliner disclosure case (a real feed A320 → the b738 model).
const ac = (o: Partial<Contact> = {}): Contact => ga({
  t: "A320", alt_geom: 35000, alt_baro: 35000, gs: 450, ...o,
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

type Props = Parameters<typeof HandoffCard>[0];
// Newer required props (#88-followup, #90 spawn chooser) default to the pre-toggle behavior —
// facing the approach, no destination fixture, not free flight — so every existing call site
// keeps working unchanged; tests that care override just the one they need.
type DefaultedProps = "assignment" | "spawnMode" | "onSpawnModeChange" | "freeFlight";
const render = (props: Omit<Props, DefaultedProps> & Partial<Pick<Props, DefaultedProps>>) =>
  collectText(HandoffCard({
    assignment: null,
    spawnMode: "faceApproach",
    onSpawnModeChange: () => {},
    freeFlight: false,
    ...props,
  })).join(" ");

const airportAssignment: RunwayAssignment = {
  airportIdent: "KTST",
  airportName: "Test Field",
  airportLatDeg: 30.7,
  airportLonDeg: -88.05,
  airportElevationFt: 100,
  runwayId: "09/27",
  runwayIdent: "09/27",
  runwayEndIdent: "27",
  runwayHeadingDeg: 270,
  runwayLengthFt: 5000,
  runwayWidthFt: 100,
  runwaySurface: "HARD",
  runwayLighted: true,
  assignedEnd: {
    ident: "27",
    latDeg: 30.71,
    lonDeg: -88.06,
    elevationFt: 100,
    headingDeg: 270,
    displacedThresholdFt: 0,
  },
  distanceNm: 4.2,
  estimatedMinutes: 2,
  suitability: 1,
};

describe("HandoffCard", () => {
  const spawn = buildSpawnState(ga(), P, { terrainHeightM: 20 });

  it("shows the snapshot the flight was built from", () => {
    const text = render({ contact: ga(), spawn, params: P, matched: true, countdown: 3, note: "" });
    expect(text).toContain("N12345");
    expect(text).toContain("3500");
    expect(text).toContain("105");
    expect(text).toContain("270");
  });
  it("shows the REAL type from the feed, not the model that will fly", () => {
    expect(render({ contact: ga({ t: "P28A" }), spawn, params: P, matched: true, countdown: 3, note: "" })).toContain("P28A");
  });
  it("discloses the model actually flying", () => {
    // A matched GA type flies the C172: REAL TYPE → MODEL, no NO-MATCHING-CLASS flag.
    expect(render({ contact: ga({ t: "C172" }), spawn, params: P, matched: true, countdown: 3, note: "" }))
      .toContain("C172 → C172 MODEL THIS BUILD");
  });
  it("discloses the model substitution for a matched airliner", () => {
    const p = loadClassById("b738");
    const text = render({ contact: ac({ t: "A320" }), spawn, params: p, matched: true, countdown: 3, note: "" });
    expect(text).toContain("A320 → 737-800 MODEL");
  });
  it("names an unsupported type without claiming a C172 substitution", () => {
    const p = loadClassById("c172s");
    const text = render({ contact: ac({ t: "V22" }), spawn, params: p, matched: false, countdown: 3, note: "" });
    expect(text).toContain("V22 → UNSUPPORTED");
  });
  it("renders an em-dash for the model, not a guess, when the feed has no type", () => {
    const text = render({ contact: ga({ t: null }), spawn, params: P, matched: false, countdown: 3, note: "" });
    expect(text).toContain("— → UNSUPPORTED");
  });
  it("shows the synthetic callsign", () => {
    expect(render({ contact: ga(), spawn, params: P, matched: true, countdown: 3, note: "" })).toContain("SIM-A1B2C3");
  });
  it("prints every adjustment verbatim — from, to and reason", () => {
    const clamped = buildSpawnState(ga({ gs: 30 }), P, { terrainHeightM: 20 });
    const text = render({ contact: ga({ gs: 30 }), spawn: clamped, params: P, matched: true, countdown: 3, note: "" });
    expect(clamped.adjustments.length).toBeGreaterThan(0);
    for (const a of clamped.adjustments) {
      expect(text).toContain(a.field);
      expect(text).toContain(a.from);
      expect(text).toContain(a.to);
      expect(text).toContain(a.reason);
    }
  });
  it("says so when nothing was adjusted, instead of leaving an ambiguous blank", () => {
    expect(render({ contact: ga(), spawn, params: P, matched: true, countdown: 3, note: "" })).toContain("NO ADJUSTMENTS");
  });
  it("shows the countdown", () => {
    expect(render({ contact: ga(), spawn, params: P, matched: true, countdown: 2, note: "" })).toContain("2");
  });
  it("shows a status note while the spawn is still being built", () => {
    expect(render({ contact: ga(), spawn: null, params: null, matched: false, countdown: null, note: "ACQUIRING TERRAIN…" }))
      .toContain("ACQUIRING TERRAIN");
  });
  it("discloses that ground speed stands in for true airspeed", () => {
    expect(render({ contact: ga(), spawn, params: P, matched: true, countdown: 3, note: "" })).toMatch(/GROUND SPEED/i);
  });
  it("wraps a heading that rounds up to 360 back to 000, not '360' — 000-359 is the whole range", () => {
    const nearNorth = ga({ track: 359.6 });
    const nearNorthSpawn = buildSpawnState(nearNorth, P, { terrainHeightM: 20 });
    const text = render({ contact: nearNorth, spawn: nearNorthSpawn, params: P, matched: true, countdown: 3, note: "" });
    expect(text).toContain("000");
    expect(text).not.toContain("360");
  });
  it("shows the destination and the spawn-mode selector for a real mission", () => {
    const text = render({
      contact: ga(), spawn, params: P, matched: true, countdown: 3, note: "",
      assignment: airportAssignment, freeFlight: false,
    });
    expect(text).toContain("KTST RWY 27 · 4.2 NM");
    expect(text).toContain("SPAWN");
    expect(text).toContain("REAL");
    expect(text).toContain("LINE UP");
    expect(text).toContain("1 TURN");
    expect(text).toContain("ON FINAL");
  });
  it("hides the destination and the spawn-mode selector in free flight — no destination, heading never overridden", () => {
    const text = render({
      contact: ga(), spawn, params: P, matched: true, countdown: 3, note: "",
      assignment: airportAssignment, freeFlight: true,
    });
    expect(text).not.toContain("KTST RWY 27 · 4.2 NM");
    expect(text).not.toContain("LINE UP");
  });
  it("shows an UNRANKED note for a reposition mode, not for real/faceApproach", () => {
    const repositioned = render({
      contact: ga(), spawn, params: P, matched: true, countdown: 3, note: "",
      assignment: airportAssignment, freeFlight: false, spawnMode: "final",
    });
    expect(repositioned).toContain("UNRANKED");
    const real = render({
      contact: ga(), spawn, params: P, matched: true, countdown: 3, note: "",
      assignment: airportAssignment, freeFlight: false, spawnMode: "real",
    });
    expect(real).not.toContain("UNRANKED");
  });
});
