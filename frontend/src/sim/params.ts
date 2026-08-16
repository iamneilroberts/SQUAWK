/*
 * Parameter files are data, not code — so they get validated once, loudly, at load time
 * rather than producing NaN somewhere inside the integrator three seconds into a flight.
 * A hand-written validator (not a schema library) keeps the dependency list untouched.
 */
import type { ClassParams, FlapDetent, LapseModel, ModelKind, RotorParams } from "./types";
import c172Raw from "../params/c172.json";
import b738Raw from "../params/b738.json";
import f5eRaw from "../params/f5e.json";
import bizRaw from "../params/biz.json";
import tpropRaw from "../params/tprop.json";
import r44Raw from "../params/r44.json";
import t6Raw from "../params/t6.json";
import c130Raw from "../params/c130.json";

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function num(obj: Record<string, unknown>, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${path}.${key} must be a finite number`);
  }
  return v;
}

function positive(obj: Record<string, unknown>, key: string, path: string): number {
  const v = num(obj, key, path);
  if (v <= 0) throw new Error(`${path}.${key} must be greater than zero`);
  return v;
}

function str(obj: Record<string, unknown>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
  return v;
}

/**
 * The powerplant's density-altitude lapse is data. An absent or unrecognised value is a
 * load-time error, not a silent default: defaulting to "none" would quietly flat-rate a
 * piston engine, and defaulting to "piston" would bake a light-single assumption into every
 * future class. Keep this list in step with `POWER_LAPSE_MODELS` in forces.ts.
 */
const LAPSE_MODELS: readonly LapseModel[] = ["piston", "none", "turbofan", "turboprop"];

function lapseModel(obj: Record<string, unknown>, path: string): LapseModel {
  const v = str(obj, "lapseModel", path);
  if (!LAPSE_MODELS.includes(v as LapseModel)) {
    throw new Error(`${path}.lapseModel must be one of: ${LAPSE_MODELS.join(", ")}`);
  }
  return v as LapseModel;
}

const ATTITUDE_STYLES = ["line", "ball"] as const;

function attitudeStyle(obj: Record<string, unknown>, path: string): "line" | "ball" {
  const v = str(obj, "attitudeStyle", path);
  if (!ATTITUDE_STYLES.includes(v as (typeof ATTITUDE_STYLES)[number])) {
    throw new Error(`${path}.attitudeStyle must be one of: ${ATTITUDE_STYLES.join(", ")}`);
  }
  return v as "line" | "ball";
}

const MODEL_KINDS: readonly ModelKind[] = ["fixed-wing", "rotor"];

/** Absent means "fixed-wing" — every existing param file predates this field (#30). */
function modelKind(obj: Record<string, unknown>, path: string): ModelKind {
  if (obj.modelKind === undefined) return "fixed-wing";
  const v = str(obj, "modelKind", path);
  if (!MODEL_KINDS.includes(v as ModelKind)) {
    throw new Error(`${path}.modelKind must be one of: ${MODEL_KINDS.join(", ")}`);
  }
  return v as ModelKind;
}

function rotorParams(raw: unknown, path: string): RotorParams {
  const o = asRecord(raw, path);
  return {
    maxThrustN: positive(o, "maxThrustN", path),
    rollRateMaxRadS: positive(o, "rollRateMaxRadS", path),
    pitchRateMaxRadS: positive(o, "pitchRateMaxRadS", path),
    yawRateMaxRadS: positive(o, "yawRateMaxRadS", path),
    rollDampingPerS: positive(o, "rollDampingPerS", path),
    pitchDampingPerS: positive(o, "pitchDampingPerS", path),
    yawDampingPerS: positive(o, "yawDampingPerS", path),
    dragPerVelocity: positive(o, "dragPerVelocity", path),
  };
}

function flapDetent(raw: unknown, index: number): FlapDetent {
  const path = `flaps[${index}]`;
  const o = asRecord(raw, path);
  return {
    label: str(o, "label", path),
    dCL0: num(o, "dCL0", path),
    dStallAlphaRad: num(o, "dStallAlphaRad", path),
    dCD0: num(o, "dCD0", path),
  };
}

export function validateClassParams(raw: unknown): ClassParams {
  const o = asRecord(raw, "params");

  // Top-level scalar fields are checked before descending into nested objects, so a params
  // blob missing (say) `label` reports "label" rather than failing on the first nested
  // object it happens to also be missing (e.g. `aero`).
  const id = str(o, "id", "params");
  const label = str(o, "label", "params");
  const modelNote = str(o, "modelNote", "params");
  const kind = modelKind(o, "params");
  // Required exactly when the class flies the rotor model — a rotor class missing its tuning
  // data, or a fixed-wing class carrying a stray rotor block, is a params-file bug, not data.
  if (kind === "rotor" && o.rotor === undefined) {
    throw new Error('params.rotor is required when modelKind is "rotor"');
  }
  if (kind === "fixed-wing" && o.rotor !== undefined) {
    throw new Error('params.rotor must be omitted when modelKind is "fixed-wing"');
  }
  const rotor = o.rotor === undefined ? undefined : rotorParams(o.rotor, "params.rotor");
  const massKg = positive(o, "massKg", "params");
  const wingAreaM2 = positive(o, "wingAreaM2", "params");
  const wingSpanM = positive(o, "wingSpanM", "params");
  const aspectRatio = positive(o, "aspectRatio", "params");

  if (!Array.isArray(o.flaps) || o.flaps.length === 0) {
    throw new Error("params.flaps must be a non-empty array");
  }
  const gear = str(o, "gear", "params");
  if (gear !== "fixed" && gear !== "retractable") {
    throw new Error('params.gear must be "fixed" or "retractable"');
  }

  const aero = asRecord(o.aero, "params.aero");
  const control = asRecord(o.control, "params.control");
  const propulsion = asRecord(o.propulsion, "params.propulsion");
  const limits = asRecord(o.limits, "params.limits");
  const display = asRecord(o.display, "params.display");
  const lookArc = asRecord(o.lookArc, "params.lookArc");

  return {
    id,
    label,
    modelNote,
    modelKind: kind,
    ...(rotor === undefined ? {} : { rotor }),
    massKg,
    wingAreaM2,
    wingSpanM,
    aspectRatio,
    aero: {
      cl0: num(aero, "cl0", "params.aero"),
      clAlphaPerRad: positive(aero, "clAlphaPerRad", "params.aero"),
      stallAlphaRad: positive(aero, "stallAlphaRad", "params.aero"),
      postStallDecayRad: positive(aero, "postStallDecayRad", "params.aero"),
      cd0: positive(aero, "cd0", "params.aero"),
      // num(), not positive(): the C172 ships gearDragCd0 = 0 (fixed-gear drag is already in
      // cd0), and positive() would reject that zero.
      gearDragCd0: num(aero, "gearDragCd0", "params.aero"),
      // num(), not positive(): a class with no airbrake ships speedbrakeCd0 = 0 (#51).
      speedbrakeCd0: num(aero, "speedbrakeCd0", "params.aero"),
      oswaldE: positive(aero, "oswaldE", "params.aero"),
      cyBeta: num(aero, "cyBeta", "params.aero"),
    },
    control: {
      rollRateMaxRadS: positive(control, "rollRateMaxRadS", "params.control"),
      pitchRateMaxRadS: positive(control, "pitchRateMaxRadS", "params.control"),
      yawRateMaxRadS: positive(control, "yawRateMaxRadS", "params.control"),
      rollDampingPerS: positive(control, "rollDampingPerS", "params.control"),
      pitchDampingPerS: positive(control, "pitchDampingPerS", "params.control"),
      yawDampingPerS: positive(control, "yawDampingPerS", "params.control"),
      pitchStiffnessPerS2: positive(control, "pitchStiffnessPerS2", "params.control"),
      yawStiffnessPerS2: positive(control, "yawStiffnessPerS2", "params.control"),
      refDynamicPressurePa: positive(control, "refDynamicPressurePa", "params.control"),
      trimAlphaCenterRad: num(control, "trimAlphaCenterRad", "params.control"),
      trimAlphaRangeRad: positive(control, "trimAlphaRangeRad", "params.control"),
    },
    propulsion: {
      maxPowerW: positive(propulsion, "maxPowerW", "params.propulsion"),
      lapseModel: lapseModel(propulsion, "params.propulsion"),
      propEfficiency: positive(propulsion, "propEfficiency", "params.propulsion"),
      propPeakSpeedMs: positive(propulsion, "propPeakSpeedMs", "params.propulsion"),
      afterburnerFactor: positive(propulsion, "afterburnerFactor", "params.propulsion"),
      // Optional per-class turbofan flat-rating overrides. Absent → left undefined, and
      // turbofanPowerLapse falls back to the shared TURBOFAN_CORNER_M / TURBOFAN_LAPSE_EXP
      // defaults (b738/f5e omit these, so their behavior is unchanged). If present, they must
      // be finite numbers — a typo must not silently become a NaN corner altitude.
      ...(propulsion.turbofanCornerM === undefined
        ? {}
        : { turbofanCornerM: positive(propulsion, "turbofanCornerM", "params.propulsion") }),
      ...(propulsion.turbofanLapseExp === undefined
        ? {}
        : { turbofanLapseExp: positive(propulsion, "turbofanLapseExp", "params.propulsion") }),
      // Optional per-class turboprop flat-rating overrides, mirroring the turbofan pair above.
      // Absent → left undefined, and turbopropPowerLapse falls back to the shared TURBOPROP_CORNER_M /
      // TURBOPROP_LAPSE_EXP defaults. Only read when lapseModel="turboprop".
      ...(propulsion.turbopropCornerM === undefined
        ? {}
        : { turbopropCornerM: positive(propulsion, "turbopropCornerM", "params.propulsion") }),
      ...(propulsion.turbopropLapseExp === undefined
        ? {}
        : { turbopropLapseExp: positive(propulsion, "turbopropLapseExp", "params.propulsion") }),
    },
    limits: {
      vneIasMs: positive(limits, "vneIasMs", "params.limits"),
      vnoIasMs: positive(limits, "vnoIasMs", "params.limits"),
      vfeIasMs: positive(limits, "vfeIasMs", "params.limits"),
      gLimitPos: positive(limits, "gLimitPos", "params.limits"),
      gLimitNeg: num(limits, "gLimitNeg", "params.limits"),
      serviceCeilingM: positive(limits, "serviceCeilingM", "params.limits"),
      mmo: positive(limits, "mmo", "params.limits"),
      vleIasMs: positive(limits, "vleIasMs", "params.limits"),
    },
    flaps: o.flaps.map(flapDetent),
    gear,
    display: {
      asiMinKt: positive(display, "asiMinKt", "params.display"),
      asiMaxKt: positive(display, "asiMaxKt", "params.display"),
      attitudeStyle: attitudeStyle(display, "params.display"),
    },
    lookArc: {
      yawDeg: positive(lookArc, "yawDeg", "params.lookArc"),
      pitchUpDeg: positive(lookArc, "pitchUpDeg", "params.lookArc"),
      pitchDownDeg: positive(lookArc, "pitchDownDeg", "params.lookArc"),
    },
    sources: asRecord(o.sources, "params.sources") as Record<string, string>,
  };
}

let cached: ClassParams | null = null;

/** The C172S piston class. */
export function loadC172(): ClassParams {
  if (cached === null) cached = validateClassParams(c172Raw);
  return cached;
}

let cachedB738: ClassParams | null = null;

/** The 737-800 airliner class (own cache; validated through the same shared validator). */
export function loadB738(): ClassParams {
  if (cachedB738 === null) cachedB738 = validateClassParams(b738Raw);
  return cachedB738;
}

let cachedF5e: ClassParams | null = null;

/** The F-5E fighter class (own cache; validated through the same shared validator). */
export function loadF5e(): ClassParams {
  if (cachedF5e === null) cachedF5e = validateClassParams(f5eRaw);
  return cachedF5e;
}

let cachedBiz: ClassParams | null = null;

/** The Citation-class business-jet class (turbofan, no afterburner). */
export function loadBiz(): ClassParams {
  if (cachedBiz === null) cachedBiz = validateClassParams(bizRaw);
  return cachedBiz;
}

let cachedTprop: ClassParams | null = null;

/** The King Air-class turboprop class (power-limited prop, turbine altitude lapse). */
export function loadTprop(): ClassParams {
  if (cachedTprop === null) cachedTprop = validateClassParams(tpropRaw);
  return cachedTprop;
}

let cachedR44: ClassParams | null = null;

/** The R44-class light piston helicopter (rotor model — see sim/rotorForces.ts). */
export function loadR44(): ClassParams {
  if (cachedR44 === null) cachedR44 = validateClassParams(r44Raw);
  return cachedR44;
}

let cachedT6: ClassParams | null = null;

/** The T-6 Texan II-class turboprop trainer (power-limited prop, turbine altitude lapse). */
export function loadT6(): ClassParams {
  if (cachedT6 === null) cachedT6 = validateClassParams(t6Raw);
  return cachedT6;
}

let cachedC130: ClassParams | null = null;

/** The C-130 Hercules-class heavy turboprop (power-limited prop, turbine altitude lapse). */
export function loadC130(): ClassParams {
  if (cachedC130 === null) cachedC130 = validateClassParams(c130Raw);
  return cachedC130;
}

/** Resolve a class id (from resolveClass) to its validated params. Unknown id is a bug, not data. */
export function loadClassById(id: string): ClassParams {
  switch (id) {
    case "c172s": return loadC172();
    case "b738": return loadB738();
    case "f5e": return loadF5e();
    case "biz": return loadBiz();
    case "tprop": return loadTprop();
    case "r44": return loadR44();
    case "t6": return loadT6();
    case "c130": return loadC130();
    default: throw new Error(`unknown class id: ${id}`);
  }
}
