import { describe, it, expect } from "vitest";
import ImmersiveHudBar, {
  immersiveBarFields,
  nextImmersiveHudVariant,
  prioritizedImmersiveWarnings,
  relativeBearingDeg,
  tapeTicks,
  tapeStripOffset,
  tapeRangesFor,
  tapeBandBox,
  TAPE_WINDOW_PX,
  type TapeRange,
} from "./ImmersiveHudBar";
import type { HudSnapshot } from "./snapshot";
import { ktToMs, ftToM, fpmToMs, degToRad } from "../sim/units";
import { EM_DASH } from "./format";

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
function firstPropsForType(node: unknown, wanted: string): Record<string, unknown> | null {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = firstPropsForType(child, wanted);
      if (found !== null) return found;
    }
    return null;
  }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (type === wanted && props) return props;
  if (typeof type === "function") {
    return firstPropsForType((type as (p: unknown) => unknown)(props), wanted);
  }
  return props && "children" in props ? firstPropsForType(props.children, wanted) : null;
}
/** Finds the first node (any type) whose props[key] === value; used to isolate one Tape's
 *  subtree (e.g. data-side="left") so structural assertions don't blend the IAS and ALT tapes. */
function findNodeByAttr(node: unknown, key: string, value: unknown): unknown {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNodeByAttr(child, key, value);
      if (found !== null) return found;
    }
    return null;
  }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props && props[key] === value) return node;
  if (typeof type === "function") {
    return findNodeByAttr((type as (p: unknown) => unknown)(props), key, value);
  }
  return props && "children" in props ? findNodeByAttr(props.children, key, value) : null;
}

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

  it("folds in the SIM badge but drops the callsign and class from the live rail (UI-002)", () => {
    const text = render(snap());
    expect(text).toContain("SIM");
    expect(text).not.toContain("SIM-A1B2C3");
    expect(text).not.toContain("C172S");
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

  it("renders A as the balanced rail and C as the tape rail", () => {
    const balanced = ImmersiveHudBar({ snapshot: snap(), attitudeStyle: "line", variant: "balanced" });
    const tapes = ImmersiveHudBar({ snapshot: snap(), attitudeStyle: "line", variant: "tapes" });
    expect(classNamesIn(balanced)).toContain("imm-bar-balanced");
    expect(classNamesIn(tapes)).toContain("imm-bar-tapes");
    expect(classNamesIn(tapes)).toContain("imm-tape");
  });

  it("keeps the practical systems data in C rather than making the tapes decorative", () => {
    const text = collectText(ImmersiveHudBar({
      snapshot: snap(),
      attitudeStyle: "line",
      variant: "tapes",
      navCue: { destination: "KADS · RWY 16", bearingDeg: 298, distanceNm: 6.8 },
    })).join(" ");
    // Destination NAME + DISTANCE stay in the bar as reference data.
    for (const value of ["IAS", "ALT", "VSI", "AGL", "KADS", "6.8"]) {
      expect(text).toContain(value);
    }
    // #82: the inline turn arrow + "DEST +N°" moved to the big edge chevron (EdgeTurnCue), so
    // there is exactly one turn indicator. FLP/THR live on the touch buttons + throttle lever (#48).
    for (const gone of ["FLP", "THR", "DEST", "+28°"]) {
      expect(text).not.toContain(gone);
    }
  });

  it("toggles A to C and C back to A through one accessible control", () => {
    expect(nextImmersiveHudVariant("balanced")).toBe("tapes");
    expect(nextImmersiveHudVariant("tapes")).toBe("balanced");
    let selected = "";
    const el = ImmersiveHudBar({
      snapshot: snap(),
      attitudeStyle: "line",
      variant: "balanced",
      onVariantChange: (variant) => { selected = variant; },
    });
    const button = firstPropsForType(el, "button");
    expect(button?.["aria-label"]).toContain("switch to C compact tapes");
    (button?.onClick as (() => void))();
    expect(selected).toBe("tapes");
  });

  it("hides the HUD-A/C toggle when decluttered (#57) — the rail itself stays", () => {
    const el = ImmersiveHudBar({
      snapshot: snap(),
      attitudeStyle: "line",
      variant: "balanced",
      onVariantChange: () => {},
      decluttered: true,
    });
    expect(classNamesIn(el)).not.toContain("imm-hud-toggle");
    expect(firstPropsForType(el, "button")).toBeNull();
    expect(collectText(el).join(" ")).toContain("IAS");
  });

  it("fades the HUD-A/C toggle when toggleFaded, but keeps the warning annunciator (#48)", () => {
    // A live warning forces the chrome visible; Hud passes toggleFaded=true so the layout picker
    // stays hidden mid-alert while the warnings layer (its own never-faded band) still renders.
    const el = ImmersiveHudBar({
      snapshot: snap({ stalled: true }),
      attitudeStyle: "line",
      variant: "balanced",
      onVariantChange: () => {},
      toggleFaded: true,
    });
    expect(classNamesIn(el)).toContain("imm-hud-toggle-faded");
    expect(collectText(el).join(" ")).toContain("STALL");
  });

  it("puts safety calls before approach coaching and caps the transient rail", () => {
    expect(prioritizedImmersiveWarnings(
      snap({ stalled: true, overspeed: true }),
      ["HIGH", "NOT LINED UP"],
    )).toEqual(["STALL", "OVERSPEED", "HIGH"]);
  });

  it("wraps destination bearing around north without inventing a long turn", () => {
    expect(relativeBearingDeg(degToRad(350), 10)).toBeCloseTo(20);
    expect(relativeBearingDeg(degToRad(10), 350)).toBeCloseTo(-20);
  });
});

describe("tape geometry", () => {
  const r: TapeRange = { min: 0, max: 200, step: 10, major: 20, pxPerUnit: 1.3 };

  it("builds ticks from min to max with major flags and y offsets", () => {
    const ticks = tapeTicks(r);
    expect(ticks[0]).toEqual({ value: 0, major: true, y: 0 });
    expect(ticks[1]).toEqual({ value: 10, major: false, y: 13 });
    expect(ticks[2]).toEqual({ value: 20, major: true, y: 26 });
    expect(ticks[ticks.length - 1].value).toBe(200);
  });

  it("centers the current value under the pointer", () => {
    // value at min -> strip shifted up by half the window only
    expect(tapeStripOffset(0, r)).toBeCloseTo(-TAPE_WINDOW_PX / 2);
    // value of 100 -> (100-0)*1.3 - 22 = 108
    expect(tapeStripOffset(100, r)).toBeCloseTo(130 - TAPE_WINDOW_PX / 2);
  });

  it("clamps out-of-range values to the strip ends", () => {
    expect(tapeStripOffset(-50, r)).toBeCloseTo(tapeStripOffset(0, r));
    expect(tapeStripOffset(9999, r)).toBeCloseTo(tapeStripOffset(200, r));
  });

  it("is monotonic increasing in value", () => {
    expect(tapeStripOffset(50, r)).toBeLessThan(tapeStripOffset(60, r));
  });
});

describe("tapeRangesFor", () => {
  it("uses the per-class ASI face for the IAS tape (spec §6)", () => {
    const ga = tapeRangesFor({ display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 } });
    expect(ga.ias.min).toBe(40);
    expect(ga.ias.max).toBe(180);
    // ~13,451 ft ceiling -> rounded up to a clean 14,000 ft top
    expect(ga.alt.min).toBe(0);
    expect(ga.alt.max).toBe(14000);
  });

  it("gives an airliner a far taller altitude tape than a GA type", () => {
    const jet = tapeRangesFor({ display: { asiMinKt: 60, asiMaxKt: 400 }, limits: { serviceCeilingM: 12500 } });
    const ga = tapeRangesFor({ display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 } });
    expect(jet.alt.max).toBeGreaterThan(ga.alt.max);
    expect(jet.ias.max).toBeGreaterThan(ga.ias.max);
  });

  it("keeps tick spacing sane (major is a positive multiple of step)", () => {
    const r = tapeRangesFor({ display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 } });
    for (const t of [r.ias, r.alt]) {
      expect(t.step).toBeGreaterThan(0);
      expect(t.major % t.step).toBe(0);
      expect(t.pxPerUnit).toBeGreaterThan(0);
    }
  });
});

describe("functional tapes", () => {
  const tapeRange = tapeRangesFor({
    display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 },
  });
  const withTapeSnap = (o: Partial<HudSnapshot> = {}) => snap(o);

  it("shows the live IAS and ALT under the fixed pointers", () => {
    const s = { ...withTapeSnap(), iasMs: ktToMs(115), altitudeM: ftToM(3200) };
    const tree = ImmersiveHudBar({ snapshot: s, attitudeStyle: "ball", variant: "tapes", tapeRange });
    const text = collectText(tree);
    expect(text).toContain("115"); // IAS pointer
    expect(text).toContain("3200"); // ALT pointer
  });

  it("rounds the pointer values and rebases when the snapshot changes", () => {
    const s2 = { ...withTapeSnap(), iasMs: ktToMs(64.6), altitudeM: ftToM(999.4) };
    const tree = ImmersiveHudBar({ snapshot: s2, attitudeStyle: "ball", variant: "tapes", tapeRange });
    const text = collectText(tree);
    expect(text).toContain("65");   // 64.6 kt -> 65
    expect(text).toContain("999");  // 999.4 ft -> 999
  });

  it("renders an actual tape strip with ticks, not just a static readout", () => {
    const s = { ...withTapeSnap(), iasMs: ktToMs(115), altitudeM: ftToM(3200) };
    const tree = ImmersiveHudBar({ snapshot: s, attitudeStyle: "ball", variant: "tapes", tapeRange });
    const classNames = classNamesIn(tree);
    expect(classNames).toContain("tape-strip");
    const iasTape = findNodeByAttr(tree, "data-side", "left");
    const iasTickCount = classNamesIn(iasTape).filter((c) => c === "tape-tick").length;
    expect(iasTickCount).toBeGreaterThan(1); // multiple ticks, not a single static readout
    expect(iasTickCount).toBe(tapeTicks(tapeRange.ias).length);
  });

  it("shows EM_DASH instead of a fabricated number when no tapeRange is supplied", () => {
    const s = { ...withTapeSnap(), iasMs: ktToMs(115), altitudeM: ftToM(3200) };
    const tree = ImmersiveHudBar({ snapshot: s, attitudeStyle: "ball", variant: "tapes" });
    const classNames = classNamesIn(tree);
    expect(classNames).not.toContain("tape-strip");
    expect(classNames.filter((c) => c === "tape-tick")).toHaveLength(0);
    const text = collectText(tree);
    expect(text).toContain(EM_DASH);
    expect(text).not.toContain("115");
    expect(text).not.toContain("3200");
  });
});

describe("approach band (#52)", () => {
  const tapeRange = tapeRangesFor({
    display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 },
  });
  const approachBand = {
    distanceNm: 3,
    speed: { targetKt: 65, loKt: 60, hiKt: 70 },
    altitude: { targetFt: 1065, loFt: 895, hiFt: 1235 },
  };

  it("computes a clamped band box from tape units to pixels", () => {
    const box = tapeBandBox(60, 70, tapeRange.ias);
    expect(box.bottomPx).toBeCloseTo((60 - tapeRange.ias.min) * tapeRange.ias.pxPerUnit);
    expect(box.heightPx).toBeCloseTo(10 * tapeRange.ias.pxPerUnit);
    // clamps to the tape ends rather than overflowing the strip
    const clamped = tapeBandBox(-100, 9999, tapeRange.ias);
    expect(clamped.bottomPx).toBeCloseTo(0);
    expect(clamped.heightPx).toBeCloseTo((tapeRange.ias.max - tapeRange.ias.min) * tapeRange.ias.pxPerUnit);
  });

  it("draws a target band on both the IAS and ALT tapes during approach", () => {
    const tree = ImmersiveHudBar({
      snapshot: snap(), attitudeStyle: "ball", variant: "tapes", tapeRange, approachBand,
    });
    expect(classNamesIn(tree).filter((c) => c === "tape-band").length).toBe(2);
  });

  it("shows the suggested speed and altitude band as a director line", () => {
    const tree = ImmersiveHudBar({
      snapshot: snap(), attitudeStyle: "ball", variant: "tapes",
      navCue: { destination: "KADS", bearingDeg: 0, distanceNm: 3 }, approachBand,
    });
    const text = collectText(tree).join(" ");
    expect(text).toContain("APCH 60-70 KT");
  });

  it("draws no band and no director line when not on approach", () => {
    const tree = ImmersiveHudBar({
      snapshot: snap(), attitudeStyle: "ball", variant: "tapes", tapeRange, approachBand: null,
    });
    expect(classNamesIn(tree).filter((c) => c === "tape-band").length).toBe(0);
    expect(collectText(tree).join(" ")).not.toContain("APCH");
  });

  it("shows the descent advisory at range, and defers to the approach band on final", () => {
    const descentGuidance = {
      distanceNm: 20, targetAltitudeFt: 1700, descentRateFpm: 440, onProfile: false, targetSpeedKt: 115,
    };
    const far = ImmersiveHudBar({
      snapshot: snap(), attitudeStyle: "ball", variant: "tapes", descentGuidance,
    });
    const farText = collectText(far).join(" ");
    expect(farText).toContain("DESC");
    expect(farText).toContain("FPM");
    // On final the approach band takes over; the descent line is suppressed.
    const near = ImmersiveHudBar({
      snapshot: snap(), attitudeStyle: "ball", variant: "tapes", approachBand, descentGuidance,
    });
    const nearText = collectText(near).join(" ");
    expect(nearText).toContain("APCH 60-70 KT");
    expect(nearText).not.toContain("DESC");
  });
});

describe("UI-002 declutter", () => {
  it("keeps the SIM badge but drops callsign and class from the live rail", () => {
    const s = { ...snap(), callsign: "SIM-4F2A", classLabel: "C172S" };
    const tree = ImmersiveHudBar({
      snapshot: s, attitudeStyle: "ball", variant: "tapes",
      tapeRange: tapeRangesFor({ display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 } }),
    });
    const text = collectText(tree).join(" ");
    expect(text).toContain("SIM");
    expect(text).not.toContain("SIM-4F2A");
    expect(text).not.toContain("C172S");
  });
});
