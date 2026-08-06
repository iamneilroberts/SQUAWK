/*
 * Plain-object 3-vectors. Deliberately allocation-happy and immutable: at 60 Hz with one
 * aircraft this is nowhere near a bottleneck, and legibility beats object pooling here.
 */
import type { Vec3 } from "./types";

export const V_ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function vScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function vLength(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
/** Zero-length input returns zero, never NaN — a stationary aircraft must not poison state. */
export function vNormalize(a: Vec3): Vec3 {
  const len = vLength(a);
  return len === 0 ? V_ZERO : vScale(a, 1 / len);
}
