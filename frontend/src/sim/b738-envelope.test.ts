/*
 * The 737-800 performance envelope. The 737 is DATA driving the SAME 6-DOF force model as
 * the C172 (spec §5, CLAUDE.md iron rule) — a flat-rated turbofan expressed through the shared
 * power-limited-prop thrust formula with a high propPeakSpeedMs and the turbofan density lapse.
 * These tests are the honesty check on that claim: they must prove the shared formula, tuned
 * only via the b738 data file and the shared turbofan lapse constants, produces a physically
 * sane airliner (cruise ~M0.78 at FL350, Vmo/Mmo swap, g-clamp at +2.5/-1.0, a real ceiling).
 *
 * Speeds/climb are found by search over the real force balance and the real integrator, not by
 * hard-coding an expected answer, so the test proves the model produces the number. The helpers
 * mirror envelope.test.ts but are parametrised on `params` (no closure over a single class) and
 * scan the higher jet speed band.
 */
import { describe, it, expect } from "vitest";
import { loadB738 } from "./params";
import { dragCoefficient, thrustNewtons } from "./forces";
import { isaDensity, machNumber, iasToTas } from "./isa";
import { stepAircraft, refreshDerived } from "./aircraft";
import { geodeticToEcef } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { degToRad, ftToM, ktToMs, msToFpm } from "./units";
import type { ClassParams, ControlVector, SimState } from "./types";

const P = loadB738();
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
  // Scan for the speed of maximum excess thrust, then bisect upward from there. The jet band
  // is far faster than the C172's, so the scan/bisection cover up to 400 m/s.
  let lo = 10;
  let best = -Infinity;
  for (let v = 10; v <= 400; v += 0.5) {
    const e = f(v);
    if (e > best) { best = e; lo = v; }
  }
  expect(best).toBeGreaterThan(0); // this power setting can hold level flight at all
  let hi = 400;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Best rate of climb at this altitude and power, m/s, by scanning the (jet) speed range. */
function bestClimbRateMs(params: ClassParams, altM: number, throttle: number): number {
  let best = -Infinity;
  for (let v = 30; v <= 380; v += 0.25) {
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
      verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false, machNumber: 0,
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
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle, flapDetent: 0, trim, afterburner: false };
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

describe("B738 envelope — cruise", () => {
  it("trims at cruise Mach ~0.78 at FL350", () => {
    const alt = ftToM(35000);
    // The fastest level speed a cruise power setting (85%) can hold, then confirm the Mach.
    const tas = maxLevelSpeedMs(P, alt, 0.85);
    const mach = machNumber(tas, alt);
    expect(mach).toBeGreaterThan(0.72);
    expect(mach).toBeLessThan(0.82);
  });
  it("the integrator agrees with the force balance: trimmed level flight settles at cruise Mach", () => {
    const alt = ftToM(35000);
    const analytic = maxLevelSpeedMs(P, alt, 0.85);
    const trim = trimForLevelFlight(P, alt, 0.85, analytic);
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0.85, flapDetent: 0, trim, afterburner: false };
    const flown = flyAndMeasure(P, levelState(P, alt, analytic, controls), controls, 180);
    expect(Math.abs(flown.dAltM)).toBeLessThan(300); // held altitude over 3 min
    const mach = machNumber(flown.meanTasMs, alt);
    expect(mach).toBeGreaterThan(0.72);
    expect(mach).toBeLessThan(0.82);
  });
});

describe("B738 envelope — limits", () => {
  it("Vmo bites low and Mmo bites high (the binding limit swaps with altitude)", () => {
    // At sea level Vmo (IAS) is the constraint; at FL350 the same IAS is a higher Mach, so Mmo binds.
    const machAtVmoLow = machNumber(iasToTas(P.limits.vneIasMs, 0), 0);
    const machAtVmoHigh = machNumber(iasToTas(P.limits.vneIasMs, ftToM(35000)), ftToM(35000));
    expect(machAtVmoLow).toBeLessThan(P.limits.mmo); // Vmo is the low-altitude limit
    expect(machAtVmoHigh).toBeGreaterThan(P.limits.mmo); // Mmo is the high-altitude limit
  });
  it("g clamps at +2.5 and actually reaches it", () => {
    // Same broken-arm structure as envelope.test.ts: prove the clamp is hit, not merely never
    // exceeded. Entry is 400 kt TAS at FL200 (292 KIAS, well under Vmo 340): the heavy jet's low
    // pitch rate (10 deg/s) and 66 t bleed speed fast in the pull, so — as the C172 test documents
    // for its own case — the +2.5 clamp only bites from a fast enough entry. At 320 kt the pull
    // tops out at 2.49 g without quite reaching the clamp; 400 kt reaches it cleanly.
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1, afterburner: false };
    let s = levelState(P, ftToM(20000), ktToMs(400), controls);
    let maxG = 0;
    let sawLimit = false;
    for (let i = 0; i < 600; i++) {
      s = stepAircraft(s, controls, P);
      maxG = Math.max(maxG, s.loadFactor);
      if (s.gLimited) sawLimit = true;
    }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeLessThanOrEqual(P.limits.gLimitPos + 1e-9);
    expect(maxG).toBeCloseTo(P.limits.gLimitPos, 6);
  });
  it("g clamps at -1.0 and actually reaches it", () => {
    const controls: ControlVector = { pitch: -1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: -1, afterburner: false };
    let s = levelState(P, ftToM(20000), ktToMs(320), controls);
    let minG = Number.POSITIVE_INFINITY;
    let sawNegLimit = false;
    for (let i = 0; i < 600; i++) {
      s = stepAircraft(s, controls, P);
      minG = Math.min(minG, s.loadFactor);
      if (s.gLimited && s.loadFactor < 0) sawNegLimit = true;
    }
    expect(sawNegLimit).toBe(true);
    expect(minG).toBeGreaterThanOrEqual(P.limits.gLimitNeg - 1e-9);
    expect(minG).toBeCloseTo(P.limits.gLimitNeg, 6);
  });
  it("still climbs, but barely, at the service ceiling", () => {
    const fpm = msToFpm(bestClimbRateMs(P, P.limits.serviceCeilingM, 1));
    expect(fpm).toBeGreaterThan(0);
    expect(fpm).toBeLessThan(500);
  });
  it("never produces NaN across a control sweep", () => {
    const controls: ControlVector = { pitch: 0.6, roll: 0.6, yaw: 0.6, throttle: 1, flapDetent: 4, trim: 1, afterburner: false };
    let s = levelState(P, ftToM(30000), ktToMs(280), controls);
    for (let i = 0; i < 3600; i++) s = stepAircraft(s, controls, P);
    expect(Number.isFinite(s.tasMs)).toBe(true);
    expect(Number.isFinite(s.loadFactor)).toBe(true);
  });
});
