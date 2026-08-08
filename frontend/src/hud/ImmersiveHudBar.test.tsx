import { describe, it, expect } from "vitest";
import ImmersiveHudBar, { immersiveBarFields } from "./ImmersiveHudBar";
import type { HudSnapshot } from "./snapshot";
import { ktToMs, ftToM, fpmToMs, degToRad } from "../sim/units";

/*
 * No jsdom (spec §8): call the component / helper and walk the plain-object element tree.
 * These lock the three testable decisions of the immersive top bar:
 *   1. field selection + formatting (reuses hud/format.ts, unknown -> em-dash),
 *   2. the SIM identity folded in with the amber badge (SIM-unmistakability, compactly),
 *   3. the mini attitude indicator reusing the shared six-pack geometry.
 */
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
function collectAttr(node: unknown, key: string, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectAttr(c, key, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return collectAttr((type as (p: unknown) => unknown)(props), key, out);
  if (props && key in props && typeof props[key] === "string") out.push(props[key] as string);
  if (props && "children" in props) collectAttr(props.children, key, out);
  return out;
}
const classNamesIn = (node: unknown) => collectAttr(node, "className").flatMap((c) => c.split(/\s+/));

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(105), tasMs: ktToMs(118), altitudeM: ftToM(3500),
  verticalSpeedMs: fpmToMs(500), headingRad: degToRad(270),
  pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30.6944, lonDeg: -88.0399,
  aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, trim: 0, flapLabel: "10", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false,
  simRate: 1, airtimeS: 65, classLabel: "C172S", callsign: "SIM-A1B2C3",
  modelNote: "C172 MODEL THIS BUILD",
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  lightPhase: "day",
  ...o,
});

const render = (s: HudSnapshot) =>
  collectText(ImmersiveHudBar({ snapshot: s, attitudeStyle: "line" })).join(" ");

describe("immersiveBarFields", () => {
  it("selects the essential flight fields via the shared formatters", () => {
    const fields = immersiveBarFields(snap());
    const byLabel = Object.fromEntries(fields.map((f) => [f.label, f.value]));
    expect(byLabel).toMatchObject({
      ALT: "3500", IAS: "105", HDG: "270", VSI: "+500", AGL: "2000",
    });
  });

  it("stays minimalist on mobile — AOA and G are NOT in the bar (owner: tiny/minimalist)", () => {
    // Broken-arm: if a future edit re-adds AOA/G the strip wraps to two rows on a phone again.
    const labels = immersiveBarFields(snap()).map((f) => f.label);
    expect(labels).toEqual(["ALT", "IAS", "HDG", "VSI", "AGL"]);
    expect(labels).not.toContain("AOA");
    expect(labels).not.toContain("G");
  });

  it("em-dashes an unknown value rather than inventing one (honest-data)", () => {
    // Broken-arm: a naive `${clearanceFt}` would render 0 or NaN here — the em-dash proves the
    // bar routes through hud/format.ts, which is the whole point of not reimplementing formatting.
    const fields = immersiveBarFields(snap({ terrainClearanceM: null }));
    expect(fields.find((f) => f.label === "AGL")?.value).toBe("—");
  });
});

describe("ImmersiveHudBar", () => {
  it("shows every essential readout in one strip", () => {
    const text = render(snap());
    for (const v of ["3500", "105", "270", "+500", "2000"]) {
      expect(text).toContain(v);
    }
  });

  it("folds in the SIM identity with the amber badge (SIM-unmistakable, compactly)", () => {
    const text = render(snap());
    expect(text).toContain("SIM");
    expect(text).toContain("SIM-A1B2C3");
    expect(text).toContain("C172S");
    // The badge carries the amber accent class, not a plain label — that is the unmistakability.
    expect(classNamesIn(ImmersiveHudBar({ snapshot: snap(), attitudeStyle: "line" })))
      .toContain("hud-sim-badge");
  });

  it("surfaces live warnings (safety) right in the bar", () => {
    const text = render(snap({ stalled: true, overspeed: true }));
    expect(text).toContain("STALL");
    expect(text).toContain("OVERSPEED");
  });

  it("reuses the shared attitude geometry — rolls the horizon, does not rewrite it", () => {
    // Broken-arm: if the bar drew its own mini horizon the roll transform would differ; asserting
    // the exact six-pack string proves it delegates to AttitudeIndicator.
    const el = ImmersiveHudBar({ snapshot: snap({ rollRad: degToRad(30) }), attitudeStyle: "line" });
    expect(collectAttr(el, "transform")).toContain("rotate(-30 60 60)");
  });
});
