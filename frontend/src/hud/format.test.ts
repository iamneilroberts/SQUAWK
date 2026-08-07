import { describe, it, expect } from "vitest";
import {
  EM_DASH, TERRAIN_WARNING_FT, SIM_RATE_WARNING,
  formatIasKt, formatTasKt, formatAltFt, formatVsiFpm, formatHeadingDeg, formatAoaDeg,
  formatG, formatThrottlePct, formatTrim, formatFlaps, formatGear, formatClearanceFt,
  formatAirtime, formatSimRate, formatCallsign, formatClass, warningsFor,
} from "./format";
import { ktToMs, ftToM, fpmToMs, degToRad } from "../sim/units";
import type { HudSnapshot } from "./snapshot";

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500),
  verticalSpeedMs: 0, headingRad: 0,
  pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30.6944, lonDeg: -88.0399,
  aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, trim: 0, flapLabel: "0", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false,
  simRate: 1, airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1B2C3",
  modelNote: "C172 MODEL THIS BUILD",
  ...o,
});

describe("speeds and altitude", () => {
  it("renders whole knots", () => {
    expect(formatIasKt(ktToMs(122.4))).toBe("122");
    expect(formatTasKt(ktToMs(139.6))).toBe("140");
  });
  it("renders whole feet", () => {
    expect(formatAltFt(ftToM(3499.6))).toBe("3500");
  });
  it("renders an em-dash for unknown values rather than a zero", () => {
    expect(formatIasKt(null)).toBe(EM_DASH);
    expect(formatTasKt(null)).toBe(EM_DASH);
    expect(formatAltFt(null)).toBe(EM_DASH);
  });
  it("keeps a legitimate negative altitude (Dead Sea, Schiphol) instead of clamping it", () => {
    expect(formatAltFt(ftToM(-40))).toBe("-40");
  });
});

describe("vertical speed", () => {
  it("signs a climb and a descent", () => {
    expect(formatVsiFpm(fpmToMs(700))).toBe("+700");
    expect(formatVsiFpm(fpmToMs(-1200))).toBe("-1200");
  });
  it("renders level flight as a bare 0, not +0", () => {
    expect(formatVsiFpm(0)).toBe("0");
  });
  it("rounds to the nearest 10 fpm — a needle does not resolve single feet per minute", () => {
    expect(formatVsiFpm(fpmToMs(703))).toBe("+700");
    expect(formatVsiFpm(fpmToMs(-706))).toBe("-710");
  });
  it("em-dashes an unknown vertical speed", () => {
    expect(formatVsiFpm(null)).toBe(EM_DASH);
  });
});

describe("heading", () => {
  it("is always three digits", () => {
    expect(formatHeadingDeg(degToRad(7))).toBe("007");
    expect(formatHeadingDeg(degToRad(90))).toBe("090");
    expect(formatHeadingDeg(degToRad(359))).toBe("359");
  });
  it("wraps 359.6 to 000 rather than printing 360", () => {
    expect(formatHeadingDeg(degToRad(359.6))).toBe("000");
    expect(formatHeadingDeg(degToRad(360))).toBe("000");
  });
  it("normalizes a negative heading", () => {
    expect(formatHeadingDeg(degToRad(-90))).toBe("270");
  });
  it("em-dashes an unknown heading", () => {
    expect(formatHeadingDeg(null)).toBe(EM_DASH);
  });
});

describe("the rest of the readouts", () => {
  it("AoA is one decimal degree, signed", () => {
    expect(formatAoaDeg(degToRad(4.23))).toBe("4.2");
    expect(formatAoaDeg(degToRad(-2.0))).toBe("-2.0");
    expect(formatAoaDeg(null)).toBe(EM_DASH);
  });
  it("g is one decimal, always signed", () => {
    expect(formatG(1)).toBe("+1.0");
    expect(formatG(-0.5)).toBe("-0.5");
    expect(formatG(3.84)).toBe("+3.8");
    expect(formatG(null)).toBe(EM_DASH);
  });
  it("throttle is a whole percent", () => {
    expect(formatThrottlePct(0.755)).toBe("76%");
    expect(formatThrottlePct(0)).toBe("0%");
    expect(formatThrottlePct(null)).toBe(EM_DASH);
  });
  it("flaps and gear read as the panel would", () => {
    expect(formatFlaps("20")).toBe("FLAPS 20");
    expect(formatFlaps(null)).toBe(`FLAPS ${EM_DASH}`);
    expect(formatGear("fixed")).toBe("GEAR FIXED");
    expect(formatGear("retractable")).toBe("GEAR DOWN");
  });
  it("trim reads as a signed nose-up/down percentage, neutral at centre (issue #7)", () => {
    expect(formatTrim(0)).toBe("NEUTRAL");
    expect(formatTrim(0.25)).toBe("NOSE UP 25%");
    expect(formatTrim(-0.4)).toBe("NOSE DN 40%");
    expect(formatTrim(1)).toBe("NOSE UP 100%");
    expect(formatTrim(null)).toBe(EM_DASH);
  });
  it("terrain clearance is whole feet, em-dashed when the ground is unknown", () => {
    expect(formatClearanceFt(ftToM(1240))).toBe("1240");
    expect(formatClearanceFt(null)).toBe(EM_DASH);
  });
  it("airtime is mm:ss", () => {
    expect(formatAirtime(0)).toBe("00:00");
    expect(formatAirtime(65)).toBe("01:05");
    expect(formatAirtime(3599)).toBe("59:59");
  });
  it("the callsign is synthetic and uppercase", () => {
    expect(formatCallsign("a1b2c3")).toBe("SIM-A1B2C3");
  });
  it("the aircraft class is uppercase, em-dashed when unknown", () => {
    expect(formatClass("C172S")).toBe("C172S");
    expect(formatClass("c172s")).toBe("C172S");
    expect(formatClass(null)).toBe(EM_DASH);
    expect(formatClass("")).toBe(EM_DASH);
  });
});

describe("formatSimRate", () => {
  it("says nothing while the sim keeps up", () => {
    expect(formatSimRate(1)).toBeNull();
    expect(formatSimRate(SIM_RATE_WARNING)).toBeNull();
  });
  it("says so out loud when it falls behind", () => {
    expect(formatSimRate(0.7)).toBe("SIM RATE 0.7×");
    expect(formatSimRate(0.34)).toBe("SIM RATE 0.3×");
  });
});

describe("warningsFor", () => {
  it("is empty in normal flight", () => {
    expect(warningsFor(snap())).toEqual([]);
  });
  it("reports a stall", () => {
    expect(warningsFor(snap({ stalled: true }))).toContain("STALL");
  });
  it("reports an overspeed", () => {
    expect(warningsFor(snap({ overspeed: true }))).toContain("OVERSPEED");
  });
  it("reports the g limit being reached", () => {
    expect(warningsFor(snap({ gLimited: true }))).toContain("G LIMIT");
  });
  it("reports terrain proximity below 500 ft of clearance", () => {
    expect(warningsFor(snap({ terrainClearanceM: ftToM(TERRAIN_WARNING_FT - 1) }))).toContain("TERRAIN");
    expect(warningsFor(snap({ terrainClearanceM: ftToM(TERRAIN_WARNING_FT + 1) }))).not.toContain("TERRAIN");
  });
  it("reports unverified terrain, which is a different thing from being close to it", () => {
    const w = warningsFor(snap({ terrainUnverified: true }));
    expect(w).toContain("TERRAIN UNVERIFIED");
    expect(w).not.toContain("TERRAIN");
  });
  it("never claims terrain proximity when the ground has never been sampled", () => {
    expect(warningsFor(snap({ terrainClearanceM: null, terrainUnverified: true })))
      .not.toContain("TERRAIN");
  });
  it("reports several at once, stall first", () => {
    const w = warningsFor(snap({ stalled: true, gLimited: true, terrainClearanceM: 10 }));
    expect(w[0]).toBe("STALL");
    expect(w).toHaveLength(3);
  });
});
