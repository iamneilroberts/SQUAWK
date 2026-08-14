import { describe, it, expect } from "vitest";
import {
  EM_DASH, SIM_RATE_WARNING,
  formatIasKt, formatTasKt, formatAltFt, formatVsiFpm, formatHeadingDeg, formatAoaDeg,
  formatG, formatThrottlePct, formatTrim, formatFlaps, formatGear, formatClearanceFt,
  formatAirtime, formatSimRate, formatCallsign, formatClass, formatLightPhase,
  formatMach, formatFlightLevel, formatAfterburner,
  warningsFor, gearOverspeedFor,
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
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  lightPhase: "day",
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
    expect(formatGear("fixed", 1)).toBe("GEAR FIXED");
    expect(formatGear("retractable", 1)).toBe("GEAR DOWN");
  });
  it("reports GEAR UP, GEAR IN TRANSIT and an em-dash for the unknown case", () => {
    expect(formatGear("retractable", 0)).toBe("GEAR UP");
    expect(formatGear("retractable", 0.5)).toBe("GEAR IN TRANSIT");
    expect(formatGear(null, null)).toBe(`GEAR ${EM_DASH}`);
    expect(formatGear("retractable", null)).toBe(`GEAR ${EM_DASH}`);
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
  it("reports a Mach overspeed distinctly from an IAS overspeed", () => {
    expect(warningsFor(snap({ machOverspeed: true }))).toContain("MMO");
    expect(warningsFor(snap({ overspeed: true }))).toContain("OVERSPEED");
  });
  it("reports the g limit being reached", () => {
    expect(warningsFor(snap({ gLimited: true }))).toContain("G LIMIT");
  });
  it("surfaces the sink-rate-aware ground-proximity call from gpws (SINK RATE), not a fixed floor", () => {
    // Low and descending hard trips the caution; low but level does NOT (the old false positive).
    expect(warningsFor(snap({ terrainClearanceM: ftToM(400), verticalSpeedMs: fpmToMs(-2000) })))
      .toContain("SINK RATE");
    expect(warningsFor(snap({ terrainClearanceM: ftToM(400), verticalSpeedMs: 0 })))
      .not.toContain("SINK RATE");
  });
  it("does not nag a normal low pass or stabilized approach (level or gentle descent, low AGL)", () => {
    expect(warningsFor(snap({ terrainClearanceM: ftToM(300), verticalSpeedMs: fpmToMs(-600) })))
      .toEqual([]);
  });
  it("reports unverified terrain, which is a different thing from being close to it", () => {
    const w = warningsFor(snap({ terrainUnverified: true }));
    expect(w).toContain("TERRAIN UNVERIFIED");
    expect(w).not.toContain("SINK RATE");
    expect(w).not.toContain("PULL UP");
  });
  it("never claims terrain proximity when the ground has never been sampled", () => {
    const w = warningsFor(snap({ terrainClearanceM: null, verticalSpeedMs: fpmToMs(-3000) }));
    expect(w).not.toContain("SINK RATE");
    expect(w).not.toContain("PULL UP");
  });
  it("reports several at once, stall first", () => {
    const w = warningsFor(snap({ stalled: true, gLimited: true, terrainClearanceM: ftToM(100), verticalSpeedMs: fpmToMs(-2500) }));
    expect(w[0]).toBe("STALL");
    expect(w).toHaveLength(3);
    expect(w).toContain("PULL UP");
  });
  it("reports a gear overspeed distinctly from IAS and Mach overspeed", () => {
    expect(warningsFor(snap({ gearOverspeed: true }))).toContain("GEAR O'SPD");
    expect(warningsFor(snap({ overspeed: true }))).toContain("OVERSPEED");
    expect(warningsFor(snap({ overspeed: true }))).not.toContain("GEAR O'SPD");
  });
});

describe("gearOverspeedFor (GR-004 gate)", () => {
  const VLE = 100;

  it("trips for retractable gear, extended, above vle", () => {
    expect(gearOverspeedFor("retractable", 1, VLE + 1, VLE)).toBe(true);
  });
  it("never trips for fixed gear, even extended and fast — catches a dropped gear-type clause", () => {
    expect(gearOverspeedFor("fixed", 1, VLE + 1, VLE)).toBe(false);
  });
  it("does not trip when the gear is up — catches a dropped gearPosition clause", () => {
    expect(gearOverspeedFor("retractable", 0, VLE + 1, VLE)).toBe(false);
  });
  it("does not trip below vle even with gear extended — catches a dropped IAS clause", () => {
    expect(gearOverspeedFor("retractable", 1, VLE - 1, VLE)).toBe(false);
  });
});

describe("formatLightPhase", () => {
  it("labels each phase for the HUD", () => {
    expect(formatLightPhase("day")).toBe("SKY DAY");
    expect(formatLightPhase("civil-twilight")).toBe("SKY TWILIGHT");
    expect(formatLightPhase("night")).toBe("SKY NIGHT");
  });
  it("em-dashes an unknown phase rather than inventing one", () => {
    expect(formatLightPhase(null)).toBe(EM_DASH);
  });
});

describe("jet EFIS/HUD formatters (unified glass)", () => {
  it("formats Mach to two decimals, em-dash when unknown", () => {
    expect(formatMach(0.78)).toBe("0.78");
    expect(formatMach(0.8)).toBe("0.80");
    expect(formatMach(null)).toBe(EM_DASH);
  });
  it("formats a flight level as three padded hundreds-of-feet, em-dash when unknown", () => {
    expect(formatFlightLevel(ftToM(35000))).toBe("FL350");
    expect(formatFlightLevel(ftToM(9000))).toBe("FL090");
    expect(formatFlightLevel(null)).toBe(EM_DASH);
  });
  it("names the afterburner state, dry vs wet, em-dash when unknown", () => {
    expect(formatAfterburner(false)).toBe("A/B DRY");
    expect(formatAfterburner(true)).toBe("A/B WET");
    expect(formatAfterburner(null)).toBe(`A/B ${EM_DASH}`);
  });
});
