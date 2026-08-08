/*
 * Analog touch-input maths (mobile sub-feature 2, spec §3 + §6 Option B).
 *
 * Pure functions only — no React, no DOM — so the load-bearing mapping (virtual stick pad
 * offset -> roll/pitch, throttle slider position -> [0,1], the fixed-gear inert rule) is
 * unit-tested with no jsdom, exactly like viewport.ts and the sim/. The React glue that reads
 * pointer events lives in TouchControls.tsx.
 *
 * These feed the OPTIONAL analog provider the flight loop samples (Option B): the sampler
 * OVERRIDES an axis this provides and leaves any axis it does NOT provide on the keyboard's
 * sprung path. `undefined` on an axis means "not driven — keep the keyboard behaviour".
 */

/**
 * Continuous analog targets, any subset. An axis left `undefined` is NOT driven and keeps its
 * keyboard-sprung value in the sampler; a number overrides that axis directly (bypassing the
 * spring). pitch/roll/yaw are [-1,1], throttle is [0,1] — same semantics as ControlVector.
 */
export type AnalogAxes = {
  /** [-1, 1], positive = nose up (stick back), matching ControlVector.pitch. */
  pitch?: number;
  /** [-1, 1], positive = roll right. */
  roll?: number;
  /** [-1, 1], positive = nose right (right rudder). */
  yaw?: number;
  /** [0, 1] absolute lever position. */
  throttle?: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Virtual analog stick: a pointer offset from the pad centre in CSS px -> roll/pitch targets.
 *
 * `dx` is rightward-positive, `dy` is DOWNWARD-positive (screen coordinates). Right thumb ->
 * roll right (dx>0 => roll>0). Thumb pulled DOWN the pad => stick back => nose up
 * (dy>0 => pitch>0), matching the keyboard's ArrowDown = "pitch up (stick back)". Whether that
 * feels right on a real thumb is an owner tuning call (an invert flag can wrap this) — it is
 * flagged for on-device testing, not guessable on a desktop.
 *
 * `radius` is the pad radius in px (offset == radius => full deflection). A radial DEADZONE of
 * `deadzoneFrac` (0..1 of the radius) returns dead-centre 0/0, then the remaining travel is
 * rescaled so the deadzone edge is 0 and the rim is 1 — no step at the deadzone boundary.
 * Magnitude is clamped to the rim so a drag past the pad still reads full, never >1.
 */
export function stickToAxes(
  dx: number,
  dy: number,
  radius: number,
  deadzoneFrac: number,
): { roll: number; pitch: number } {
  if (radius <= 0) return { roll: 0, pitch: 0 };
  const nx = dx / radius;
  const ny = dy / radius;
  const mag = Math.hypot(nx, ny);
  if (mag <= deadzoneFrac) return { roll: 0, pitch: 0 };
  const capped = Math.min(1, mag);
  // Rescale [deadzone, 1] -> [0, 1] along the same direction.
  const f = (capped - deadzoneFrac) / (1 - deadzoneFrac);
  const ux = nx / mag;
  const uy = ny / mag;
  return { roll: clamp(ux * f, -1, 1), pitch: clamp(uy * f, -1, 1) };
}

/**
 * Throttle slider: a pointer Y within a vertical track -> [0,1] ABSOLUTE (a lever, not sprung —
 * matching ControlVector.throttle and controls.ts). Top of the track (pointerY == top) is full
 * throttle (1), the bottom (pointerY == top+height) is idle (0). Out-of-track drags clamp.
 */
export function sliderToThrottle(pointerY: number, top: number, height: number): number {
  if (height <= 0) return 0;
  return clamp(1 - (pointerY - top) / height, 0, 1);
}

/**
 * The gear touch button is INERT on a fixed-gear class, exactly as KeyG is inert there
 * (controls.ts: the sampler only toggles gearDown when params.gear === "retractable"). The UI
 * shows it disabled so it is not a fake affordance.
 */
export function gearButtonDisabled(gear: "fixed" | "retractable"): boolean {
  return gear === "fixed";
}
