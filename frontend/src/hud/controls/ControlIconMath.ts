/*
 * Pure geometry for the control-state mini-instruments (#48). No React, no SVG strings, no
 * snapshot type: plain numbers in, plain numbers out, so the shapes are testable without a
 * renderer — same discipline as dashboard/gaugeMath.ts. Coordinates live in a 40x38 viewBox.
 *
 * Honesty rule: an unknown reading returns null; the view hides that glyph rather than drawing
 * a fabricated zero.
 */

/** Trim value that pegs the needle at the end-stop. Legibility knob, tuned on-device (spec §"tuning knobs"). */
export const TRIM_FULL_SCALE = 0.3;

const known = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// throttle lever: a knob sliding a vertical track from y=32 (idle) to y=6 (full).
const THR_TOP = 6, THR_BOT = 32;
export function throttleKnobY(throttle: number | null): number | null {
  if (!known(throttle)) return null;
  return THR_BOT - clamp(throttle, 0, 1) * (THR_BOT - THR_TOP);
}
export function throttleWarn(throttle: number | null): boolean {
  return known(throttle) && throttle > 0.92;
}

// flap trailing edge hinged at (27,17), length 11, drooping down to 58deg at full detent.
const FLAP_HINGE_X = 27, FLAP_HINGE_Y = 17, FLAP_LEN = 11, FLAP_MAX_DEG = 58;
export function flapDroopEnd(
  index: number | null,
  count: number | null,
): { x: number; y: number; active: boolean } | null {
  if (!known(index) || !known(count)) return null;
  const frac = count > 1 ? clamp(index, 0, count - 1) / (count - 1) : 0;
  const rad = (frac * FLAP_MAX_DEG * Math.PI) / 180;
  return {
    x: FLAP_HINGE_X + FLAP_LEN * Math.cos(rad),
    y: FLAP_HINGE_Y + FLAP_LEN * Math.sin(rad),
    active: index > 0,
  };
}

// trim needle: apex slides above/below the fixed center gate at y=19; +trim (nose-up) = smaller y.
const TRIM_CENTER_Y = 19, TRIM_SWING = 12, TRIM_NEUTRAL_EPS = 0.005;
export function trimNeedle(
  trim: number | null,
): { y: number; neutral: boolean; pegged: boolean } | null {
  if (!known(trim)) return null;
  const n = clamp(trim / TRIM_FULL_SCALE, -1, 1);
  return {
    y: TRIM_CENTER_Y - n * TRIM_SWING,
    neutral: Math.abs(trim) < TRIM_NEUTRAL_EPS,
    pegged: Math.abs(trim / TRIM_FULL_SCALE) > 1,
  };
}

// gear: wheel slides from y=15 (tucked up) to y=28 (extended down) with gearPosition.
const GEAR_UP_Y = 15, GEAR_DOWN_Y = 28, GEAR_STRUT_TOP = 14;
export function gearGlyph(
  gear: "fixed" | "retractable" | null,
  gearPosition: number | null,
): { wheelY: number; strutTopY: number; transit: boolean; fixed: boolean } | null {
  if (gear === "fixed") {
    return { wheelY: GEAR_DOWN_Y, strutTopY: GEAR_STRUT_TOP, transit: false, fixed: true };
  }
  if (gear !== "retractable" || !known(gearPosition)) return null;
  const p = clamp(gearPosition, 0, 1);
  return {
    wheelY: GEAR_UP_Y + p * (GEAR_DOWN_Y - GEAR_UP_Y),
    strutTopY: GEAR_STRUT_TOP,
    transit: p > 0 && p < 1,
    fixed: false,
  };
}

export function speedbrakeOut(speedbrake: boolean | null | undefined): boolean {
  return speedbrake === true;
}
