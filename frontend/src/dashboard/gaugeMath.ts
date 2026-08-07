/*
 * Pure needle mathematics for the six-pack. No React, no Cesium, no snapshot type: every
 * function takes plain numbers and returns plain numbers, which is what makes the whole
 * instrument panel's behaviour testable without a renderer.
 *
 * ONE angle convention throughout: DEGREES CLOCKWISE FROM 12 O'CLOCK. A needle drawn pointing
 * straight up at rest is placed by SVG's `transform="rotate(deg cx cy)"`, which is
 * clockwise-positive in screen coordinates, so these numbers go into the markup unmodified.
 *
 * Honesty rules baked into the signatures:
 *  - an unknown reading returns `null`, never 0. The view renders an em-dash and hides the
 *    needle; a zero would be a reading the sim never made.
 *  - a reading past the end of a scale comes back clamped WITH `pegged: true`, so the view can
 *    draw the needle against the stop instead of implying an on-scale value.
 *  - what the sim does not model is not on the face at all: no barometric setting, no heading
 *    bug, no vacuum flag. See decisions.md CD-002 and CD-004.
 */
import type { ClassParams } from "../sim/types";
import { stallSpeedIasMs } from "../sim/forces";
import { EM_DASH } from "../hud/format";
import { msToKt, mToFt, msToFpm, radToDeg } from "../sim/units";

export type Needle = { deg: number; pegged: boolean };
export type Arc = { kind: "white" | "green" | "yellow" | "red"; fromDeg: number; toDeg: number };

const known = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap into [0, 360). */
function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// ---- airspeed indicator ----------------------------------------------------------------
/**
 * A linear 40-180 kt face over a 300-degree sweep starting at the 1 o'clock stop.
 * Real ASIs are slightly non-linear at the bottom of the scale; a linear map is one line of
 * arithmetic, keeps needle and arcs in exact agreement by construction, and covers the whole
 * C172S band (Vs0 40.4 kt to Vne 163 kt) with headroom at both ends.
 */
export const ASI_MIN_KT = 40;
export const ASI_MAX_KT = 180;
export const ASI_START_DEG = 30;
export const ASI_SWEEP_DEG = 300;

function asiDegFor(kt: number): number {
  return ASI_START_DEG + ((kt - ASI_MIN_KT) / (ASI_MAX_KT - ASI_MIN_KT)) * ASI_SWEEP_DEG;
}

export function asiNeedle(iasMs: number | null): Needle | null {
  if (!known(iasMs)) return null;
  const kt = msToKt(iasMs);
  const raw = asiDegFor(kt);
  const lo = ASI_START_DEG;
  const hi = ASI_START_DEG + ASI_SWEEP_DEG;
  return { deg: clamp(raw, lo, hi), pegged: raw < lo || raw > hi };
}

/**
 * The four painted markings, all derived from the class parameters:
 *  white  Vs0 (full-flap stall) -> Vfe
 *  green  Vs1 (clean stall)     -> Vno
 *  yellow Vno                   -> Vne
 *  red    a zero-width line AT Vne
 * Vs0/Vs1 come from `forces.stallSpeedIasMs` (the same function the envelope tests hold to the
 * POH), so the arcs cannot drift away from the aeroplane the sim actually flies.
 */
export function asiArcs(params: ClassParams): Arc[] {
  const vs0 = msToKt(stallSpeedIasMs(params, params.flaps.length - 1));
  const vs1 = msToKt(stallSpeedIasMs(params, 0));
  const vfe = msToKt(params.limits.vfeIasMs);
  const vno = msToKt(params.limits.vnoIasMs);
  const vne = msToKt(params.limits.vneIasMs);
  return [
    { kind: "white", fromDeg: asiDegFor(vs0), toDeg: asiDegFor(vfe) },
    { kind: "green", fromDeg: asiDegFor(vs1), toDeg: asiDegFor(vno) },
    { kind: "yellow", fromDeg: asiDegFor(vno), toDeg: asiDegFor(vne) },
    { kind: "red", fromDeg: asiDegFor(vne), toDeg: asiDegFor(vne) },
  ];
}

// ---- altimeter -------------------------------------------------------------------------
/**
 * Drum-pointer, not three-pointer (decisions.md CD-004): ONE hand for hundreds of feet plus a
 * digital drum for the whole reading. The three-pointer's 10,000 ft hand is the classic
 * misread, and a second scale that can disagree with the HUD's ALT is a bug surface this build
 * does not need.
 *
 * The hand WRAPS and never pegs — that is what an altimeter does — which is also why a negative
 * altitude lands at a real position on the face instead of being clamped to zero.
 */
export function altimeterNeedle(altitudeM: number | null): Needle | null {
  if (!known(altitudeM)) return null;
  const ft = mToFt(altitudeM);
  return { deg: wrap360((ft / 1000) * 360), pegged: false };
}

export function altimeterDrum(altitudeM: number | null): string {
  return known(altitudeM) ? String(Math.round(mToFt(altitudeM))) : EM_DASH;
}

// ---- vertical speed indicator ------------------------------------------------------------
/**
 * Linear +/-2000 fpm, zero at 9 o'clock, full scale straight up and straight down. Real VSIs
 * compress the top of the scale; linear keeps the needle honest against the HUD's numeric VSI
 * and makes the pegging rule a single comparison.
 */
export const VSI_FULL_SCALE_FPM = 2000;
export const VSI_ZERO_DEG = 270;
export const VSI_HALF_SWEEP_DEG = 90;

export function vsiNeedle(verticalSpeedMs: number | null): Needle | null {
  if (!known(verticalSpeedMs)) return null;
  const fpm = msToFpm(verticalSpeedMs);
  const frac = fpm / VSI_FULL_SCALE_FPM;
  return {
    deg: VSI_ZERO_DEG + clamp(frac, -1, 1) * VSI_HALF_SWEEP_DEG,
    pegged: Math.abs(frac) > 1,
  };
}

// ---- attitude indicator ------------------------------------------------------------------
/** Pixels of horizon travel per degree of pitch, inside the 120-unit dial viewBox. */
export const AI_PX_PER_DEG = 2.2;

export function attitudePitchOffsetPx(
  pitchRad: number | null,
): { px: number; pegged: boolean } | null {
  if (!known(pitchRad)) return null;
  const deg = radToDeg(pitchRad);
  // hprFromQuat computes pitch as atan2(up, |horizontal|), whose range IS [-90, 90]. There is
  // no stop to hit, so this never reports pegged - inventing one would be a fake reading.
  return { px: deg * AI_PX_PER_DEG, pegged: false };
}

/** Horizon rotation, clockwise-positive. Right wing down tips the drawn horizon the other way. */
export function attitudeRollDeg(rollRad: number | null): number | null {
  if (!known(rollRad)) return null;
  const deg = wrap360(-radToDeg(rollRad));
  return deg > 180 ? deg - 360 : deg;
}

export function pitchLadderRungs(): {
  deg: number;
  px: number;
  label: string;
  halfWidthPx: number;
}[] {
  return [-30, -20, -10, 10, 20, 30].map((deg) => ({
    deg,
    px: -deg * AI_PX_PER_DEG,
    label: String(Math.abs(deg)),
    halfWidthPx: deg % 20 === 0 ? 22 : 13,
  }));
}

// ---- directional gyro --------------------------------------------------------------------
/** The card turns opposite the aeroplane, so the current heading stays under the lubber line. */
export function headingCardDeg(headingRad: number | null): number | null {
  if (!known(headingRad)) return null;
  return wrap360(-radToDeg(headingRad));
}

// ---- turn coordinator --------------------------------------------------------------------
export const STANDARD_RATE_DEG_S = 3;
export const TC_SYMBOL_BANK_AT_STD_DEG = 15;
export const TC_MAX_SYMBOL_BANK_DEG = 30;

/** The little aeroplane banks to the index at standard rate and pegs at twice standard rate. */
export function turnSymbolBankDeg(turnRateRadS: number | null): Needle | null {
  if (!known(turnRateRadS)) return null;
  const ratio = radToDeg(turnRateRadS) / STANDARD_RATE_DEG_S;
  return {
    deg: clamp(ratio, -2, 2) * TC_SYMBOL_BANK_AT_STD_DEG,
    pegged: Math.abs(ratio) > 2,
  };
}

// ---- slip ball ---------------------------------------------------------------------------
/**
 * Driven by SIDESLIP, and the face says so (`SLIP beta`). This sim has no lateral
 * accelerometer, but it also has no crosswind, no P-factor and no engine torque: the only
 * lateral specific force in the model is q*S*cyBeta*beta, a strictly monotone function of beta.
 * So beta is not a stand-in for the ball here - it is what the ball would be measuring.
 * decisions.md CD-002.
 *
 * SLIP_BALL_SIGN is the ONE place the left/right convention is decided; the acceptance
 * walkthrough checks it against "step on the ball" and flips this constant if it is mirrored.
 * Never fix a mirrored ball in the component.
 */
export const SLIP_FULL_SCALE_BETA_DEG = 10;
export const SLIP_BALL_TRAVEL_PX = 26;
export const SLIP_BALL_SIGN = -1;

export function slipBallOffsetPx(
  sideslipRad: number | null,
): { px: number; pegged: boolean } | null {
  if (!known(sideslipRad)) return null;
  const ratio = radToDeg(sideslipRad) / SLIP_FULL_SCALE_BETA_DEG;
  return {
    px: SLIP_BALL_SIGN * clamp(ratio, -1, 1) * SLIP_BALL_TRAVEL_PX,
    pegged: Math.abs(ratio) > 1,
  };
}
