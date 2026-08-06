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
import type { ClassParams, ControlVector, FlapDetent, SimState, Vec3 } from "./types";
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
 * Power-limited propeller thrust with a linear efficiency ramp below the prop's peak
 * speed. `eta(V) * P / V` with `eta(V) = etaMax * min(1, V/Vpeak)` collapses to
 * `etaMax * P / max(V, Vpeak)` — which is finite at V = 0, so static thrust needs no
 * separate cap, and which gives a top-speed asymptote a constant-thrust model cannot.
 */
export function thrustNewtons(params: ClassParams, throttle: number, tasMs: number): number {
  const { maxPowerW, propEfficiency, propPeakSpeedMs } = params.propulsion;
  const clamped = Math.min(1, Math.max(0, throttle));
  return (clamped * propEfficiency * maxPowerW) / Math.max(tasMs, propPeakSpeedMs);
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
  // failure this phase, parent spec §4): scale lift so n stays inside the cert envelope.
  const weight = params.massKg * G0;
  const nUnclamped = (lift * Math.cos(aoaRad) + drag * Math.sin(aoaRad)) / weight;
  let gLimited = false;
  let loadFactor = nUnclamped;
  if (nUnclamped > params.limits.gLimitPos) {
    lift *= params.limits.gLimitPos / nUnclamped;
    loadFactor = params.limits.gLimitPos;
    gLimited = true;
  } else if (nUnclamped < params.limits.gLimitNeg) {
    lift *= params.limits.gLimitNeg / nUnclamped;
    loadFactor = params.limits.gLimitNeg;
    gLimited = true;
  }

  // Wind axes -> body axes (rotate by AoA about the body Y axis).
  const forceBody: Vec3 = {
    x: -drag * Math.cos(aoaRad) + lift * Math.sin(aoaRad) + thrustNewtons(params, controls.throttle, tasMs),
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
