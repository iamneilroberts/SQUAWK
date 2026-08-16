/*
 * One physics step. Semi-implicit (symplectic) Euler: integrate the derivatives first,
 * then advance position/attitude with the NEW velocity/rates.
 *
 * Why semi-implicit Euler and not RK2/RK4: at dt = 1/60 s the fastest mode in this model is
 * the pitch short period (omega_n ~ 1.7 rad/s, zeta 0.7) — three orders of magnitude below
 * the sample rate — so accuracy is not the constraint. Semi-implicit Euler is one force
 * evaluation per step (RK2 is two, and would double the terrain-sample and force cost for
 * no visible difference), it does not pump energy into oscillatory modes the way explicit
 * Euler does, and it is four lines a DBA can read. Documented in decisions.md B-007.
 */
import type { ClassParams, ControlVector, SimState } from "./types";
import { computeForces, advanceGearPosition, type ForceResult } from "./forces";
import { computeRotorForces } from "./rotorForces";
import { ecefToGeodetic, geodeticSurfaceNormal } from "./geo";
import { qIntegrate } from "./quat";
import { FIXED_DT } from "./integrator";
import { vAdd, vDot, vScale } from "./vec3";

/**
 * The ONE model-selection seam (#30): every other function in this file, and forces.ts /
 * rotorForces.ts themselves, are written with no knowledge of the other model. Adding a third
 * force model is one more case here, not a scattered set of `if` branches through the physics.
 */
function computeForcesFor(state: SimState, controls: ControlVector, params: ClassParams): ForceResult {
  return params.modelKind === "rotor"
    ? computeRotorForces(state, controls, params)
    : computeForces(state, controls, params);
}

/** Recompute the derived readouts on a state without advancing time. */
export function refreshDerived(
  state: SimState,
  controls: ControlVector,
  params: ClassParams,
): SimState {
  const geo = ecefToGeodetic(state.position);
  const withAlt: SimState = { ...state, altitudeM: geo.heightM };
  const f = computeForcesFor(withAlt, controls, params);
  return {
    ...withAlt,
    tasMs: f.tasMs,
    iasMs: f.iasMs,
    aoaRad: f.aoaRad,
    sideslipRad: f.sideslipRad,
    verticalSpeedMs: vDot(state.velocity, geodeticSurfaceNormal(state.position)),
    loadFactor: f.loadFactor,
    gLimited: f.gLimited,
    stalled: f.stalled,
    machNumber: f.machNumber,
    gearPosition: state.gearPosition,
  };
}

export function stepAircraft(
  state: SimState,
  controls: ControlVector,
  params: ClassParams,
  dt: number = FIXED_DT,
): SimState {
  const f = computeForcesFor(state, controls, params);

  // Semi-implicit: new derivatives first...
  const velocity = vAdd(state.velocity, vScale(f.forceEcef, dt / params.massKg));
  const rates = vAdd(state.rates, vScale(f.ratesDotBody, dt));

  // ...then advance the integrals with them.
  const position = vAdd(state.position, vScale(velocity, dt));
  const attitude = qIntegrate(state.attitude, rates, dt);

  const geo = ecefToGeodetic(position);
  const gearPosition = advanceGearPosition(state.gearPosition, controls.gearDown, params.gear, dt);
  const advanced: SimState = {
    position,
    velocity,
    attitude,
    rates,
    timeS: state.timeS + dt,
    altitudeM: geo.heightM,
    tasMs: f.tasMs,
    iasMs: f.iasMs,
    aoaRad: f.aoaRad,
    sideslipRad: f.sideslipRad,
    verticalSpeedMs: vDot(velocity, geodeticSurfaceNormal(position)),
    loadFactor: f.loadFactor,
    gLimited: f.gLimited,
    stalled: f.stalled,
    machNumber: f.machNumber,
    gearPosition,
  };
  return advanced;
}
