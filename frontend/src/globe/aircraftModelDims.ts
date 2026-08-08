/*
 * Per-class low-poly model dimensions (issue #15). These are DATA, keyed by the same class id
 * the flight params use (c172s / b738 / f5e — see takeover/eligibility.ts::resolveClass and
 * sim/params.ts::loadClassById), NOT a per-class code branch: buildAirframe (aircraftGeometry.ts)
 * turns one dimension record into a wireframe, so the three silhouettes differ only in these
 * numbers. Cesium-free and pure, so both this map and the geometry it feeds are unit-testable.
 *
 * All lengths are metres in the body frame (X forward out the nose, Y right wing, Z down — the
 * same axes sim/types.ts documents). The numbers are honest real-airframe proportions rounded to
 * the metre; exact centre-line placement (wingXFrac) and the slim-box fuselage radius are visual
 * TUNING KNOBS to adjust by eye in the browser, not source-verified aerodynamic figures.
 */
export type ModelDims = {
  /** Nose-to-tail length. Nose sits at +lengthM/2, tail at -lengthM/2. */
  lengthM: number;
  /** Wingtip-to-wingtip span. The wings reach ±wingSpanM/2 in Y. */
  wingSpanM: number;
  /** Quarter-chord sweep, radians. 0 = straight wing (GA); positive = swept back (jets). */
  wingSweepRad: number;
  /** Wing chord (fore-aft depth), constant across the span for this low-poly shape. */
  wingChordM: number;
  /** Wing leading-edge position from the nose, as a fraction of lengthM (0 = nose, 1 = tail). */
  wingXFrac: number;
  /** Horizontal tailplane span (tip to tip). */
  tailSpanM: number;
  /** Tailplane chord. */
  tailChordM: number;
  /** Vertical fin height above the fuselage top (up = -Z). */
  finHeightM: number;
  /** Half-width/height of the slim box fuselage. */
  fuselageRadiusM: number;
};

/**
 * The three flight-model classes. Real approximate proportions: C172S (small straight-wing
 * single), 737-800 (large swept airliner), F-5E (short, stubby, low-aspect swept fighter).
 */
export const MODEL_DIMS: Readonly<Record<string, ModelDims>> = {
  c172s: {
    lengthM: 8.3,
    wingSpanM: 11.0,
    wingSweepRad: 0,
    wingChordM: 1.5,
    wingXFrac: 0.32,
    tailSpanM: 3.4,
    tailChordM: 1.1,
    finHeightM: 1.7,
    fuselageRadiusM: 0.6,
  },
  b738: {
    lengthM: 39.5,
    wingSpanM: 35.8,
    wingSweepRad: (25 * Math.PI) / 180,
    wingChordM: 6.0,
    wingXFrac: 0.42,
    tailSpanM: 13.7,
    tailChordM: 3.5,
    finHeightM: 7.0,
    fuselageRadiusM: 1.9,
  },
  f5e: {
    lengthM: 14.7,
    wingSpanM: 8.1,
    wingSweepRad: (24 * Math.PI) / 180,
    wingChordM: 3.4,
    wingXFrac: 0.5,
    tailSpanM: 5.1,
    tailChordM: 1.8,
    finHeightM: 2.3,
    fuselageRadiusM: 0.7,
  },
};

/**
 * Resolve a class id to its model dimensions. Unknown id is a bug (the resolver only ever
 * produces the three keys above), not data — so it throws, exactly like loadClassById.
 */
export function modelDimsForClass(classId: string): ModelDims {
  const dims = MODEL_DIMS[classId];
  if (!dims) throw new Error(`unknown class id: ${classId}`);
  return dims;
}
