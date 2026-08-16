/*
 * The T-6 Texan II-class turboprop trainer performance envelope. Like tprop, this is DATA
 * driving the SAME 6-DOF force model (spec §5, CLAUDE.md iron rule) — a power-limited
 * propeller (T = eta*P/max(V,peak), the C172's formula) with a single flat-rated PT6 turbine
 * expressed through the shared `turboprop` density lapse. These tests are the honesty check on
 * that claim: they must prove the shared formula, tuned only via the t6 data file and the shared
 * turboprop lapse constants, produces a physically sane single-engine trainer (a strong ~3,100
 * fpm sea-level climb, a ~80 kt clean stall, and a real, barely-climbing 31,000 ft ceiling).
 *
 * Speeds/climb are found by search over the real force balance and the real integrator, not by
 * hard-coding an expected answer. The helpers mirror tprop-envelope.test.ts (parametrised on
 * `params`, no closure over a single class).
 */
import { describe, it, expect } from "vitest";
import { loadT6 } from "./params";
import { dragCoefficient, thrustNewtons } from "./forces";
import { isaDensity, iasToTas } from "./isa";
import { stepAircraft, refreshDerived } from "./aircraft";
import { geodeticToEcef } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { degToRad, ftToM, ktToMs, msToFpm } from "./units";
import type { ClassParams, ControlVector, SimState } from "./types";

const P = loadT6();
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
  let lo = 10;
  let best = -Infinity;
  for (let v = 10; v <= 300; v += 0.5) {
    const e = f(v);
    if (e > best) { best = e; lo = v; }
  }
  expect(best).toBeGreaterThan(0); // this power setting can hold level flight at all
  let hi = 300;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Best rate of climb at this altitude and power, m/s, by scanning the speed range. */
function bestClimbRateMs(params: ClassParams, altM: number, throttle: number): number {
  let best = -Infinity;
  for (let v = 15; v <= 280; v += 0.25) {
    const excess = levelFlightExcessThrustN(params, altM, throttle, 0, v);
    const climb = (excess * v) / (params.massKg * G0);
    if (climb > best) best = climb;
  }
  return best;
}

function levelState(params: ClassParams, altM: number, tasMs: number, controls: ControlVector): SimState {
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
      verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false, machNumber: 0, gearPosition: 0,
    },
    controls,
    params,
  );
}

/** Fly for `seconds` and report the altitude change and the mean TAS over the last third. */
function flyAndMeasure(
  params: ClassParams, start: SimState, controls: ControlVector, seconds: number,
): { dAltM: number; meanTasMs: number } {
  const steps = Math.round(seconds * 60);
  const tailFrom = Math.floor(steps * (2 / 3));
  let s = start;
  let tasSum = 0;
  let tasN = 0;
  for (let i = 0; i < steps; i++) {
    s = stepAircraft(s, controls, params);
    if (i >= tailFrom) { tasSum += s.tasMs; tasN++; }
  }
  return { dAltM: s.altitudeM - start.altitudeM, meanTasMs: tasSum / tasN };
}

/** Bisect on elevator trim until 120 s of flight ends at the altitude it started at. */
function trimForLevelFlight(
  params: ClassParams, altM: number, throttle: number, startTasMs: number,
): number {
  const run = (trim: number) => {
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle, flapDetent: 0, trim, gearDown: false, afterburner: false };
    return flyAndMeasure(params, levelState(params, altM, startTasMs, controls), controls, 120).dAltM;
  };
  let lo = -1;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

describe("T6 envelope — cruise", () => {
  it("trims near ~270-320 kt cruise TAS at FL200, 90% power", () => {
    const alt = ftToM(20000);
    const tas = maxLevelSpeedMs(P, alt, 0.9);
    const kt = tas / ktToMs(1);
    expect(kt).toBeGreaterThan(250);
    expect(kt).toBeLessThan(340);
  });
  it("the integrator agrees with the force balance: trimmed level flight holds cruise TAS", () => {
    const alt = ftToM(20000);
    const analytic = maxLevelSpeedMs(P, alt, 0.9);
    const trim = trimForLevelFlight(P, alt, 0.9, analytic);
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0.9, flapDetent: 0, trim, gearDown: false, afterburner: false };
    const flown = flyAndMeasure(P, levelState(P, alt, analytic, controls), controls, 180);
    expect(Math.abs(flown.dAltM)).toBeLessThan(300); // held altitude over 3 min
    const kt = flown.meanTasMs / ktToMs(1);
    expect(kt).toBeGreaterThan(240);
    expect(kt).toBeLessThan(340);
  });
});

describe("T6 envelope — limits", () => {
  it("clean stall speed sits in the trainer band (~70-90 kt) at sea level", () => {
    const clMax = P.aero.cl0 + P.aero.clAlphaPerRad * P.aero.stallAlphaRad;
    const vStallMs = Math.sqrt((2 * P.massKg * G0) / (isaDensity(0) * P.wingAreaM2 * clMax));
    const vStallKt = vStallMs / ktToMs(1);
    expect(vStallKt).toBeGreaterThan(70);
    expect(vStallKt).toBeLessThan(90);
  });
  it("climbs strongly at sea level and barely at the service ceiling", () => {
    expect(msToFpm(bestClimbRateMs(P, 0, 1))).toBeGreaterThan(2000);
    const ceilFpm = msToFpm(bestClimbRateMs(P, P.limits.serviceCeilingM, 1));
    expect(ceilFpm).toBeGreaterThan(0);
    expect(ceilFpm).toBeLessThan(500);
  });
  it("Vne is above cruise IAS, so a trimmed cruise does not overspeed", () => {
    const alt = ftToM(20000);
    const cruiseTas = maxLevelSpeedMs(P, alt, 0.9);
    expect(cruiseTas).toBeLessThan(iasToTas(P.limits.vneIasMs, alt));
  });
  it("g clamps at the class limit and reaches it from a fast entry", () => {
    // Sea level, 250 kt: qBar*S*CLmax must clear gLimitPos*W for the clamp to be reachable at
    // all (at altitude/lower speed the wing simply cannot generate 7 g of lift before stalling
    // out past CLmax, and the clamp is never touched) — see the c130-envelope.test.ts sibling
    // for the same reasoning at the heavy transport's lower g limit.
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1, gearDown: false, afterburner: false };
    let s = levelState(P, 0, ktToMs(250), controls);
    let maxG = 0, sawLimit = false;
    for (let i = 0; i < 600; i++) { s = stepAircraft(s, controls, P); maxG = Math.max(maxG, s.loadFactor); if (s.gLimited) sawLimit = true; }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeCloseTo(P.limits.gLimitPos, 6);
  });
  it("never produces NaN across a control sweep", () => {
    const controls: ControlVector = { pitch: 0.6, roll: 0.6, yaw: 0.6, throttle: 1, flapDetent: 2, trim: 1, gearDown: false, afterburner: false, speedbrake: false };
    let s = levelState(P, ftToM(15000), ktToMs(150), controls);
    for (let i = 0; i < 3600; i++) s = stepAircraft(s, controls, P);
    expect(Number.isFinite(s.tasMs)).toBe(true);
    expect(Number.isFinite(s.loadFactor)).toBe(true);
  });
});
