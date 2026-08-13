/*
 * The Citation-class bizjet performance envelope. Like the 737 (b738-envelope.test.ts), the
 * bizjet is DATA driving the SAME 6-DOF force model (spec §5, CLAUDE.md iron rule) — a
 * flat-rated turbofan expressed through the shared power-limited-prop thrust formula with a
 * high propPeakSpeedMs and the turbofan density lapse, just scaled down with no afterburner.
 * These tests are the honesty check on that claim: they must prove the shared formula, tuned
 * only via the biz data file, produces a physically sane mid-size jet (cruise ~M0.78 at FL430,
 * a mid-jet stall band, a real service ceiling, g-clamp at +3.0).
 *
 * Speeds/climb are found by search over the real force balance and the real integrator, not by
 * hard-coding an expected answer. Helpers are copied from b738-envelope.test.ts (already
 * parametrised on `params`) — only the ones this file's tests actually call, so nothing sits
 * unused under the repo's no-unused-vars-as-error lint rule.
 */
import { describe, it, expect } from "vitest";
import { loadBiz } from "./params";
import { dragCoefficient, thrustNewtons } from "./forces";
import { isaDensity, machNumber } from "./isa";
import { stepAircraft, refreshDerived } from "./aircraft";
import { geodeticToEcef } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { degToRad, ftToM, ktToMs, msToFpm } from "./units";
import type { ClassParams, ControlVector, SimState } from "./types";

const P = loadBiz();
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
      verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false, machNumber: 0, gearPosition: 0,
    },
    controls,
    params,
  );
}

describe("BIZ envelope — cruise", () => {
  it("trims at cruise Mach ~0.78 at FL430", () => {
    const alt = ftToM(43000);
    const tas = maxLevelSpeedMs(P, alt, 0.85);
    const mach = machNumber(tas, alt);
    expect(mach).toBeGreaterThan(0.72);
    expect(mach).toBeLessThan(0.82);
  });
});

describe("BIZ envelope — limits", () => {
  it("clean stall speed sits in the mid-jet band (~110-130 kt) at sea level", () => {
    // Vstall = sqrt(2 W / (rho S CLmax)); CLmax = cl0 + clAlphaPerRad*stallAlphaRad (clean).
    const clMax = P.aero.cl0 + P.aero.clAlphaPerRad * P.aero.stallAlphaRad;
    const vStallMs = Math.sqrt((2 * P.massKg * G0) / (isaDensity(0) * P.wingAreaM2 * clMax));
    const vStallKt = vStallMs / ktToMs(1);
    expect(vStallKt).toBeGreaterThan(105);
    expect(vStallKt).toBeLessThan(135);
  });
  it("climbs strongly at sea level and barely at the service ceiling", () => {
    expect(msToFpm(bestClimbRateMs(P, 0, 1))).toBeGreaterThan(2500);
    const ceilFpm = msToFpm(bestClimbRateMs(P, P.limits.serviceCeilingM, 1));
    expect(ceilFpm).toBeGreaterThan(0);
    expect(ceilFpm).toBeLessThan(500);
  });
  it("g clamps at +3.0 and reaches it from a fast entry", () => {
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1, gearDown: false, afterburner: false };
    let s = levelState(P, ftToM(20000), ktToMs(320), controls);
    let maxG = 0, sawLimit = false;
    for (let i = 0; i < 600; i++) { s = stepAircraft(s, controls, P); maxG = Math.max(maxG, s.loadFactor); if (s.gLimited) sawLimit = true; }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeCloseTo(P.limits.gLimitPos, 6);
  });
  it("never produces NaN across a control sweep", () => {
    const controls: ControlVector = { pitch: 0.6, roll: 0.6, yaw: 0.6, throttle: 1, flapDetent: 3, trim: 1, gearDown: false, afterburner: false };
    let s = levelState(P, ftToM(30000), ktToMs(260), controls);
    for (let i = 0; i < 3600; i++) s = stepAircraft(s, controls, P);
    expect(Number.isFinite(s.tasMs)).toBe(true);
    expect(Number.isFinite(s.loadFactor)).toBe(true);
  });
});
