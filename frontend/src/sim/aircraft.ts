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
import { computeForces } from "./forces";
import { ecefToGeodetic, geodeticSurfaceNormal } from "./geo";
import { qIntegrate } from "./quat";
import { FIXED_DT } from "./integrator";
import { vAdd, vDot, vScale } from "./vec3";

/** Recompute the derived readouts on a state without advancing time. */
export function refreshDerived(
  state: SimState,
  controls: ControlVector,
  params: ClassParams,
): SimState {
  const geo = ecefToGeodetic(state.position);
  const withAlt: SimState = { ...state, altitudeM: geo.heightM };
  const f = computeForces(withAlt, controls, params);
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
  };
}

export function stepAircraft(
  state: SimState,
  controls: ControlVector,
  params: ClassParams,
  dt: number = FIXED_DT,
): SimState {
  const f = computeForces(state, controls, params);

  // Semi-implicit: new derivatives first...
  const velocity = vAdd(state.velocity, vScale(f.forceEcef, dt / params.massKg));
  const rates = vAdd(state.rates, vScale(f.ratesDotBody, dt));

  // ...then advance the integrals with them.
  const position = vAdd(state.position, vScale(velocity, dt));
  const attitude = qIntegrate(state.attitude, rates, dt);

  const geo = ecefToGeodetic(position);
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
  };
  return advanced;
}
