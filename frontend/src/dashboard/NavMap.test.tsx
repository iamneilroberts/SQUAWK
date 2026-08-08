import { describe, it, expect } from "vitest";
import NavMap from "./NavMap";
import { NAV_RANGE_PRESETS_NM } from "./navMath";
import { NavWeatherLayer } from "./NavWeatherLayer";
import type { NavWeatherState } from "./navWeatherMath";
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

// Shallow element search that does NOT invoke function components (so hook-bearing children like
// NavWeatherLayer are found by identity without being rendered outside React).
function findByType(node: unknown, target: unknown, out: unknown[] = []): unknown[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const x of node) findByType(x, target, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: { children?: unknown } }).props;
  if (type === target) out.push(node);
  if (props && "children" in props) findByType(props.children, target, out);
  return out;
}

// Collect className props WITHOUT invoking function components (safe on an ok-state tree).
function shallowClassNames(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const x of node) shallowClassNames(x, out); return out; }
  const props = (node as { props?: { className?: unknown; children?: unknown } }).props;
  if (props && typeof props.className === "string") out.push(props.className);
  if (props && "children" in props) shallowClassNames(props.children, out);
  return out;
}

describe("NavMap WX precip overlay (issue #17) — honest offline", () => {
  const okFrame = { time: Math.floor(Date.now() / 1000) - 120, path: "/v2/radar/abc" };

  it("draws NOTHING and says nothing when WX is off (overlay is off by default)", () => {
    const rendered = NavMap({ ...base, showRadar: false, navWeather: { kind: "ok", host: "h", frame: okFrame } });
    expect(findByType(rendered, NavWeatherLayer)).toEqual([]);
    expect(collectText(rendered).join(" ")).not.toContain("NO RADAR FEED");
  });

  it("unreachable feed shows NO RADAR FEED and draws NO tile layer (no fake precip)", () => {
    const state: NavWeatherState = { kind: "unreachable" };
    const rendered = NavMap({ ...base, showRadar: true, navWeather: state });
    expect(collectText(rendered).join(" ")).toContain("NO RADAR FEED");
    // The load-bearing honesty check: a down feed renders no radar canvas at all.
    expect(findByType(rendered, NavWeatherLayer)).toEqual([]);
  });

  it("uses wording DISTINCT from the ADS-B feed's TRAFFIC FROZEN", () => {
    const rendered = NavMap({ ...base, showRadar: true, navWeather: { kind: "unreachable" } });
    const text = collectText(rendered).join(" ");
    expect(text).toContain("NO RADAR FEED");
    expect(text).not.toContain("TRAFFIC FROZEN");
  });

  it("loading shows RADAR… and still draws no layer", () => {
    const rendered = NavMap({ ...base, showRadar: true, navWeather: { kind: "loading" } });
    expect(collectText(rendered).join(" ")).toContain("RADAR");
    expect(findByType(rendered, NavWeatherLayer)).toEqual([]);
  });

  it("an ok frame mounts exactly one radar layer, under the airports, with attribution", () => {
    const rendered = NavMap({ ...base, showRadar: true, navWeather: { kind: "ok", host: "https://t", frame: okFrame } });
    expect(findByType(rendered, NavWeatherLayer)).toHaveLength(1);
    // Attribution is shown only while the overlay is live (shallow read — never invokes the layer).
    expect(shallowClassNames(rendered).join(" ")).toContain("navmap-attribution");
  });

  it("without a snapshot there is no position, so no layer even on an ok frame", () => {
    const rendered = NavMap({ ...base, snapshot: null, showRadar: true, navWeather: { kind: "ok", host: "h", frame: okFrame } });
    expect(findByType(rendered, NavWeatherLayer)).toEqual([]);
  });
});
