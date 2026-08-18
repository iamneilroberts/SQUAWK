import { describe, it, expect } from "vitest";
import {
  gpwsWarningsFor,
  groundProximityActive,
  GPWS_ARM_ALT_FT,
  GPWS_SINK_BASE_FPM,
  GPWS_SINK_SLOPE_FPM_PER_FT,
  GPWS_PULLUP_BASE_FPM,
  GPWS_PULLUP_SLOPE_FPM_PER_FT,
} from "./gpws";
import { ftToM, fpmToMs } from "../sim/units";
import type { HudSnapshot } from "./snapshot";

/** Minimal snapshot fixture — only the fields gpws reads matter; the rest are honest defaults. */
const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: 0, tasMs: 0, altitudeM: 0,
  verticalSpeedMs: 0, headingRad: 0,
  pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 0, lonDeg: 0,
  aoaRad: 0, loadFactor: 1,
  throttle: 0, trim: 0, flapLabel: "0", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(1000), terrainUnverified: false,
  simRate: 1, airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1B2C3",
  modelNote: "", machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  lightPhase: "day",
  ...o,
});

/** Sink (descent) is negative verticalSpeedMs; helper spells that out in the tests. */
const descending = (fpm: number) => fpmToMs(-fpm);

const sinkThresholdFpm = (aglFt: number) => GPWS_SINK_BASE_FPM + aglFt * GPWS_SINK_SLOPE_FPM_PER_FT;
const pullUpThresholdFpm = (aglFt: number) => GPWS_PULLUP_BASE_FPM + aglFt * GPWS_PULLUP_SLOPE_FPM_PER_FT;

describe("gpwsWarningsFor — sink-rate-aware ground proximity", () => {
  it("is silent in level flight near the ground (the old fixed-floor false positive is gone)", () => {
    // 300 ft AGL, wings level, no descent — a normal low pass should NOT nag.
    expect(gpwsWarningsFor(snap({ terrainClearanceM: ftToM(300), verticalSpeedMs: 0 }))).toEqual([]);
  });

  it("is silent on a normal stabilized approach descent near the ground", () => {
    // 400 ft AGL descending ~700 fpm (a ~3deg airliner approach) — well under the envelope.
    expect(gpwsWarningsFor(snap({ terrainClearanceM: ftToM(400), verticalSpeedMs: descending(700) })))
      .toEqual([]);
  });

  it("is silent while climbing regardless of how low the AGL is", () => {
    expect(gpwsWarningsFor(snap({ terrainClearanceM: ftToM(50), verticalSpeedMs: fpmToMs(2000) })))
      .toEqual([]);
  });

  it("warns SINK RATE when descending faster than the altitude-scaled caution threshold", () => {
    const aglFt = 500;
    const overCaution = sinkThresholdFpm(aglFt) + 50;
    expect(gpwsWarningsFor(snap({ terrainClearanceM: ftToM(aglFt), verticalSpeedMs: descending(overCaution) })))
      .toEqual(["SINK RATE"]);
  });

  it("does not warn just below the caution threshold — the envelope has real margin", () => {
    const aglFt = 500;
    const underCaution = sinkThresholdFpm(aglFt) - 50;
    expect(gpwsWarningsFor(snap({ terrainClearanceM: ftToM(aglFt), verticalSpeedMs: descending(underCaution) })))
      .toEqual([]);
  });

  it("escalates to PULL UP when the descent is dangerous for the height", () => {
    const aglFt = 300;
    const overPullUp = pullUpThresholdFpm(aglFt) + 50;
    expect(gpwsWarningsFor(snap({ terrainClearanceM: ftToM(aglFt), verticalSpeedMs: descending(overPullUp) })))
      .toEqual(["PULL UP"]);
  });

  it("tolerates less sink the closer to the ground (envelope tightens with lower AGL)", () => {
    // A 1300 fpm descent trips SINK RATE at 100 ft but is tolerated higher up at 1000 ft.
    const sink = descending(1300);
    expect(gpwsWarningsFor(snap({ terrainClearanceM: ftToM(100), verticalSpeedMs: sink })))
      .toEqual(["SINK RATE"]);
    expect(gpwsWarningsFor(snap({ terrainClearanceM: ftToM(1000), verticalSpeedMs: sink })))
      .toEqual([]);
  });

  it("says nothing above the arming altitude, even with a strong descent", () => {
    const aglFt = GPWS_ARM_ALT_FT + 100;
    expect(gpwsWarningsFor(snap({ terrainClearanceM: ftToM(aglFt), verticalSpeedMs: descending(6000) })))
      .toEqual([]);
  });

  it("emits TERRAIN UNVERIFIED, and only that, when the ground height is unknown — it takes precedence", () => {
    const w = gpwsWarningsFor(snap({ terrainUnverified: true, terrainClearanceM: ftToM(50), verticalSpeedMs: descending(4000) }));
    expect(w).toEqual(["TERRAIN UNVERIFIED"]);
    expect(w).not.toContain("PULL UP");
    expect(w).not.toContain("SINK RATE");
  });

  it("never claims proximity when the ground has never been sampled (clearance null)", () => {
    expect(gpwsWarningsFor(snap({ terrainClearanceM: null, verticalSpeedMs: descending(4000) })))
      .toEqual([]);
    // ...unless the sampler explicitly reports unverified, which is a different, honest message.
    expect(gpwsWarningsFor(snap({ terrainClearanceM: null, terrainUnverified: true })))
      .toEqual(["TERRAIN UNVERIFIED"]);
  });

  it("suppresses TERRAIN UNVERIFIED at cruise but keeps it low, where an unknown floor matters", () => {
    // High MSL: the chip is noise (and the sampler routinely can't resolve the tile far below).
    expect(gpwsWarningsFor(snap({ terrainUnverified: true, terrainClearanceM: null, altitudeM: ftToM(26000) })))
      .toEqual([]);
    // Low: still the honest "we don't know the ground" message.
    expect(gpwsWarningsFor(snap({ terrainUnverified: true, terrainClearanceM: null, altitudeM: ftToM(3000) })))
      .toEqual(["TERRAIN UNVERIFIED"]);
  });
});

describe("groundProximityActive — drives the AGL amber emphasis", () => {
  it("is true while a SINK RATE or PULL UP call is up", () => {
    expect(groundProximityActive(snap({ terrainClearanceM: ftToM(300), verticalSpeedMs: descending(pullUpThresholdFpm(300) + 50) }))).toBe(true);
    expect(groundProximityActive(snap({ terrainClearanceM: ftToM(500), verticalSpeedMs: descending(sinkThresholdFpm(500) + 50) }))).toBe(true);
  });
  it("is false in nominal flight and while the ground is merely unverified (AGL already reads honestly)", () => {
    expect(groundProximityActive(snap())).toBe(false);
    expect(groundProximityActive(snap({ terrainUnverified: true }))).toBe(false);
  });
});
