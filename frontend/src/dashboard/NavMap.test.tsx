import { describe, it, expect } from "vitest";
import NavMap from "./NavMap";
import { NAV_RANGE_PRESETS_NM } from "./navMath";
import type { Airport } from "../data/airports";
import type { Contact } from "../data/types";
import type { HudSnapshot } from "../hud/snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: 0, pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30.0, lonDeg: -88.0, aoaRad: degToRad(3), loadFactor: 1, throttle: 0.6,
  trim: 0, flapLabel: "0", gear: "fixed", stalled: false, overspeed: false, gLimited: false,
  terrainClearanceM: ftToM(2000), terrainUnverified: false, simRate: 1, airtimeS: 0,
  classLabel: "C172S", callsign: "SIM-A1B2C3", modelNote: "C172 MODEL THIS BUILD",
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false, ...o,
});

const ap = (o: Partial<Airport> = {}): Airport => ({
  ident: "KMOB", iata: "MOB", name: "Mobile", latDeg: 30.05, lonDeg: -88.0, size: "large", ...o,
});

const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.05, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const x of node) collectText(x, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

function collectProp(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const x of node) collectProp(x, key, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return collectProp((type as (p: unknown) => unknown)(props), key, out);
  if (props && key in props) out.push(props[key]);
  if (props && "children" in props) collectProp(props.children, key, out);
  return out;
}

const base = {
  snapshot: snap(),
  airports: [ap()],
  contacts: new Map([["a1b2c3", c()]]),
  feedStatus: "live" as const,
  ghostHex: null,
  navRangeNm: 50,
  feedRadiusNm: 80,
  onRangeChange: () => {},
};

describe("NavMap", () => {
  it("plots an airport in range, with its label", () => {
    const idents = collectProp(NavMap(base), "data-ident");
    expect(idents).toEqual(["KMOB"]);
    expect(collectText(NavMap(base)).join(" ")).toContain("MOB");
  });

  it("plots one blip per contact in range", () => {
    const hexes = collectProp(NavMap(base), "data-hex");
    expect(hexes).toEqual(["a1b2c3"]);
  });

  it("is a NORTH-UP map — it marks north on the face with a dedicated indicator", () => {
    const classes = collectProp(NavMap(base), "className").join(" ");
    expect(classes).toContain("navmap-north");
  });

  it("offers every range preset as its own button, in NM", () => {
    const text = collectText(NavMap(base)).join(" ");
    for (const nm of NAV_RANGE_PRESETS_NM) expect(text).toContain(String(nm));
    expect(text).toContain("NM");
  });

  it("marks the selected range", () => {
    const classes = collectProp(NavMap({ ...base, navRangeNm: 100 }), "className").join(" ");
    expect(classes).toContain("status-chip-button-active");
  });

  it("always draws the own-ship mark, even with no snapshot", () => {
    const classes = collectProp(NavMap({ ...base, snapshot: null }), "className").join(" ");
    expect(classes).toContain("navmap-own");
  });

  it("plots nothing at all without a snapshot — there is no own position to measure from", () => {
    const rendered = NavMap({ ...base, snapshot: null });
    expect(collectProp(rendered, "data-ident")).toEqual([]);
    expect(collectProp(rendered, "data-hex")).toEqual([]);
  });

  it("freezes only the TRAFFIC offline — airports are bundled, not a feed, so they stay", () => {
    const rendered = NavMap({ ...base, feedStatus: "offline" });
    const text = collectText(rendered).join(" ");
    expect(text).toContain("FEED OFFLINE · TRAFFIC FROZEN");
    // airports survive an outage; last-known traffic is still painted (frozen), like the radar
    expect(collectProp(rendered, "data-ident")).toEqual(["KMOB"]);
    expect(collectProp(rendered, "data-hex")).toEqual(["a1b2c3"]);
    expect(collectProp(rendered, "className").join(" ")).toContain("navmap-dim");
  });

  it("says traffic is frozen when the feed is stale", () => {
    const text = collectText(NavMap({ ...base, feedStatus: "stale" })).join(" ");
    expect(text).toContain("FEED STALE · TRAFFIC FROZEN");
  });

  it("says nothing extra when the feed is live and simply has no traffic", () => {
    const text = collectText(NavMap({ ...base, contacts: new Map() })).join(" ");
    expect(text).not.toContain("OFFLINE");
    expect(text).not.toContain("STALE");
  });

  it("discloses the feed radius once the map is zoomed out past it — the outer area is unpolled for traffic, not confirmed empty", () => {
    const text = collectText(NavMap({ ...base, navRangeNm: 200, feedRadiusNm: 80 })).join(" ");
    expect(text).toContain("FEED 80 NM");
  });

  it("says nothing about coverage when zoomed within the feed's polled radius", () => {
    const text = collectText(NavMap({ ...base, navRangeNm: 50, feedRadiusNm: 80 })).join(" ");
    expect(text).not.toContain("FEED 80 NM");
  });
});
