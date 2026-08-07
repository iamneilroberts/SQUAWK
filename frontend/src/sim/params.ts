/*
 * Parameter files are data, not code — so they get validated once, loudly, at load time
 * rather than producing NaN somewhere inside the integrator three seconds into a flight.
 * A hand-written validator (not a schema library) keeps the dependency list untouched.
 */
import type { ClassParams, FlapDetent, LapseModel } from "./types";
import c172Raw from "../params/c172.json";
import b738Raw from "../params/b738.json";

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
const LAPSE_MODELS: readonly LapseModel[] = ["piston", "none", "turbofan"];

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

  return {
    id,
    label,
    modelNote,
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
    },
    limits: {
      vneIasMs: positive(limits, "vneIasMs", "params.limits"),
      vnoIasMs: positive(limits, "vnoIasMs", "params.limits"),
      vfeIasMs: positive(limits, "vfeIasMs", "params.limits"),
      gLimitPos: positive(limits, "gLimitPos", "params.limits"),
      gLimitNeg: num(limits, "gLimitNeg", "params.limits"),
      serviceCeilingM: positive(limits, "serviceCeilingM", "params.limits"),
      mmo: positive(limits, "mmo", "params.limits"),
    },
    flaps: o.flaps.map(flapDetent),
    gear,
    display: {
      asiMinKt: positive(display, "asiMinKt", "params.display"),
      asiMaxKt: positive(display, "asiMaxKt", "params.display"),
      attitudeStyle: attitudeStyle(display, "params.display"),
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
