/*
 * A deliberately LOW-FIDELITY rotorcraft force model (#30). The fixed-wing model in forces.ts
 * hard-codes lift as a function of angle of attack with a stall break, and thrust along the
 * body-X axis — a shape that cannot represent a rotor, which generates lift regardless of
 * forward speed and has no stall floor. This is the second, simple force path that shape needs;
 * sim/aircraft.ts is the single seam that picks between the two by ClassParams.modelKind.
 *
 * The model, in full:
 *   - collective (ControlVector.throttle) sets rotor thrust magnitude, scaled by air density so
 *     hover gets harder at altitude, the way a real rotor's does;
 *   - thrust acts straight up the body Z axis (body -Z; Z is down) — it never tilts on its own;
 *   - cyclic (ControlVector.pitch/roll) commands a body pitch/roll RATE, exactly like the
 *     fixed-wing model's rate-command-with-damping moments, but with NO airspeed-gated authority
 *     (a rotor's cyclic and pedals work at zero airspeed, unlike a fixed wing's control surfaces)
 *     and no stiffness pulling the aircraft back to a "trimmed" attitude — a helicopter holds
 *     whatever attitude the cyclic leaves it at. Tilting the BODY is what tilts the (body-fixed)
 *     thrust vector once resolved into ECEF, which is what makes the aircraft translate — the
 *     translation "falls out" of the same attitude integration every class already uses, rather
 *     than needing a second, separate thrust-tilt calculation;
 *   - anti-torque (ControlVector.yaw) commands a yaw rate the same way;
 *   - one linear drag term (N per m/s of ECEF velocity) opposes the actual velocity vector,
 *     horizontal or vertical alike. It is what keeps translation and descent from accelerating
 *     unbounded, and it is what makes descent rate self-limiting: cut the collective and the
 *     aircraft settles toward a stable terminal velocity, not a runaway.
 *
 * Explicit non-goals (owner 2026-08-12, issue #30: "even if helicopters aren't high fidelity —
 * if we can do hover to land, that's plenty for now"):
 *   - NO autorotation (engine-out is not modeled as a distinct rotor state at all)
 *   - NO vortex-ring-state / settling-with-power
 *   - NO ground effect
 *   - NO blade dynamics, retreating-blade stall, translational lift, or torque/anti-torque
 *     coupling beyond the pedal input above
 * The bar this clears: spawn airborne, hover, translate, and descend to a controlled vertical
 * landing. Every number in params/r44.json is a tuning knob, not a source-verified figure.
 */
import type { ClassParams, ControlVector, SimState, Vec3 } from "./types";
import type { ForceResult } from "./forces";
import { isaDensity, RHO_SL, tasToIas, machNumber } from "./isa";
import { geodeticSurfaceNormal } from "./geo";
import { qRotate, qRotateInverse } from "./quat";
import { vAdd, vLength, vScale } from "./vec3";

const G0 = 9.80665;

/**
 * The collective (throttle, [0,1]) at which sea-level thrust exactly equals weight — the spawn
 * builder's hover trim (takeover/spawn.ts). Scales with density ratio at altitude, same as
 * computeRotorForces, so the trim stays honest off the deck. Clamped to [0,1]: a class whose
 * maxThrustN can't hold its own weight at this altitude has no valid hover point, which is a
 * params-file bug the clamp will not hide (the aircraft will visibly sink at full collective).
 */
export function hoverCollective(params: ClassParams, altitudeM: number): number {
  if (params.rotor === undefined) throw new Error("hoverCollective requires a rotor-model class");
  const densityRatio = isaDensity(altitudeM) / RHO_SL;
  const weight = params.massKg * G0;
  const collective = weight / (params.rotor.maxThrustN * densityRatio);
  return Math.min(1, Math.max(0, collective));
}

export function computeRotorForces(
  state: SimState,
  controls: ControlVector,
  params: ClassParams,
): ForceResult {
  if (params.rotor === undefined) throw new Error("computeRotorForces requires a rotor-model class");
  const rotor = params.rotor;
  const weight = params.massKg * G0;

  // ---- thrust: collective, scaled by air density, straight up the body axis ----
  const collective = Math.min(1, Math.max(0, controls.throttle));
  const densityRatio = isaDensity(state.altitudeM) / RHO_SL;
  const thrustN = collective * rotor.maxThrustN * densityRatio;
  const thrustBody: Vec3 = { x: 0, y: 0, z: -thrustN }; // body Z is down, so up is -Z

  const gravityEcef = vScale(geodeticSurfaceNormal(state.position), -weight);
  // Still air (v1 scope, matches forces.ts): ECEF velocity IS the relative wind.
  const dragEcef = vScale(state.velocity, -rotor.dragPerVelocity);
  const forceEcef = vAdd(vAdd(qRotate(state.attitude, thrustBody), gravityEcef), dragEcef);

  // ---- moments: cyclic/pedal as a commanded rate, full authority at any airspeed, no
  // stiffness back toward a "trimmed" attitude (see header comment) ----
  const pCmd = controls.roll * rotor.rollRateMaxRadS;
  const qCmd = controls.pitch * rotor.pitchRateMaxRadS;
  const rCmd = controls.yaw * rotor.yawRateMaxRadS;
  const ratesDotBody: Vec3 = {
    x: (pCmd - state.rates.x) * rotor.rollDampingPerS,
    y: (qCmd - state.rates.y) * rotor.pitchDampingPerS,
    z: (rCmd - state.rates.z) * rotor.yawDampingPerS,
  };

  const vBody = qRotateInverse(state.attitude, state.velocity);
  const tasMs = vLength(vBody);
  const iasMs = tasToIas(tasMs, state.altitudeM);

  return {
    forceEcef,
    ratesDotBody,
    // No wing, no angle of attack, no sideslip-restoring weathercock — reported as zero
    // rather than invented, per the honesty rules (CLAUDE.md ground rule 1).
    aoaRad: 0,
    sideslipRad: 0,
    tasMs,
    iasMs,
    machNumber: machNumber(tasMs, state.altitudeM),
    // Roughly the vertical g the airframe feels; not a certified rotorcraft load-factor figure.
    loadFactor: thrustN / weight,
    // No structural g-limit modeled for this class (limits.gLimitPos/Neg exist only to satisfy
    // the shared ClassParams schema — see params/r44.json's sources block).
    gLimited: false,
    // A rotor has no stall floor — always false, so the HUD never shows a false STALL warning
    // at hover or low airspeed (#30).
    stalled: false,
  };
}
