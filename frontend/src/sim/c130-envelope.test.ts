/*
 * The C-130 Hercules-class heavy turboprop performance envelope. Like tprop/t6, this is DATA
 * driving the SAME 6-DOF force model (spec §5, CLAUDE.md iron rule) — a power-limited propeller
 * (T = eta*P/max(V,peak), the C172's formula) whose 4x flat-rated turbines hold shaft power with
 * altitude via the shared `turboprop` density lapse. These tests are the honesty check on that
 * claim: they must prove the shared formula, tuned only via the c130 data file and the shared
 * turboprop lapse constants, produces a physically sane heavy four-engine transport (~300 kt
 * cruise TAS at FL220, a ~130-150 kt clean stall at heavy weight, and a real, barely-climbing
 * 33,000 ft ceiling).
 *
 * Speeds/climb are found by search over the real force balance and the real integrator, not by
 * hard-coding an expected answer. The helpers mirror tprop-envelope.test.ts (parametrised on
 * `params`, no closure over a single class).
 */
import { describe, it, expect } from "vitest";
import { loadC130 } from "./params";
import { dragCoefficient, thrustNewtons } from "./forces";
import { isaDensity, iasToTas } from "./isa";
import { stepAircraft, refreshDerived } from "./aircraft";
import { geodeticToEcef } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { degToRad, ftToM, ktToMs, msToFpm } from "./units";
import type { ClassParams, ControlVector, SimState } from "./types";

const P = loadC130();
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

describe("C130 envelope — cruise", () => {
  it("trims near ~280-320 kt cruise TAS at FL220, 85% power", () => {
    const alt = ftToM(22000);
    const tas = maxLevelSpeedMs(P, alt, 0.85);
    const kt = tas / ktToMs(1);
    expect(kt).toBeGreaterThan(260);
    expect(kt).toBeLessThan(340);
  });
  it("the integrator agrees with the force balance: trimmed level flight holds cruise TAS", () => {
    const alt = ftToM(22000);
    const analytic = maxLevelSpeedMs(P, alt, 0.85);
    const trim = trimForLevelFlight(P, alt, 0.85, analytic);
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0.85, flapDetent: 0, trim, gearDown: false, afterburner: false };
    const flown = flyAndMeasure(P, levelState(P, alt, analytic, controls), controls, 180);
    expect(Math.abs(flown.dAltM)).toBeLessThan(300); // held altitude over 3 min
    const kt = flown.meanTasMs / ktToMs(1);
    expect(kt).toBeGreaterThan(250);
    expect(kt).toBeLessThan(340);
  });
});

describe("C130 envelope — limits", () => {
  it("clean stall speed sits in the heavy-transport band (~125-155 kt) at heavy weight, sea level", () => {
    const clMax = P.aero.cl0 + P.aero.clAlphaPerRad * P.aero.stallAlphaRad;
    const vStallMs = Math.sqrt((2 * P.massKg * G0) / (isaDensity(0) * P.wingAreaM2 * clMax));
    const vStallKt = vStallMs / ktToMs(1);
    expect(vStallKt).toBeGreaterThan(125);
    expect(vStallKt).toBeLessThan(155);
  });
  it("climbs at sea level and barely at the service ceiling", () => {
    expect(msToFpm(bestClimbRateMs(P, 0, 1))).toBeGreaterThan(500);
    const ceilFpm = msToFpm(bestClimbRateMs(P, P.limits.serviceCeilingM, 1));
    expect(ceilFpm).toBeGreaterThan(0);
    expect(ceilFpm).toBeLessThan(500);
  });
  it("Vne is above cruise IAS, so a trimmed cruise does not overspeed", () => {
    const alt = ftToM(22000);
    const cruiseTas = maxLevelSpeedMs(P, alt, 0.85);
    expect(cruiseTas).toBeLessThan(iasToTas(P.limits.vneIasMs, alt));
  });
  it("g clamps at the class limit and reaches it from a fast entry", () => {
    // Sea level, 240 kt: qBar*S*CLmax must clear gLimitPos*W for the clamp to be reachable at
    // all — a low-g-limit heavy transport at altitude/lower speed simply cannot generate 2.5 g
    // of lift before stalling out past CLmax, and the clamp is never touched.
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1, gearDown: false, afterburner: false };
    let s = levelState(P, 0, ktToMs(240), controls);
    let maxG = 0, sawLimit = false;
    for (let i = 0; i < 600; i++) { s = stepAircraft(s, controls, P); maxG = Math.max(maxG, s.loadFactor); if (s.gLimited) sawLimit = true; }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeCloseTo(P.limits.gLimitPos, 6);
  });
  it("never produces NaN across a control sweep", () => {
    const controls: ControlVector = { pitch: 0.6, roll: 0.6, yaw: 0.6, throttle: 1, flapDetent: 2, trim: 1, gearDown: false, afterburner: false, speedbrake: false };
    let s = levelState(P, ftToM(15000), ktToMs(180), controls);
    for (let i = 0; i < 3600; i++) s = stepAircraft(s, controls, P);
    expect(Number.isFinite(s.tasMs)).toBe(true);
    expect(Number.isFinite(s.loadFactor)).toBe(true);
  });
});
