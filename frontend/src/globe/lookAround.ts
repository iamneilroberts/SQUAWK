/*
 * Free-look offset accumulator (issue #9) — a Cesium-free, deterministic little state object
 * layered ON TOP of the cockpit camera's low-passed orientation. While the player holds `Q`,
 * mouse motion feeds applyMouseDelta; on release the offset is eased back to zero so the view
 * returns exactly forward. It never touches ControlVector or the physics — the aeroplane keeps
 * flying its current inputs while the player swivels the view (spec §1, "zero control coupling").
 *
 * No DOM here on purpose: FlightSession owns the pointer-lock + mousemove plumbing and calls
 * these functions; this module is pure so it can be unit-tested without a browser.
 */

/** Yaw (about the view up-axis) and pitch offset from the cockpit-forward direction, radians. */
export type LookOffset = { yawRad: number; pitchRad: number };

export const ZERO_LOOK: LookOffset = { yawRad: 0, pitchRad: 0 };

/**
 * Tuning knob: mouse pixels -> radians of look. 0.0025 rad/px means a brisk ~1250 px flick
 * (easy under pointer lock's infinite travel) swings the view the full half-turn to look over
 * your shoulder, while small nudges read as small glances. Owner-tunable.
 */
export const LOOK_SENSITIVITY_RAD_PER_PX = 0.0025;

/** Pitch clamp: never quite straight up/down, so the view can't flip over the top (~85 deg). */
export const LOOK_MAX_PITCH_RAD = (85 * Math.PI) / 180;

/**
 * Exponential ease-back rate (1/s) used when the offset is decaying to forward on release.
 * At 12/s the offset is ~2.7% of its size after 0.3 s — the same "settle over about a third of
 * a second" feel as the return-to-level assist — and snaps cleanly to zero shortly after.
 */
export const LOOK_EASE_RATE_PER_S = 12;

/** Below this magnitude the ease snaps to exactly 0, so the view reaches true-forward. */
const LOOK_ZERO_EPS_RAD = 1e-4;

/** Wrap an angle into (-pi, pi] so yaw has full range and can face the rear. */
function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Accumulate one mouse delta into the offset: yaw WRAPS (full 360, look behind you), pitch
 * CLAMPS (never over the top). Mouse up (negative movementY) looks up.
 */
export function applyMouseDelta(
  offset: LookOffset,
  dx: number,
  dy: number,
  sensitivity: number,
): LookOffset {
  return {
    yawRad: wrapPi(offset.yawRad + dx * sensitivity),
    pitchRad: clamp(offset.pitchRad - dy * sensitivity, -LOOK_MAX_PITCH_RAD, LOOK_MAX_PITCH_RAD),
  };
}

/** One decay step of a single axis toward 0, snapping to exactly 0 once it is close enough. */
function decayAxis(v: number, factor: number): number {
  const next = v * factor;
  return Math.abs(next) < LOOK_ZERO_EPS_RAD ? 0 : next;
}

/**
 * Ease the offset toward zero (the "release Q -> return to forward" behaviour). Frame-rate
 * independent via the exponential residual exp(-rate*dt), and it reaches EXACTLY zero rather
 * than hovering asymptotically so the view ends up truly forward again.
 */
export function easeToward(offset: LookOffset, dtS: number, rate: number): LookOffset {
  const factor = Math.exp(-rate * dtS);
  return {
    yawRad: decayAxis(offset.yawRad, factor),
    pitchRad: decayAxis(offset.pitchRad, factor),
  };
}
