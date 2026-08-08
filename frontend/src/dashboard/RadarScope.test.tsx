import { describe, it, expect } from "vitest";
import RadarScope from "./RadarScope";
import { RANGE_PRESETS_NM } from "./radarMath";
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
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  lightPhase: "day", ...o,
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
  contacts: new Map([["a1b2c3", c()]]),
  feedStatus: "live" as const,
  ghostHex: null,
  scopeRangeNm: 40,
  feedRadiusNm: 80,
  onRangeChange: () => {},
};

describe("RadarScope", () => {
  it("labels the three range rings in nautical miles", () => {
    const text = collectText(RadarScope(base)).join(" ");
    expect(text).toContain("13");
    expect(text).toContain("27");
    expect(text).toContain("40");
  });

  it("offers every range preset as its own button", () => {
    const text = collectText(RadarScope(base)).join(" ");
    for (const nm of RANGE_PRESETS_NM) expect(text).toContain(String(nm));
  });

  it("marks the selected range", () => {
    const classes = collectProp(RadarScope({ ...base, scopeRangeNm: 150 }), "className").join(" ");
    expect(classes).toContain("status-chip-button-active");
  });

  it("plots one blip per contact in range", () => {
    const hexes = collectProp(RadarScope(base), "data-hex");
    expect(hexes).toEqual(["a1b2c3"]);
  });

  it("says RADAR OFFLINE · BLIPS FROZEN and keeps painting the dimmed last-known blips — the store keeps contacts populated while offline, so the label must disclose that, not the blips vanish", () => {
    const rendered = RadarScope({ ...base, feedStatus: "offline" }); // base carries a non-empty contacts map
    const text = collectText(rendered).join(" ");
    expect(text).toContain("RADAR OFFLINE · BLIPS FROZEN");
    expect(collectProp(rendered, "data-hex")).toEqual(["a1b2c3"]);
    expect(collectProp(rendered, "className").join(" ")).toContain("radar-dim");
  });

  it("says RADAR OFFLINE · BLIPS FROZEN even with genuinely no traffic to plot", () => {
    const text = collectText(
      RadarScope({ ...base, contacts: new Map(), feedStatus: "offline" }),
    ).join(" ");
    expect(text).toContain("RADAR OFFLINE · BLIPS FROZEN");
  });

  it("says the plots are frozen when the feed is stale", () => {
    const text = collectText(RadarScope({ ...base, feedStatus: "stale" })).join(" ");
    expect(text).toContain("FEED STALE · BLIPS FROZEN");
  });

  it("says neither when the feed is live and there simply is no traffic", () => {
    const text = collectText(RadarScope({ ...base, contacts: new Map() })).join(" ");
    expect(text).not.toContain("OFFLINE");
    expect(text).not.toContain("STALE");
  });

  it("always draws the own-ship mark, even with no snapshot", () => {
    const classes = collectProp(RadarScope({ ...base, snapshot: null }), "className").join(" ");
    expect(classes).toContain("radar-own");
  });

  it("plots nothing at all without a snapshot — there is no own position to measure from", () => {
    expect(collectProp(RadarScope({ ...base, snapshot: null }), "data-hex")).toEqual([]);
  });

  it("says nothing extra when the dialed-in range is within the feed's polled radius", () => {
    const text = collectText(RadarScope({ ...base, scopeRangeNm: 40, feedRadiusNm: 80 })).join(" ");
    expect(text).not.toContain("FEED");
  });

  it("discloses the feed radius once the scope is dialed out past it — the outer rings are unpolled, not confirmed empty", () => {
    const text = collectText(RadarScope({ ...base, scopeRangeNm: 250, feedRadiusNm: 80 })).join(" ");
    expect(text).toContain("FEED 80 NM");
  });
});
