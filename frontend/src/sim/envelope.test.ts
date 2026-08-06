/*
 * The C172S performance envelope, asserted against the 172S POH numbers in
 * docs/research/aero-parameters.md §1. These are the numbers that decide whether the
 * parameter file is honest. Tolerances come from the Phase B spec §8 / plan brief:
 * cruise ±5 kt, stall speeds ±3 kt.
 *
 * Speeds are found by search (bisection on the force balance, and a trim search through
 * the real integrator) rather than by hard-coding an expected answer — so the test proves
 * the model produces the number, not that someone typed the number twice.
 */
import { describe, it, expect } from "vitest";
import { loadC172 } from "./params";
import {
  dragCoefficient, stallSpeedIasMs, thrustNewtons, pistonPowerLapse, clMaxFor,
} from "./forces";
import { isaDensity } from "./isa";
import { stepAircraft, refreshDerived } from "./aircraft";
import { geodeticToEcef } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { degToRad, ftToM, ktToMs, msToKt, msToFpm } from "./units";
import type { ClassParams, ControlVector, SimState } from "./types";

const P = loadC172();
const G0 = 9.80665;
const LAT = degToRad(30.6944);
const LON = degToRad(-88.0399);

/** Thrust minus the drag required to hold level flight at this speed. */
function levelFlightExcessThrustN(
  params: ClassParams, altM: number, throttle: number, flapIndex: number, tasMs: number,
): number {
  const qBar = 0.5 * isaDensity(altM) * tasMs * tasMs;
  const cl = (params.massKg * G0) / (qBar * params.wingAreaM2);
  const cd = dragCoefficient(cl, params, params.flaps[flapIndex]);
  return thrustNewtons(params, throttle, tasMs, altM) - cd * qBar * params.wingAreaM2;
}

/** The high-speed root of thrust = drag: the fastest speed this power setting can hold. */
function maxLevelSpeedMs(params: ClassParams, altM: number, throttle: number, flapIndex = 0): number {
  const f = (v: number) => levelFlightExcessThrustN(params, altM, throttle, flapIndex, v);
  // Scan for the speed of maximum excess thrust, then bisect upward from there.
  let lo = 10;
  let best = -Infinity;
  for (let v = 10; v <= 200; v += 0.5) {
    const e = f(v);
    if (e > best) { best = e; lo = v; }
  }
  expect(best).toBeGreaterThan(0); // this power setting can hold level flight at all
  let hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Best rate of climb at this altitude and power, m/s, by scanning the speed range. */
function bestClimbRateMs(params: ClassParams, altM: number, throttle: number): number {
  let best = -Infinity;
  for (let v = 15; v <= 120; v += 0.25) {
    const excess = levelFlightExcessThrustN(params, altM, throttle, 0, v);
    const climb = (excess * v) / (params.massKg * G0);
    if (climb > best) best = climb;
  }
  return best;
}

function levelState(altM: number, tasMs: number, controls: ControlVector): SimState {
  const position = geodeticToEcef(LAT, LON, altM);
  const attitude = quatFromHpr(position, 0, 0, 0);
  return refreshDerived(
    {
      position,
      velocity: qRotate(attitude, { x: tasMs, y: 0, z: 0 }),
      attitude,
      rates: { x: 0, y: 0, z: 0 },
      timeS: 0,
      altitudeM: altM, tasMs, iasMs: 0, aoaRad: 0, sideslipRad: 0,
      verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false,
    },
    controls,
    P,
  );
}

/** Fly for `seconds` and report the altitude change and the mean TAS over the last third. */
function flyAndMeasure(
  start: SimState, controls: ControlVector, seconds: number,
): { dAltM: number; meanTasMs: number } {
  const steps = Math.round(seconds * 60);
  const tailFrom = Math.floor(steps * (2 / 3));
  let s = start;
  let tasSum = 0;
  let tasN = 0;
  for (let i = 0; i < steps; i++) {
    s = stepAircraft(s, controls, P);
    if (i >= tailFrom) { tasSum += s.tasMs; tasN++; }
  }
  return { dAltM: s.altitudeM - start.altitudeM, meanTasMs: tasSum / tasN };
}

/** Bisect on elevator trim until 120 s of flight ends at the altitude it started at. */
function trimForLevelFlight(altM: number, throttle: number, startTasMs: number): number {
  const run = (trim: number) => {
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle, flapDetent: 0, trim };
    return flyAndMeasure(levelState(altM, startTasMs, controls), controls, 120).dAltM;
  };
  let lo = -1;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

describe("C172S envelope — cruise", () => {
  it("75% rated power is still available at 8000 ft (throttle needed is under 100%)", () => {
    const throttle = 0.75 / pistonPowerLapse(ftToM(8000));
    expect(throttle).toBeLessThanOrEqual(1);
  });
  it("cruises at 122 kt TAS +/- 5 at 75% power, 8000 ft (POH: 122-124 kt)", () => {
    const alt = ftToM(8000);
    const throttle = 0.75 / pistonPowerLapse(alt);
    const tas = msToKt(maxLevelSpeedMs(P, alt, throttle));
    expect(tas).toBeGreaterThan(117);
    expect(tas).toBeLessThan(127);
  });
  it("the integrator agrees with the force balance: trimmed level flight settles at the same speed", () => {
    const alt = ftToM(8000);
    const throttle = 0.75 / pistonPowerLapse(alt);
    const analytic = maxLevelSpeedMs(P, alt, throttle);
    const trim = trimForLevelFlight(alt, throttle, analytic);
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle, flapDetent: 0, trim };
    const flown = flyAndMeasure(levelState(alt, analytic, controls), controls, 180);
    expect(Math.abs(flown.dAltM)).toBeLessThan(150); // held altitude within 150 m over 3 min
    expect(msToKt(flown.meanTasMs)).toBeGreaterThan(117);
    expect(msToKt(flown.meanTasMs)).toBeLessThan(127);
  });
  it("tops out near 126 kt TAS at sea level, full power (POH Vh 126 kt)", () => {
    const tas = msToKt(maxLevelSpeedMs(P, 0, 1));
    expect(tas).toBeGreaterThan(118);
    expect(tas).toBeLessThan(134);
  });
});

describe("C172S envelope — stall speeds", () => {
  it("Vs1 clean is 48 KCAS +/- 3 (POH 48)", () => {
    const vs1 = msToKt(stallSpeedIasMs(P, 0));
    expect(vs1).toBeGreaterThan(45);
    expect(vs1).toBeLessThan(51);
  });
  it("Vs0 with full flap is 40 KCAS +/- 3 (POH 40)", () => {
    const vs0 = msToKt(stallSpeedIasMs(P, 3));
    expect(vs0).toBeGreaterThan(37);
    expect(vs0).toBeLessThan(43);
  });
  it("clean CLmax stays inside the sourced 1.47-1.58 range", () => {
    expect(clMaxFor(P, P.flaps[0])).toBeGreaterThan(1.47);
    expect(clMaxFor(P, P.flaps[0])).toBeLessThan(1.58);
  });
  it("each flap detent lowers the stall speed monotonically", () => {
    const speeds = P.flaps.map((_, i) => stallSpeedIasMs(P, i));
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThan(speeds[i - 1]);
  });
  it("holding the stick back below Vs1 stalls rather than climbing away", () => {
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 0.2, flapDetent: 0, trim: 1 };
    let s = levelState(1500, stallSpeedIasMs(P, 0) * 0.95, controls);
    let sawStall = false;
    for (let i = 0; i < 600; i++) {
      s = stepAircraft(s, controls, P);
      if (s.stalled) sawStall = true;
    }
    expect(sawStall).toBe(true);
    expect(s.altitudeM).toBeLessThan(1500 + 60);
  });
});

describe("C172S envelope — climb and ceiling", () => {
  it("climbs about 730 fpm at sea level, full power (POH 730)", () => {
    const fpm = msToFpm(bestClimbRateMs(P, 0, 1));
    expect(fpm).toBeGreaterThan(630);
    expect(fpm).toBeLessThan(830);
  });
  it("still climbs, but barely, at the 14000 ft service ceiling", () => {
    const fpm = msToFpm(bestClimbRateMs(P, P.limits.serviceCeilingM, 1));
    expect(fpm).toBeGreaterThan(0);
    expect(fpm).toBeLessThan(300);
  });
  it("engine power lapses with density altitude", () => {
    expect(pistonPowerLapse(0)).toBeCloseTo(1, 6);
    expect(pistonPowerLapse(ftToM(8000))).toBeLessThan(0.85);
    expect(pistonPowerLapse(ftToM(8000))).toBeGreaterThan(0.65);
    expect(pistonPowerLapse(ftToM(14000))).toBeLessThan(pistonPowerLapse(ftToM(8000)));
  });
});

describe("C172S envelope — limits", () => {
  it("Vne is 163 KIAS", () => {
    expect(msToKt(P.limits.vneIasMs)).toBeCloseTo(163, 0);
  });
  it("g is clamped to +3.8 / -1.52", () => {
    expect(P.limits.gLimitPos).toBe(3.8);
    expect(P.limits.gLimitNeg).toBe(-1.52);
  });
  /*
   * Entry speed is 170 kt TAS (154 KIAS at 2000 m, still under Vne), not the 140 kt the
   * plan brief guessed. The elevator is a rate command capped at pitchRateMaxRadS = 20 deg/s,
   * so the load factor a pull can reach is bounded by n ~ 1 + V*q/g: 3.31 g at 140 kt, and
   * it only touches the +3.8 clamp from about 165 kt TAS up. That is the model being
   * consistent, not the clamp failing — so the case enters faster rather than the assertion
   * being softened. Measured values are in the Task 3 report.
   */
  it("a hard pull from a fast entry is clamped at +3.8 g and reports it", () => {
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1 };
    let s = levelState(2000, ktToMs(170), controls);
    let maxG = 0;
    let sawLimit = false;
    for (let i = 0; i < 600; i++) {
      s = stepAircraft(s, controls, P);
      maxG = Math.max(maxG, s.loadFactor);
      if (s.gLimited) sawLimit = true;
    }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeLessThanOrEqual(P.limits.gLimitPos + 1e-9);
    // Mirrors the negative case: the clamp is reached exactly, not merely never exceeded.
    expect(maxG).toBeCloseTo(P.limits.gLimitPos, 6);
  });
  it("a hard push is clamped at -1.52 g, and actually reaches it", () => {
    const controls: ControlVector = { pitch: -1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: -1 };
    let s = levelState(2000, ktToMs(140), controls);
    let minG = Number.POSITIVE_INFINITY;
    let sawNegLimit = false;
    for (let i = 0; i < 600; i++) {
      s = stepAircraft(s, controls, P);
      minG = Math.min(minG, s.loadFactor);
      if (s.gLimited && s.loadFactor < 0) sawNegLimit = true;
    }
    // Without this second assertion the clamp check passes even if the push never
    // produced negative g at all.
    expect(sawNegLimit).toBe(true);
    expect(minG).toBeGreaterThanOrEqual(P.limits.gLimitNeg - 1e-9);
    expect(minG).toBeCloseTo(P.limits.gLimitNeg, 6);
  });
  it("cannot exceed Vne in level flight at full power (Vne is a dive speed)", () => {
    expect(maxLevelSpeedMs(P, 0, 1)).toBeLessThan(P.limits.vneIasMs);
  });
  it("the aircraft never produces NaN across the whole envelope sweep", () => {
    const controls: ControlVector = { pitch: 0.6, roll: 0.6, yaw: 0.6, throttle: 1, flapDetent: 3, trim: 1 };
    let s = levelState(3000, ktToMs(90), controls);
    for (let i = 0; i < 3600; i++) s = stepAircraft(s, controls, P);
    expect(Number.isFinite(s.position.x)).toBe(true);
    expect(Number.isFinite(s.tasMs)).toBe(true);
    expect(Number.isFinite(s.loadFactor)).toBe(true);
  });
});
