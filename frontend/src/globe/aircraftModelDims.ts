/*
 * Per-class low-poly model dimensions (issue #15). These are DATA, keyed by the same class id
 * the flight params use (c172s / b738 / f5e / biz — see takeover/eligibility.ts::resolveClass and
 * sim/params.ts::loadClassById), NOT a per-class code branch: buildAirframe (aircraftGeometry.ts)
 * turns one dimension record into a wireframe, so the four silhouettes differ only in these
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
  /**
   * Wing VERTICAL placement, as a fraction of fuselageRadiusM: negative = high (on top of the
   * fuselage, up is -Z), positive = low (under the belly). The single biggest type cue —
   * C172 high, 737 low, F-5 low/mid.
   */
  wingZFrac: number;
  /** Wing taper: tip chord ÷ root chord. 1 = constant chord; < 1 = tapered/trapezoidal. */
  wingTipChordFrac: number;
  /**
   * Optional underwing engine nacelles (the 737's clearest signature). ABSENT means no nacelle —
   * this is DATA, not a per-class code branch: c172s and f5e simply omit the field.
   */
  engine?: {
    /** Number of nacelles (documents intent; equals spanFracs.length). */
    count: number;
    /** Y position of each nacelle as a SIGNED fraction of the wing semi-span. Keep the list
     *  symmetric (e.g. [-0.35, 0.35]) so the airframe stays left/right symmetric. */
    spanFracs: number[];
    /** Nacelle length (fore-aft), metres. */
    lengthM: number;
    /** Nacelle radius (half-width and half-height of its square section), metres. */
    radiusM: number;
  };
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
    wingZFrac: -1.0, // high wing, on top of the cabin
    wingTipChordFrac: 0.95, // near-constant chord
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
    wingZFrac: 0.9, // low wing, under the belly
    wingTipChordFrac: 0.35, // strongly tapered airliner wing
    engine: { count: 2, spanFracs: [-0.35, 0.35], lengthM: 4.3, radiusM: 1.0 }, // two podded nacelles
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
    wingZFrac: 0.3, // low/mid wing
    wingTipChordFrac: 0.4, // low-aspect trapezoidal wing
    tailSpanM: 5.1,
    tailChordM: 1.8,
    finHeightM: 2.3,
    fuselageRadiusM: 0.7,
  },
  biz: {
    lengthM: 19.0,
    wingSpanM: 15.5,
    wingSweepRad: (20 * Math.PI) / 180,
    wingChordM: 2.6,
    wingXFrac: 0.40,
    wingZFrac: 0.7, // low wing
    wingTipChordFrac: 0.45,
    engine: { count: 2, spanFracs: [-0.18, 0.18], lengthM: 2.4, radiusM: 0.55 }, // aft-fuselage-mounted, tucked inboard
    tailSpanM: 6.4,
    tailChordM: 1.8,
    finHeightM: 3.2,
    fuselageRadiusM: 0.95,
  },
  tprop: {
    lengthM: 14.2,
    wingSpanM: 17.7,
    wingSweepRad: 0, // straight turboprop wing
    wingChordM: 1.9,
    wingXFrac: 0.38,
    wingZFrac: 0.6, // low wing
    wingTipChordFrac: 0.5,
    engine: { count: 2, spanFracs: [-0.28, 0.28], lengthM: 2.8, radiusM: 0.5 }, // two WING-mounted turboprops (nacelle boxes; no prop-disc geometry)
    tailSpanM: 5.2,
    tailChordM: 1.4,
    finHeightM: 3.9, // tall T-tail
    fuselageRadiusM: 0.85,
  },
};

/**
 * Resolve a class id to its model dimensions. Unknown id is a bug (the resolver only ever
 * produces the four keys above), not data — so it throws, exactly like loadClassById.
 */
export function modelDimsForClass(classId: string): ModelDims {
  const dims = MODEL_DIMS[classId];
  if (!dims) throw new Error(`unknown class id: ${classId}`);
  return dims;
}
