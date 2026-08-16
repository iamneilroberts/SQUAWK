/*
 * Desktop mouse flight-stick maths (issue #44). Pure functions only, mirroring analog.ts's
 * touch-input pattern — no React, no DOM, unit-tested with no jsdom.
 *
 * The roll/pitch mapping is NOT reinvented here: FlightSession.tsx feeds a mouse-drag offset
 * (current pointer position minus the position where the drag started) straight into analog.ts's
 * `stickToAxes`, using the constants below for the radius/deadzone. That's the same pure function
 * the touch stick uses — a mouse offset from its click point is exactly a thumb offset from a pad
 * centre. The only maths this file adds is the wheel-to-throttle mapping, which touch didn't need
 * (it has a drag slider instead of a wheel).
 */

/** Mouse-drag radius for full stick deflection, CSS px. A first guess — owner-tunable by feel. */
export const MOUSE_STICK_RADIUS_PX = 180;
/** Deadzone as a fraction of the radius — absorbs click jitter without a step at the edge. */
export const MOUSE_STICK_DEADZONE = 0.08;

/**
 * Wheel sensitivity: a typical wheel "click" reports deltaY ~= 100. This maps one click to a 4%
 * throttle change — enough to feel like a lever, not a hair-trigger. Owner-tunable by feel.
 */
export const WHEEL_THROTTLE_SENS_PER_UNIT = 0.0004;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Scroll wheel -> absolute throttle lever [0,1] (matches ControlVector.throttle / the touch
 * slider — a LEVER, not sprung: it stays where the wheel left it). Scroll UP (deltaY negative,
 * "away from you") increases throttle — the common "push forward for more power" wheel
 * convention; scroll DOWN reduces it. `current` is the lever's last position (or the live sim
 * throttle, the first time the wheel is used — FlightSession seeds that).
 */
export function wheelToThrottle(
  current: number,
  wheelDeltaY: number,
  sensitivityPerUnit: number = WHEEL_THROTTLE_SENS_PER_UNIT,
): number {
  return clamp(current - wheelDeltaY * sensitivityPerUnit, 0, 1);
}
