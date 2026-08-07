import { describe, it, expect } from "vitest";
import {
  liftCoefficient, dragCoefficient, clMaxFor, stallAlphaFor, stallSpeedIasMs,
  thrustNewtons, controlAuthority, computeForces, turbofanPowerLapse, POWER_LAPSE_MODELS,
} from "./forces";
import type { ForceResult } from "./forces";
import { loadC172 } from "./params";
import { degToRad, ftToM } from "./units";
import { quatFromHpr, qRotate, qRotateInverse } from "./quat";
import { geodeticToEcef, geodeticSurfaceNormal } from "./geo";
import { vScale, vSub } from "./vec3";
import type { ClassParams, SimState, ControlVector, Vec3 } from "./types";

const P = loadC172();
const CLEAN = P.flaps[0];
const FULL = P.flaps[3];

const CONTROLS: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0.75, flapDetent: 0, trim: 0, afterburner: false };

/** Velocity vector for a flight path `fpaDeg` above the horizon, tracking north. */
function velocityAlong(positionEcef: Vec3, tasMs: number, fpaDeg: number): Vec3 {
  return qRotate(quatFromHpr(positionEcef, 0, degToRad(fpaDeg), 0), { x: tasMs, y: 0, z: 0 });
}

/**
 * A state with a REAL velocity vector: body pitched `pitchDeg`, flight path at `fpaDeg`,
 * so the angle of attack is `pitchDeg - fpaDeg`. This matters more than it looks — a state
 * with zero velocity makes every aerodynamic force zero, which would let force assertions
 * pass without the force model doing anything at all.
 */
function stateAt(altM: number, tasMs: number, pitchDeg = 0, fpaDeg = pitchDeg): SimState {
  const position = geodeticToEcef(degToRad(30.6944), degToRad(-88.0399), altM);
  return {
    position,
    velocity: velocityAlong(position, tasMs, fpaDeg),
    attitude: quatFromHpr(position, 0, degToRad(pitchDeg), 0),
    rates: { x: 0, y: 0, z: 0 },
    timeS: 0,
    altitudeM: altM,
    tasMs, iasMs: 0, aoaRad: 0, sideslipRad: 0, verticalSpeedMs: 0,
    loadFactor: 1, gLimited: false, stalled: false, machNumber: 0,
  };
}

const G0 = 9.80665;

/**
 * The load factor the RETURNED FORCE actually implies — strip gravity off the total ECEF
 * force, rotate what is left back into the body frame, and take the "up" (-body-z)
 * component over the weight.
 *
 * This exists because `result.loadFactor` is a value computeForces ASSIGNS during the g
 * clamp, so asserting on it alone is circular: it would read 3.8 even if the clamp scaled
 * lift by the wrong factor, or forgot to scale it at all. This measures the output.
 */
function loadFactorFromOutput(state: SimState, r: ForceResult): number {
  const weight = P.massKg * G0;
  const gravityEcef = vScale(geodeticSurfaceNormal(state.position), -weight);
  const aeroBody = qRotateInverse(state.attitude, vSub(r.forceEcef, gravityEcef));
  return -aeroBody.z / weight;
}

describe("liftCoefficient", () => {
  it("is exactly linear below the stall", () => {
    expect(liftCoefficient(degToRad(5), P, CLEAN)).toBeCloseTo(
      P.aero.cl0 + P.aero.clAlphaPerRad * degToRad(5), 12);
  });
  it("peaks at exactly CLmax at the break", () => {
    expect(liftCoefficient(stallAlphaFor(P, CLEAN), P, CLEAN)).toBeCloseTo(clMaxFor(P, CLEAN), 12);
  });
  it("rolls off softly past the break rather than falling off a cliff", () => {
    const peak = clMaxFor(P, CLEAN);
    const past = liftCoefficient(stallAlphaFor(P, CLEAN) + degToRad(6), P, CLEAN);
    expect(past).toBeLessThan(peak);
    expect(past).toBeGreaterThan(0.55 * peak); // soft, mushy — still flying, badly
  });
  it("keeps falling deeper into the stall", () => {
    const a = liftCoefficient(stallAlphaFor(P, CLEAN) + degToRad(6), P, CLEAN);
    const b = liftCoefficient(stallAlphaFor(P, CLEAN) + degToRad(20), P, CLEAN);
    expect(b).toBeLessThan(a);
  });
  it("is antisymmetric-ish about zero-lift AoA (negative AoA gives negative lift)", () => {
    expect(liftCoefficient(degToRad(-10), P, CLEAN)).toBeLessThan(0);
  });
  it("flaps raise CLmax and lower the stall AoA", () => {
    expect(clMaxFor(P, FULL)).toBeGreaterThan(clMaxFor(P, CLEAN));
    expect(stallAlphaFor(P, FULL)).toBeLessThan(stallAlphaFor(P, CLEAN));
  });
});

describe("dragCoefficient", () => {
  it("is a parabolic polar: CD = CD0 + CL^2/(pi e AR)", () => {
    const cl = 0.6;
    const expected = P.aero.cd0 + (cl * cl) / (Math.PI * P.aero.oswaldE * P.aspectRatio);
    expect(dragCoefficient(cl, P, CLEAN)).toBeCloseTo(expected, 12);
  });
  it("flaps add parasite drag as well as lift", () => {
    expect(dragCoefficient(0.6, P, FULL)).toBeGreaterThan(dragCoefficient(0.6, P, CLEAN));
  });
  it("is minimum at zero lift", () => {
    expect(dragCoefficient(0, P, CLEAN)).toBeCloseTo(P.aero.cd0, 12);
  });
});

describe("thrustNewtons", () => {
  it("is power-limited above the prop peak speed: T = eta*P/V", () => {
    const v = 70;
    expect(thrustNewtons(P, 1, v, 0)).toBeCloseTo((P.propulsion.propEfficiency * P.propulsion.maxPowerW) / v, 6);
  });
  it("does not run away as V -> 0 (static thrust is finite)", () => {
    const t0 = thrustNewtons(P, 1, 0, 0);
    expect(Number.isFinite(t0)).toBe(true);
    expect(t0).toBeCloseTo(
      (P.propulsion.propEfficiency * P.propulsion.maxPowerW) / P.propulsion.propPeakSpeedMs, 6);
  });
  it("scales linearly with throttle and is zero at idle", () => {
    expect(thrustNewtons(P, 0.5, 70, 0)).toBeCloseTo(thrustNewtons(P, 1, 70, 0) / 2, 9);
    expect(thrustNewtons(P, 0, 70, 0)).toBe(0);
  });
  it("falls with speed above the peak (a top-speed asymptote exists)", () => {
    expect(thrustNewtons(P, 1, 90, 0)).toBeLessThan(thrustNewtons(P, 1, 70, 0));
  });
  it("lapses with density altitude", () => {
    expect(thrustNewtons(P, 1, 70, 3000)).toBeLessThan(thrustNewtons(P, 1, 70, 0));
  });
  // The lapse is chosen by propulsion.lapseModel, not assumed: a flat-rated powerplant must
  // be expressible in data alone, without a per-class branch in this file.
  it("takes no density lapse when the class declares a flat-rated powerplant", () => {
    const flatRated: ClassParams = { ...P, propulsion: { ...P.propulsion, lapseModel: "none" } };
    expect(thrustNewtons(flatRated, 1, 70, 3000)).toBeCloseTo(thrustNewtons(flatRated, 1, 70, 0), 9);
    expect(thrustNewtons(flatRated, 1, 70, 3000)).toBeGreaterThan(thrustNewtons(P, 1, 70, 3000));
  });
});

describe("controlAuthority", () => {
  it("is full at and above the reference dynamic pressure", () => {
    expect(controlAuthority(P.control.refDynamicPressurePa, P)).toBeCloseTo(1, 9);
    expect(controlAuthority(5000, P)).toBe(1);
  });
  it("goes mushy at low q", () => {
    expect(controlAuthority(300, P)).toBeCloseTo(0.25, 6);
    expect(controlAuthority(0, P)).toBe(0);
  });
});

describe("stallSpeedIasMs", () => {
  it("is lower with flaps down", () => {
    expect(stallSpeedIasMs(P, 3)).toBeLessThan(stallSpeedIasMs(P, 0));
  });
});

describe("computeForces", () => {
  it("returns a finite force with zero airspeed instead of NaN", () => {
    const r = computeForces(stateAt(1000, 0), CONTROLS, P);
    expect(Number.isFinite(r.forceEcef.x)).toBe(true);
    expect(Number.isFinite(r.aoaRad)).toBe(true);
    expect(r.tasMs).toBe(0);
  });
  it("does NOT clamp in ordinary flight — the clamp must not be always-on", () => {
    // 50 m/s, wings level, zero AoA: nowhere near the envelope.
    const s = stateAt(1000, 50, 0, 0);
    const r = computeForces(s, CONTROLS, P);
    expect(r.gLimited).toBe(false);
    expect(r.loadFactor).toBeLessThan(P.limits.gLimitPos);
    // The reported load factor is the one the returned force actually carries.
    expect(loadFactorFromOutput(s, r)).toBeCloseTo(r.loadFactor, 9);
  });
  it("clamps a hard pull at +3.8 g and says it clamped", () => {
    // 90 m/s (175 kt) with the nose 6° above a level flight path = 6° AoA. Unclamped that
    // is about 6 g for this airframe, so the clamp MUST engage.
    const s = stateAt(1000, 90, 6, 0);
    const r = computeForces(s, CONTROLS, P);
    expect(r.gLimited).toBe(true);
    // Measured from the OUTPUT force, so a clamp that scaled lift by the wrong factor
    // fails here even though it would still have reported loadFactor = 3.8.
    expect(loadFactorFromOutput(s, r)).toBeCloseTo(P.limits.gLimitPos, 6);
    expect(r.loadFactor).toBeCloseTo(P.limits.gLimitPos, 6);
  });
  it("clamps a hard push at -1.52 g and says it clamped", () => {
    // Same speed, nose 8° BELOW a level flight path: strongly negative lift.
    const s = stateAt(1000, 90, -8, 0);
    const r = computeForces(s, CONTROLS, P);
    expect(r.gLimited).toBe(true);
    expect(loadFactorFromOutput(s, r)).toBeCloseTo(P.limits.gLimitNeg, 6);
    expect(r.loadFactor).toBeCloseTo(P.limits.gLimitNeg, 6);
  });
});

describe("turbofan power lapse", () => {
  it("holds rated thrust (1.0) at and below the flat-rated corner altitude", () => {
    expect(turbofanPowerLapse(0)).toBeCloseTo(1, 6);
    expect(turbofanPowerLapse(ftToM(30000))).toBeCloseTo(1, 6);
  });
  it("falls below 1 above the corner and is monotone decreasing there", () => {
    const a = turbofanPowerLapse(ftToM(37000));
    const b = turbofanPowerLapse(ftToM(41000));
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
  });
  it("is registered under the turbofan lapse key", () => {
    expect(POWER_LAPSE_MODELS.turbofan(0)).toBeCloseTo(1, 6);
  });
});

describe("afterburner thrust", () => {
  it("scales dry thrust by afterburnerFactor when wet", () => {
    const p = loadC172(); // afterburnerFactor 1.0 → wet == dry for the C172
    const dry = thrustNewtons(p, 1, 100, 0, false);
    const wet = thrustNewtons(p, 1, 100, 0, true);
    expect(wet).toBeCloseTo(dry * p.propulsion.afterburnerFactor, 6);
  });
  it("multiplies by a real factor when one is present", () => {
    const p = loadC172();
    const jet = { ...p, propulsion: { ...p.propulsion, afterburnerFactor: 1.5 } };
    expect(thrustNewtons(jet, 1, 100, 0, true)).toBeCloseTo(thrustNewtons(jet, 1, 100, 0, false) * 1.5, 6);
  });
  it("defaults to dry when the flag is omitted", () => {
    const p = loadC172();
    expect(thrustNewtons(p, 1, 100, 0)).toBeCloseTo(thrustNewtons(p, 1, 100, 0, false), 6);
  });
});
