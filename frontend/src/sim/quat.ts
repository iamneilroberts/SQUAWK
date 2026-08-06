/*
 * Attitude is a body -> ECEF quaternion. Body axes: X out the nose, Y out the right wing,
 * Z down. Body rates: p about X (right wing down positive), q about Y (nose up positive),
 * r about Z (nose right positive) — standard aerospace, verified by the sign tests.
 *
 * Heading/pitch/roll exist ONLY at the Cesium boundary (camera.setView). They are computed
 * from the ENU basis at the aircraft's own position, so nothing drifts as it flies around
 * the planet and there is no Euler state to hit a gimbal singularity.
 */
import type { Quat, Vec3 } from "./types";
import { enuBasis } from "./geo";
import { vCross, vDot, vNormalize } from "./vec3";

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function qMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (n === 0) return QUAT_IDENTITY;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

export function qConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Rotate a body-frame vector into ECEF. */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  // t = 2 * (q_vec x v);  v' = v + q.w * t + q_vec x t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Rotate an ECEF vector into the body frame. */
export function qRotateInverse(q: Quat, v: Vec3): Vec3 {
  return qRotate(qConjugate(q), v);
}

/**
 * One integration step of the body rates onto the attitude, renormalized every call.
 *
 * q' = q (x) exp(0.5 * omega_body * dt) — the exponential map, which is EXACT for a rate
 * held constant across the step (which is what a fixed-step sim hands it). The obvious
 * cheaper form, q' = q + 0.5 * q (x) omega * dt, is first-order and under-rotates by
 * theta^3/12 per step: negligible for the 172 (40 deg/s -> 8e-6 rad/s of drift) but 0.33 deg
 * of lost roll over a single 360 deg/s aerobatic roll, and worse again for the fighter
 * class's roll rates. One sin/cos per step buys that whole error class away, so we pay it.
 *
 * The renormalize is still here: it keeps float round-off from ever accumulating into a
 * non-rotation over a long flight (60000-step drift test).
 */
export function qIntegrate(q: Quat, ratesBody: Vec3, dt: number): Quat {
  const omegaMag = Math.hypot(ratesBody.x, ratesBody.y, ratesBody.z);
  if (omegaMag === 0) return qNormalize(q);
  const halfAngle = 0.5 * omegaMag * dt;
  // sin(halfAngle)/omegaMag scales the rate vector into the quaternion's vector part
  // without normalizing it separately — one divide, and omegaMag is already non-zero.
  const s = Math.sin(halfAngle) / omegaMag;
  const delta: Quat = {
    x: ratesBody.x * s,
    y: ratesBody.y * s,
    z: ratesBody.z * s,
    w: Math.cos(halfAngle),
  };
  return qNormalize(qMultiply(q, delta));
}

/**
 * Attitude -> Cesium camera HPR at this position.
 *  heading: clockwise from local north, 0 = north
 *  pitch:   positive = nose above the local horizontal plane
 *  roll:    positive = right wing down
 * These are the conventions `camera.setView({orientation:{heading,pitch,roll}})` expects.
 */
export function hprFromQuat(
  q: Quat,
  positionEcef: Vec3,
): { headingRad: number; pitchRad: number; rollRad: number } {
  const { east, north, up } = enuBasis(positionEcef);
  const nose = qRotate(q, { x: 1, y: 0, z: 0 });
  const rightWing = qRotate(q, { x: 0, y: 1, z: 0 });

  const noseE = vDot(nose, east);
  const noseN = vDot(nose, north);
  const noseU = vDot(nose, up);

  const headingRad = Math.atan2(noseE, noseN);
  const pitchRad = Math.atan2(noseU, Math.hypot(noseE, noseN));

  // Wings-level reference: the horizontal vector 90 deg right of the nose.
  const horizontalRight = vNormalize(vCross(nose, up));
  const rollRad = Math.atan2(
    vDot(vCross(horizontalRight, rightWing), nose),
    vDot(horizontalRight, rightWing),
  );
  return { headingRad, pitchRad, rollRad };
}

/** The inverse: build a body -> ECEF attitude from ENU heading/pitch/roll. */
export function quatFromHpr(
  positionEcef: Vec3,
  headingRad: number,
  pitchRad: number,
  rollRad: number,
): Quat {
  const { east, north, up } = enuBasis(positionEcef);
  const ch = Math.cos(headingRad);
  const sh = Math.sin(headingRad);
  const cp = Math.cos(pitchRad);
  const sp = Math.sin(pitchRad);
  const cr = Math.cos(rollRad);
  const sr = Math.sin(rollRad);

  // Body axes expressed in ENU components, then mapped into ECEF.
  const enu = (e: number, n: number, u: number): Vec3 => ({
    x: east.x * e + north.x * n + up.x * u,
    y: east.y * e + north.y * n + up.y * u,
    z: east.z * e + north.z * n + up.z * u,
  });
  const nose = enu(cp * sh, cp * ch, sp);
  const rightWing = enu(
    cr * ch + sr * sp * sh,
    -cr * sh + sr * sp * ch,
    -sr * cp,
  );
  const down = vNormalize(vCross(nose, rightWing));

  // Rotation matrix columns are the body axes in ECEF; convert to a quaternion (Shepperd).
  const m00 = nose.x, m10 = nose.y, m20 = nose.z;
  const m01 = rightWing.x, m11 = rightWing.y, m21 = rightWing.z;
  const m02 = down.x, m12 = down.y, m22 = down.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return qNormalize({ w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s });
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return qNormalize({ w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s });
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return qNormalize({ w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s });
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return qNormalize({ w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s });
}
