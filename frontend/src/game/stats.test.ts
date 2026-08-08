import { describe, it, expect } from "vitest";
import { createStatsAccumulator } from "./stats";
import { geodeticToEcef } from "../sim/geo";
import { quatFromHpr } from "../sim/quat";
import { degToRad, ktToMs, msToKt, mToFt } from "../sim/units";
import type { SimState } from "../sim/types";

function state(o: Partial<SimState> = {}): SimState {
  const position = o.position ?? geodeticToEcef(degToRad(30.7), degToRad(-88), 1000);
  return {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    attitude: quatFromHpr(position, 0, 0, 0),
    rates: { x: 0, y: 0, z: 0 },
    timeS: 0,
    altitudeM: 1000, tasMs: ktToMs(100), iasMs: ktToMs(95), aoaRad: 0, sideslipRad: 0,
    verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false, machNumber: 0, gearPosition: 0,
    ...o,
  };
}

describe("stats accumulator", () => {
  it("airtime is the sim time elapsed since the spawn", () => {
    const acc = createStatsAccumulator(state({ timeS: 0 }));
    acc.update(state({ timeS: 42.5 }));
    expect(acc.finish(state({ timeS: 42.5 }), "LANDED").airtimeS).toBeCloseTo(42.5, 6);
  });
  it("distance accumulates along the path, not as the crow flies from the start", () => {
    const acc = createStatsAccumulator(state({ position: geodeticToEcef(degToRad(30.7), degToRad(-88), 1000) }));
    acc.update(state({ position: geodeticToEcef(degToRad(30.8), degToRad(-88), 1000) }));
    acc.update(state({ position: geodeticToEcef(degToRad(30.7), degToRad(-88), 1000) }));
    const s = acc.finish(state(), "CRASHED");
    expect(s.distanceM).toBeGreaterThan(20000); // ~11 km out and ~11 km back
  });
  it("tracks the maxima, not the last value", () => {
    const acc = createStatsAccumulator(state());
    acc.update(state({ iasMs: ktToMs(150), altitudeM: 4000, loadFactor: 3.1 }));
    acc.update(state({ iasMs: ktToMs(80), altitudeM: 900, loadFactor: 0.4 }));
    const s = acc.finish(state(), "CRASHED");
    expect(msToKt(s.maxIasMs)).toBeCloseTo(150, 3);
    expect(mToFt(s.maxAltitudeM)).toBeCloseTo(mToFt(4000), 3);
    expect(s.maxG).toBeCloseTo(3.1, 6);
  });
  it("records the impact sink rate as a positive fpm and the impact speed", () => {
    const acc = createStatsAccumulator(state());
    const s = acc.finish(state({ verticalSpeedMs: -4, iasMs: ktToMs(65) }), "CRASHED");
    expect(s.impactSinkFpm).toBeGreaterThan(700);
    expect(msToKt(s.impactIasMs)).toBeCloseTo(65, 3);
  });
  it("a climbing arrival reports a negative sink rather than lying about it", () => {
    const acc = createStatsAccumulator(state());
    expect(acc.finish(state({ verticalSpeedMs: 2 }), "CRASHED").impactSinkFpm).toBeLessThan(0);
  });
  it("carries the classification through", () => {
    const acc = createStatsAccumulator(state());
    expect(acc.finish(state(), "LANDED").classification).toBe("LANDED");
  });
  it("a session that ends immediately reports zeroes, not NaN", () => {
    const start = state();
    const s = createStatsAccumulator(start).finish(start, "CRASHED");
    expect(s.airtimeS).toBe(0);
    expect(s.distanceM).toBe(0);
    expect(Number.isFinite(s.maxG)).toBe(true);
  });
});
