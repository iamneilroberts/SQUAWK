/*
 * Pure instrument mathematics for the unified-glass EFIS and HUD primary displays. Same rules
 * as gaugeMath.ts: plain numbers in, plain numbers out, no React / Cesium / snapshot type, so
 * the whole layout is testable without a renderer. Honesty baked into the signatures — an
 * unknown reading returns `null` (the view draws an em-dash and omits the mark), never a 0.
 *
 * ONE pixel convention for the vertical moving tapes and the HUD ladder: +y is DOWN (SVG
 * screen space). A HIGHER value sits ABOVE the centre pointer, i.e. at a NEGATIVE y offset.
 */

/** Normalise the IEEE -0 (from `-(x - x)`) to a plain 0 so offsets read cleanly. */
function nz(n: number): number {
  return n === 0 ? 0 : n;
}

/** One graduation on a vertical moving-tape (speed or altitude). */
export type TapeTick = { value: number; px: number; label: string; major: boolean };

/**
 * Graduations for a vertical moving tape centred on `center`. Ticks fall on multiples of `step`
 * within `+/- halfWindow` value-units of the centre; `px` is the screen offset from the centre
 * pointer (negative = above = higher value). `majorEvery` marks label/emphasis ticks. Returns
 * an empty list when the reading is unknown — the caller then shows only the em-dash box.
 */
export function tapeTicks(o: {
  center: number | null;
  step: number;
  halfWindow: number;
  pxPerUnit: number;
  majorEvery?: number;
}): TapeTick[] {
  const { center, step, halfWindow, pxPerUnit } = o;
  if (center === null || !Number.isFinite(center) || step <= 0) return [];
  const majorEvery = o.majorEvery ?? 1;
  const lo = center - halfWindow;
  const hi = center + halfWindow;
  const first = Math.ceil(lo / step) * step;
  const ticks: TapeTick[] = [];
  for (let v = first; v <= hi + 1e-9; v += step) {
    const value = Math.round(v); // guard against float drift so labels read cleanly
    ticks.push({
      value,
      px: nz(-(value - center) * pxPerUnit),
      label: String(value),
      major: Math.round(value / step) % majorEvery === 0,
    });
  }
  return ticks;
}

/**
 * Screen y of a fixed bug (e.g. Vfe, Vno) on a vertical tape, or `null` when the bug is off the
 * visible window or the reading it is measured against is unknown. Same convention as the ticks.
 */
export function tapeBugPx(o: {
  value: number;
  center: number | null;
  halfWindow: number;
  pxPerUnit: number;
}): number | null {
  const { value, center, halfWindow, pxPerUnit } = o;
  if (center === null || !Number.isFinite(center)) return null;
  if (Math.abs(value - center) > halfWindow) return null;
  return nz(-(value - center) * pxPerUnit);
}

/**
 * The HUD velocity vector (flight-path marker) offset from the fixed boresight, in px. The
 * marker sits where the aeroplane is actually going: DOWN from the boresight by the angle of
 * attack (nose points above the flight path by AoA), and sideways by the sideslip. `null` when
 * either angle is unknown — a HUD never guesses where the energy is going. `pxPerDeg` is the
 * shared pitch-ladder scale so the marker and the ladder agree.
 */
export function velocityVectorOffsetPx(o: {
  aoaRad: number | null;
  sideslipRad: number | null;
  pxPerDeg: number;
}): { x: number; y: number } | null {
  const { aoaRad, sideslipRad, pxPerDeg } = o;
  if (aoaRad === null || !Number.isFinite(aoaRad)) return null;
  if (sideslipRad === null || !Number.isFinite(sideslipRad)) return null;
  const deg = (r: number) => (r * 180) / Math.PI;
  return {
    x: nz(deg(sideslipRad) * pxPerDeg),
    y: nz(deg(aoaRad) * pxPerDeg), // +AoA => marker below boresight (+y down)
  };
}

/** One graduation on the HUD's horizontal heading scale. */
export type HeadingTick = { deg: number; px: number; label: string; major: boolean };

/**
 * Graduations for the HUD heading scale, centred on the current heading. Ticks fall on multiples
 * of `stepDeg` within `+/- halfSpanDeg`; `px` is the horizontal offset from centre (heading to
 * the RIGHT of current is +x). Majors (multiples of 30 deg) carry the compass-style label
 * (030, 06, ...). Empty when heading is unknown.
 */
export function headingTapeTicks(o: {
  headingDeg: number | null;
  halfSpanDeg: number;
  stepDeg: number;
  pxPerDeg: number;
}): HeadingTick[] {
  const { headingDeg, halfSpanDeg, stepDeg, pxPerDeg } = o;
  if (headingDeg === null || !Number.isFinite(headingDeg) || stepDeg <= 0) return [];
  const ticks: HeadingTick[] = [];
  const first = Math.ceil((headingDeg - halfSpanDeg) / stepDeg) * stepDeg;
  for (let d = first; d <= headingDeg + halfSpanDeg + 1e-9; d += stepDeg) {
    const wrapped = ((Math.round(d) % 360) + 360) % 360;
    const major = wrapped % 30 === 0;
    ticks.push({
      deg: wrapped,
      px: nz((d - headingDeg) * pxPerDeg),
      // Compass label idiom: tens of degrees for majors (030 -> "03"), blank otherwise.
      label: major ? String(wrapped / 10).padStart(2, "0") : "",
      major,
    });
  }
  return ticks;
}
