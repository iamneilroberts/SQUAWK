import { describe, it, expect } from "vitest";
import { UnifiedGlassBody } from "./UnifiedGlass";
import { loadC172, loadB738, loadF5e } from "../sim/params";
import type { ClassParams } from "../sim/types";
import type { Airport } from "../data/airports";
import type { Contact } from "../data/types";
import type { HudSnapshot } from "../hud/snapshot";
import type { WeatherState } from "./WeatherPanel";
import type { NavWeatherState } from "./navWeatherMath";
import type { NavMode } from "./navModes";
import { ktToMs, ftToM, degToRad } from "../sim/units";

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(250), tasMs: ktToMs(280), altitudeM: ftToM(35000), verticalSpeedMs: 0,
  headingRad: degToRad(90), pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30.0, lonDeg: -88.0, aoaRad: degToRad(3), loadFactor: 1, throttle: 0.6,
  trim: 0, flapLabel: "0", gear: "retractable", stalled: false, overspeed: false, gLimited: false,
  terrainClearanceM: ftToM(2000), terrainUnverified: false, simRate: 1, airtimeS: 0,
  classLabel: "B738", callsign: "SIM-A1B2C3", modelNote: "737-800 MODEL",
  machNumber: 0.78, machOverspeed: false, gearPosition: 0, gearOverspeed: false, ...o,
});

const ap = (o: Partial<Airport> = {}): Airport => ({
  ident: "KMOB", iata: "MOB", name: "Mobile", latDeg: 30.05, lonDeg: -88.0, size: "large", ...o,
});
const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "B738", lat: 30.05, lon: -88.0,
  alt_geom: 35000, alt_baro: 35000, gs: 300, track: 270, baro_rate: 0,
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

const body = (params: ClassParams, o: {
  snapshot?: HudSnapshot | null;
  showWeather?: boolean;
  showRadar?: boolean;
  navWeather?: NavWeatherState;
  showHelp?: boolean;
  tacticalMode?: NavMode;
  labelsOn?: boolean;
  showContacts?: boolean;
} = {}) =>
  UnifiedGlassBody({
    params,
    snapshot: o.snapshot === undefined ? snap() : o.snapshot,
    contacts: new Map([["a1b2c3", c()]]),
    feedStatus: "live",
    ghostHex: null,
    feedRadiusNm: 80,
    airports: [ap()],
    navRangeNm: 50,
    weather: { kind: "no-position" } as WeatherState,
    navWeather: o.navWeather ?? ({ kind: "no-position" } as NavWeatherState),
    showWeather: o.showWeather ?? false,
    showRadar: o.showRadar ?? false,
    showHelp: o.showHelp ?? false,
    tacticalMode: o.tacticalMode ?? "normal",
    labelsOn: o.labelsOn ?? false,
    showContacts: o.showContacts ?? true,
    onCycleTactical: () => {}, onToggleContacts: () => {},
    onNavRangeChange: () => {}, onToggleWeather: () => {}, onToggleHelp: () => {}, onToggleStrip: () => {},
  });

const classNames = (params: ClassParams, o: Parameters<typeof body>[1] = {}) =>
  collectProp(body(params, o), "className").filter((v): v is string => typeof v === "string").join(" ");

const text = (params: ClassParams, o = {}) => collectText(body(params, o)).join(" ");
const primaryKind = (params: ClassParams) => collectProp(body(params), "data-primary");

describe("per-class primary is chosen by DATA, not a render branch", () => {
  it("routes each class to its own primary layout via the registry", () => {
    expect(primaryKind(loadC172())).toEqual(["sixpack"]);
    expect(primaryKind(loadB738())).toEqual(["efis"]);
    expect(primaryKind(loadF5e())).toEqual(["hud"]);
  });

  it("c172s renders the analog six-pack — its distinguishing ASI/DG face", () => {
    const t = text(loadC172());
    expect(t).toContain("ASI KT"); // the six-pack airspeed dial (not on EFIS/HUD)
    expect(t).toContain("HDG"); // the directional gyro
    expect(t).not.toContain("MACH"); // no Mach on the piston six-pack
  });

  it("b738 renders the EFIS PFD — its distinguishing Mach + speed tape", () => {
    const t = text(loadB738());
    expect(t).toContain("MACH");
    expect(t).toContain("0.78"); // formatMach of the snapshot
    expect(t).toContain("SPD"); // the moving speed tape
    expect(t).toContain("FL350"); // altitude tape reads flight levels
  });

  it("f5e renders the HUD — its distinguishing velocity vector + G / AOA", () => {
    const el = body(loadF5e());
    const classes = collectProp(el, "className");
    expect(classes).toContain("hud-velocity-vector"); // flight-path marker present
    const t = collectText(el).join(" ");
    expect(t).toContain("AOA");
    expect(t).toContain("3.0"); // formatAoaDeg of the snapshot's 3 deg AoA
    expect(t).toContain("+1.0"); // formatG of the 1.0 load factor (the prominent G readout)
    expect(t).toContain("A/B DRY"); // afterburner annunciator, dry by default
  });

  it("lights the A/B annunciator WET when the burner is lit (honest, from the snapshot)", () => {
    const classes = collectProp(body(loadF5e(), { snapshot: snap({ afterburner: true }) }), "className");
    expect(classes.some((c) => typeof c === "string" && c.includes("hud-ab-wet"))).toBe(true);
    const t = collectText(body(loadF5e(), { snapshot: snap({ afterburner: true }) })).join(" ");
    expect(t).toContain("A/B WET");
  });
});

describe("merged tactical map (NavMap = radar traffic + nav geography, combined)", () => {
  it("plots own traffic and the own-ship marker on one geographic map", () => {
    const el = body(loadB738());
    expect(collectProp(el, "data-hex")).toContain("a1b2c3"); // a traffic blip
    expect(collectProp(el, "className")).toContain("navmap-own"); // own-ship mark
    expect(collectProp(el, "data-ident")).toContain("KMOB"); // airport from the nav layer
  });
});

describe("bottom control-state strip", () => {
  it("shows THR / FLAPS / TRIM / GEAR (reused ControlState) plus VSI and AGL", () => {
    const t = text(loadB738());
    expect(t).toContain("THR");
    expect(t).toContain("FLAPS");
    expect(t).toContain("GEAR");
    expect(t).toContain("VSI");
    expect(t).toContain("AGL");
  });
});

describe("honest data — unknown renders as an em-dash, never a fabricated value", () => {
  it("em-dashes every reading and says NO SIGNAL when there is no snapshot", () => {
    const t = text(loadB738(), { snapshot: null });
    expect(t).toContain("—"); // EM_DASH
    expect(t).toContain("NO SIGNAL");
    expect(t).toContain("THR —"); // control strip throttle unknown
  });
});

describe("weather and controls stay reachable behind folds", () => {
  it("keeps both folds closed by default and opens each on demand", () => {
    expect(text(loadC172())).not.toContain("WEATHER");
    expect(text(loadC172(), { showWeather: true })).toContain("WEATHER");
    expect(text(loadC172(), { showHelp: true })).toContain("CONTROLS");
  });
});

describe("tactical radar follows the global WX toggle (showRadar), not the METAR fold (showWeather)", () => {
  const unreachable = { kind: "unreachable" } as NavWeatherState;
  it("draws the radar chip when showRadar is on", () => {
    expect(text(loadC172(), { showRadar: true, navWeather: unreachable })).toContain("NO RADAR FEED");
  });
  it("does NOT draw radar just because the METAR fold (showWeather) is open", () => {
    expect(text(loadC172(), { showWeather: true, navWeather: unreachable })).not.toContain("NO RADAR FEED");
  });
});

describe("tactical map has three display modes driven by StripState (#67 rework)", () => {
  it("normal mode shows the full panel with the ENLARGE chip and the ESRI map credit", () => {
    const cn = classNames(loadC172(), { tacticalMode: "normal" });
    expect(cn).toContain("dash-tactical");
    expect(cn).not.toContain("dash-tactical-expanded");
    expect(cn).not.toContain("dash-tactical-backdrop"); // no modal backdrop when small
    const t = text(loadC172(), { tacticalMode: "normal" });
    expect(t).toContain("ENLARGE"); // chip = the mode it switches TO next
    expect(t).toContain("MAP © ESRI"); // line basemap credit, not satellite
    // Vector coast borders render over the basemap (snapshot sits on the Gulf coast).
    expect(cn).toContain("navmap-coast");
  });

  // The basemap canvas BUFFER width = displayPx * renderScale; large supersamples so text is legible.
  const maxCanvasWidth = (mode: NavMode) =>
    Math.max(
      0,
      ...collectProp(body(loadC172(), { tacticalMode: mode }), "width").filter(
        (w): w is number => typeof w === "number",
      ),
    );

  it("large mode is a centered modal with a backdrop, a HIDE chip, and a high-res basemap", () => {
    const cn = classNames(loadC172(), { tacticalMode: "large" });
    expect(cn).toContain("dash-tactical-expanded"); // centered modal, not the corner glance
    expect(cn).toContain("dash-tactical-backdrop"); // dim + click-to-close
    expect(text(loadC172(), { tacticalMode: "large" })).toContain("HIDE");
    // The big paused map renders the basemap buffer larger (renderScale 3) than the small glance.
    expect(maxCanvasWidth("large")).toBeGreaterThan(maxCanvasWidth("normal"));
  });

  it("hidden mode collapses to a restore tab and does not render the map/credit", () => {
    const cn = classNames(loadC172(), { tacticalMode: "hidden" });
    expect(cn).toContain("dash-tactical-tab");
    expect(cn).not.toContain("dash-tactical-expanded");
    const t = text(loadC172(), { tacticalMode: "hidden" });
    expect(t).toContain("TACTICAL ▸"); // the restore affordance
    expect(t).not.toContain("MAP © ESRI"); // map is unmounted while hidden
  });
});

describe("tactical CONTACTS chip declutters the line map", () => {
  const activeCount = (o: Parameters<typeof body>[1]) =>
    (classNames(loadB738(), o).match(/status-chip-button-active/g) ?? []).length;

  it("draws traffic blips by default; the CONTACTS chip reads active only when on", () => {
    expect(collectProp(body(loadB738()), "data-hex")).toContain("a1b2c3");
    // Exactly one more active chip when contacts are on — the CONTACTS chip itself (the active
    // range preset is the same in both, so the delta isolates the CONTACTS chip's state).
    expect(activeCount({ showContacts: true })).toBe(activeCount({ showContacts: false }) + 1);
  });

  it("hides only the traffic when contacts are off — own-ship and airports stay", () => {
    const el = body(loadB738(), { showContacts: false });
    expect(collectProp(el, "data-hex")).not.toContain("a1b2c3"); // traffic gone
    expect(collectProp(el, "className")).toContain("navmap-own"); // own-ship remains
    expect(collectProp(el, "data-ident")).toContain("KMOB"); // airports remain (bundled, not feed)
  });
});
