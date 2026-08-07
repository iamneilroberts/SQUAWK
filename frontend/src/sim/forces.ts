/*
 * One 6-DOF force/moment model, parameterized entirely by ClassParams — no per-class
 * branches (spec §5, CLAUDE.md). Parent spec §4 is the shape:
 *
 *   lift   = 0.5 * rho * V^2 * S * CL(alpha), CL blending to a flat plate past the stall
 *   drag   = 0.5 * rho * V^2 * S * (CD0(flap) + CL^2/(pi e AR))
 *   thrust = power-limited, T = eta(V) * P / V along the body X axis
 *   gravity= m * g0 along -geodeticSurfaceNormal (NOT radial)
 *   moments= commanded body rate * control authority(q) - per-axis rate damping,
 *            plus static pitch stiffness toward the trimmed AoA and weathercock in yaw
 *
 * Angular dynamics are a rate-command-with-lag form rather than explicit coefficient
 * moments: the research doc gives us max roll rate but no Cl_p / Cl_delta, so writing
 * derivative coefficients would mean inventing numbers and calling them physics. The
 * response constants are named, documented tuning knobs instead. Decisions.md B-007.
 */
import type { ClassParams, ControlVector, FlapDetent, LapseModel, SimState, Vec3 } from "./types";
import { isaDensity, RHO_SL, tasToIas } from "./isa";
import { geodeticSurfaceNormal } from "./geo";
import { qRotate, qRotateInverse } from "./quat";
import { vAdd, vLength, vScale } from "./vec3";

const G0 = 9.80665;

export type ForceResult = {
  /** Total external force on the aircraft, ECEF newtons. */
  forceEcef: Vec3;
  /** Body angular acceleration, rad/s^2. */
  ratesDotBody: Vec3;
  aoaRad: number;
  sideslipRad: number;
  tasMs: number;
  iasMs: number;
  loadFactor: number;
  gLimited: boolean;
  stalled: boolean;
};

export function stallAlphaFor(params: ClassParams, flap: FlapDetent): number {
  return params.aero.stallAlphaRad + flap.dStallAlphaRad;
}

/** CLmax is analytic and exact: the linear curve evaluated at the break. */
export function clMaxFor(params: ClassParams, flap: FlapDetent): number {
  return params.aero.cl0 + flap.dCL0 + params.aero.clAlphaPerRad * stallAlphaFor(params, flap);
}

/**
 * Linear lift curve up to the break, then an exponential fade from CLmax toward flat-plate
 * lift over `postStallDecayRad` — soft and mushy (the 172's signature) rather than a CL
 * cliff. Continuous at the break by construction, and CLmax is exactly the linear value,
 * so `stallSpeedIasMs` and the book V-speeds stay in agreement with what the wing actually
 * does. (A double-sigmoid blend was considered and rejected: it caps the achievable CL
 * well below the stated CLmax, which would have made the stall-speed readout a lie.)
 */
export function liftCoefficient(alphaRad: number, params: ClassParams, flap: FlapDetent): number {
  const alphaStall = stallAlphaFor(params, flap);
  const cl0 = params.aero.cl0 + flap.dCL0;
  if (Math.abs(alphaRad) <= alphaStall) {
    return cl0 + params.aero.clAlphaPerRad * alphaRad;
  }
  const sign = Math.sign(alphaRad);
  const clPeak = cl0 + params.aero.clAlphaPerRad * alphaStall * sign;
  const over = Math.abs(alphaRad) - alphaStall;
  const w = Math.exp(-over / params.aero.postStallDecayRad);
  const clPlate = 2 * sign * Math.sin(alphaRad) ** 2 * Math.cos(alphaRad);
  return w * clPeak + (1 - w) * clPlate;
}

export function dragCoefficient(cl: number, params: ClassParams, flap: FlapDetent): number {
  const induced = (cl * cl) / (Math.PI * params.aero.oswaldE * params.aspectRatio);
  return params.aero.cd0 + flap.dCD0 + induced;
}

/** Wings-level 1 g stall speed as indicated airspeed, for the given flap detent. */
export function stallSpeedIasMs(params: ClassParams, flapIndex: number): number {
  const flap = params.flaps[flapIndex] ?? params.flaps[0];
  const clMax = clMaxFor(params, flap);
  return Math.sqrt((2 * params.massKg * G0) / (RHO_SL * params.wingAreaM2 * clMax));
}

/**
 * Normally-aspirated piston power lapse with density altitude (Gagg-Ferrar):
 *   P(h)/P(0) = (sigma - 0.117) / 0.883,  sigma = rho(h)/rho(0)
 * Without this a C172 climbs at 970 fpm at its published service ceiling — the ceiling
 * only exists because the engine loses power with air density, not because drag rises.
 */
export function pistonPowerLapse(altitudeM: number): number {
  const sigma = isaDensity(altitudeM) / RHO_SL;
  return Math.max(0, (sigma - 0.117) / 0.883);
}

/**
 * Which lapse a powerplant obeys is DATA (`propulsion.lapseModel`), not a class branch:
 * the piston lapse above is a C172 fact, and applying it to a flat-rated turbofan would be
 * an invisible piston assumption baked into a supposedly class-agnostic core. A jet class
 * ships `"none"` and holds its rated output over the band this sim flies. `params.ts`
 * rejects any value not keyed here at load time rather than silently defaulting — a typo in
 * a parameter file must not quietly turn an engine into a different engine.
 */
export const POWER_LAPSE_MODELS: Record<LapseModel, (altitudeM: number) => number> = {
  piston: pistonPowerLapse,
  none: () => 1,
  turbofan: () => 1,
};

/**
 * Power-limited propeller thrust with a linear efficiency ramp below the prop's peak
 * speed. `eta(V) * P / V` with `eta(V) = etaMax * min(1, V/Vpeak)` collapses to
 * `etaMax * P / max(V, Vpeak)` — which is finite at V = 0, so static thrust needs no
 * separate cap, and which gives a top-speed asymptote a constant-thrust model cannot.
 */
export function thrustNewtons(
  params: ClassParams,
  throttle: number,
  tasMs: number,
  altitudeM: number,
): number {
  const { maxPowerW, propEfficiency, propPeakSpeedMs, lapseModel } = params.propulsion;
  const clamped = Math.min(1, Math.max(0, throttle));
  const shaftPowerW = clamped * maxPowerW * POWER_LAPSE_MODELS[lapseModel](altitudeM);
  return (propEfficiency * shaftPowerW) / Math.max(tasMs, propPeakSpeedMs);
}

/** Control effectiveness scales with dynamic pressure and saturates at 1. */
export function controlAuthority(qBarPa: number, params: ClassParams): number {
  return Math.min(1, Math.max(0, qBarPa / params.control.refDynamicPressurePa));
}

export function computeForces(
  state: SimState,
  controls: ControlVector,
  params: ClassParams,
): ForceResult {
  const flap = params.flaps[controls.flapDetent] ?? params.flaps[0];
  const rho = isaDensity(state.altitudeM);

  // Still air: the ECEF velocity IS the airspeed vector (parent spec §4, v1 scope).
  const vBody = qRotateInverse(state.attitude, state.velocity);
  const tasMs = vLength(vBody);
  const iasMs = tasToIas(tasMs, state.altitudeM);
  const aoaRad = tasMs > 0.1 ? Math.atan2(vBody.z, vBody.x) : 0;
  const sideslipRad = tasMs > 0.1 ? Math.asin(Math.min(1, Math.max(-1, vBody.y / tasMs))) : 0;

  const qBar = 0.5 * rho * tasMs * tasMs;
  const cl = liftCoefficient(aoaRad, params, flap);
  const cd = dragCoefficient(cl, params, flap);

  let lift = qBar * params.wingAreaM2 * cl;
  const drag = qBar * params.wingAreaM2 * cd;
  const side = qBar * params.wingAreaM2 * params.aero.cyBeta * sideslipRad;

  // Load factor is the specific force along -body-z. Clamp + warn only (no structural
  // failure this phase, parent spec §4): reduce lift so n stays inside the cert envelope.
  //
  // We SOLVE for the lift that puts the total normal force exactly on the limit rather than
  // scaling lift by limit/n. Drag's share of the normal force (drag*sin(alpha)) is not ours
  // to scale — you cannot wish drag away by pulling less — so a multiplicative scale leaves
  // the clamp leaky: it reported 3.80 g while the force it actually returned carried 3.82,
  // and -1.52 against a real -1.55. `loadFactor` is then recomputed from the forces that
  // actually leave this function, so the HUD's G readout can never drift from them.
  const weight = params.massKg * G0;
  const cosAlpha = Math.cos(aoaRad);
  const dragNormal = drag * Math.sin(aoaRad);
  const nUnclamped = (lift * cosAlpha + dragNormal) / weight;
  const limit =
    nUnclamped > params.limits.gLimitPos ? params.limits.gLimitPos
    : nUnclamped < params.limits.gLimitNeg ? params.limits.gLimitNeg
    : null;
  const gLimited = limit !== null;
  if (limit !== null) {
    // Near alpha = +-90 deg the wing contributes almost nothing to the normal force and the
    // solve is ill-conditioned, so there we just kill the lift term and report whatever drag
    // alone carries. The aircraft is tumbling far outside this model's validity by then.
    lift = Math.abs(cosAlpha) < 1e-3 ? 0 : (limit * weight - dragNormal) / cosAlpha;
  }
  const loadFactor = (lift * cosAlpha + dragNormal) / weight;

  // Wind axes -> body axes (rotate by AoA about the body Y axis).
  const forceBody: Vec3 = {
    x: -drag * Math.cos(aoaRad) + lift * Math.sin(aoaRad) +
       thrustNewtons(params, controls.throttle, tasMs, state.altitudeM),
    y: side,
    z: -drag * Math.sin(aoaRad) - lift * Math.cos(aoaRad),
  };

  const gravityEcef = vScale(geodeticSurfaceNormal(state.position), -weight);
  const forceEcef = vAdd(qRotate(state.attitude, forceBody), gravityEcef);

  // ---- moments as rate command + damping ----
  const authority = controlAuthority(qBar, params);
  const c = params.control;
  const alphaTrim = c.trimAlphaCenterRad + controls.trim * c.trimAlphaRangeRad;
  const pCmd = controls.roll * c.rollRateMaxRadS * authority;
  const qCmd = controls.pitch * c.pitchRateMaxRadS * authority;
  const rCmd = controls.yaw * c.yawRateMaxRadS * authority;

  const ratesDotBody: Vec3 = {
    x: (pCmd - state.rates.x) * c.rollDampingPerS,
    y:
      (qCmd - state.rates.y) * c.pitchDampingPerS +
      c.pitchStiffnessPerS2 * (alphaTrim - aoaRad) * authority,
    z:
      (rCmd - state.rates.z) * c.yawDampingPerS +
      c.yawStiffnessPerS2 * sideslipRad * authority,
  };

  return {
    forceEcef,
    ratesDotBody,
    aoaRad,
    sideslipRad,
    tasMs,
    iasMs,
    loadFactor,
    gLimited,
    stalled: Math.abs(aoaRad) > stallAlphaFor(params, flap),
  };
}
