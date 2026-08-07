import { describe, it, expect } from "vitest";
import SixPack from "./SixPack";
import { loadC172 } from "../sim/params";
import type { HudSnapshot } from "../hud/snapshot";
import { EM_DASH } from "../hud/format";
import { ktToMs, ftToM, fpmToMs, degToRad } from "../sim/units";

const P = loadC172();

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500),
  verticalSpeedMs: 0, headingRad: degToRad(270), pitchRad: 0, rollRad: 0,
  turnRateRadS: 0, sideslipRad: 0, latDeg: 30.6944, lonDeg: -88.0399,
  aoaRad: degToRad(3), loadFactor: 1, throttle: 0.6, trim: 0, flapLabel: "0", gear: "fixed",
  stalled: false, overspeed: false, gLimited: false, terrainClearanceM: ftToM(2000),
  terrainUnverified: false, simRate: 1, airtimeS: 0, classLabel: "C172S",
  callsign: "SIM-A1B2C3", modelNote: "C172 MODEL THIS BUILD",
  machNumber: 0, machOverspeed: false,
  ...o,
});

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

/** Same walk, but harvesting one prop off every element — needle angles are attributes, not text. */
function collectAttr(node: unknown, key: string, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectAttr(c, key, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") {
    return collectAttr((type as (p: unknown) => unknown)(props), key, out);
  }
  if (props && key in props && typeof props[key] === "string") out.push(props[key] as string);
  if (props && "children" in props) collectAttr(props.children, key, out);
  return out;
}

const render = (snapshot: HudSnapshot | null) =>
  collectText(SixPack({ snapshot, params: P })).join(" ");
const transforms = (snapshot: HudSnapshot | null) =>
  collectAttr(SixPack({ snapshot, params: P }), "transform");

describe("SixPack", () => {
  it("labels all six instruments", () => {
    const text = render(snap());
    for (const label of ["ASI", "ATTITUDE", "ALT", "TURN", "HDG", "VSI"]) {
      expect(text).toContain(label);
    }
  });

  it("reads the airspeed, altitude and heading straight off the snapshot", () => {
    const text = render(snap({ iasMs: ktToMs(103), altitudeM: ftToM(3500), headingRad: degToRad(270) }));
    expect(text).toContain("103");
    expect(text).toContain("3500");
    expect(text).toContain("270");
  });

  it("agrees with the HUD's own formatters rather than rounding differently", () => {
    // 359.6 deg reads 000 on the HUD; the DG's digital window must not read 360.
    const text = render(snap({ headingRad: degToRad(359.6) }));
    expect(text).toContain("000");
    expect(text).not.toContain("360");
  });

  it("renders em-dashes, not zeros, when there is no snapshot at all", () => {
    const text = render(null);
    expect(text).toContain(EM_DASH);
    expect(text).not.toMatch(/\b0\b/);
  });

  it("draws no needles at all when there is no snapshot", () => {
    expect(transforms(null).filter((t) => t.startsWith("rotate("))).toHaveLength(0);
  });

  it("rotates the horizon opposite the roll", () => {
    expect(transforms(snap({ rollRad: degToRad(30) }))).toContain("rotate(-30 60 60)");
  });

  it("marks a pegged VSI needle instead of implying an on-scale reading", () => {
    expect(render(snap({ verticalSpeedMs: fpmToMs(-4000) }))).toContain("PEG");
  });

  it("paints the ASI's red line at Vne", () => {
    // join first: the element's className is "gauge-arc gauge-arc-red", and array toContain
    // matches a whole element, not a substring of one.
    expect(collectAttr(SixPack({ snapshot: snap(), params: P }), "className").join(" "))
      .toContain("gauge-arc-red");
  });

  it("labels the slip indicator as sideslip, not as a coordination accelerometer", () => {
    const text = render(snap());
    expect(text).toContain("SLIP");
    expect(text).toContain("β"); // beta
  });

  it("does not draw a barometric setting or a heading bug the sim cannot back", () => {
    const text = render(snap());
    expect(text).not.toContain("29.92");
    expect(text).not.toContain("1013");
    expect(text).not.toContain("BUG");
  });

  it("shows the C172's 40-180 kt ASI tick range", () => {
    const text = render(snap());
    expect(text).toContain("40");
    expect(text).toContain("180");
  });

  it("shows a wide-range jet's own ASI tick labels, not the C172's", () => {
    const jetParams = { ...P, display: { asiMinKt: 60, asiMaxKt: 400, attitudeStyle: "ball" as const } };
    const text = collectText(SixPack({ snapshot: snap(), params: jetParams })).join(" ");
    expect(text).toContain("400");
  });
});
