/*
 * The sim's whole vocabulary. Everything here is SI and frame-explicit:
 *  - ECEF  = earth-centred, earth-fixed metres (Cesium's Cartesian3 frame).
 *  - body  = X out the nose, Y out the right wing, Z down (standard aerospace).
 *    Positive body rates: p = right wing down, q = nose up, r = nose right.
 *  - attitude is the body -> ECEF rotation, stored as a quaternion.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

/**
 * How this class's powerplant loses power with air density — data, not a code branch
 * (spec §5, CLAUDE.md). "piston" is the Gagg-Ferrar lapse a normally-aspirated engine
 * suffers; "none" is a flat-rated powerplant that holds its rated output over the altitude
 * band this sim flies. Every model here has an entry in `POWER_LAPSE_MODELS` in forces.ts,
 * and `validateClassParams` rejects any other value at load time.
 */
export type LapseModel = "piston" | "none" | "turbofan" | "turboprop";

/** ASI face style is data: C172 keeps its minimalist line horizon, jets get a filled ball. */
export type AttitudeStyle = "line" | "ball";

/** One flap detent. Deltas are applied on top of the clean aero block. */
export type FlapDetent = {
  /** HUD text, e.g. "0", "10", "20", "30" (degrees of flap). */
  label: string;
  /** Lift-curve shift at zero AoA — this is what makes flaps raise CLmax. */
  dCL0: number;
  /** Stall AoA shift (negative: flaps stall earlier). */
  dStallAlphaRad: number;
  /** Parasite drag added by the flap — flaps add drag as well as lift. */
  dCD0: number;
};

/**
 * Which force model this class flies (#30). "fixed-wing" is the lift/AoA/stall model in
 * forces.ts; "rotor" is the simplified hover-capable model in rotorForces.ts — a genuinely
 * different force shape (rotor lift does not depend on forward speed and has no stall floor),
 * not a data file on the fixed-wing shape. sim/aircraft.ts is the ONE place that reads this
 * to pick which compute-forces function runs; nothing else branches on it.
 */
export type ModelKind = "fixed-wing" | "rotor";

/**
 * Simplified rotorcraft tuning data (#30), read only by sim/rotorForces.ts. Deliberately NOT a
 * rotor-aero model: no autorotation, vortex-ring-state, ground-effect, or blade dynamics — see
 * rotorForces.ts's header comment for the full non-goals list. The bar is hover, translate, and
 * a controlled descent to landing.
 */
export type RotorParams = {
  /** Sea-level, full-collective thrust, N. Scaled by air-density ratio at altitude. */
  maxThrustN: number;
  rollRateMaxRadS: number;
  pitchRateMaxRadS: number;
  yawRateMaxRadS: number;
  rollDampingPerS: number;
  pitchDampingPerS: number;
  yawDampingPerS: number;
  /**
   * Linear drag, N per m/s of ECEF velocity (still air, so this is ground-speed too) — opposes
   * translation and descent alike. The one term keeping this model from accelerating unbounded;
   * also what makes descent rate self-limiting (a stable terminal velocity, not a runaway).
   */
  dragPerVelocity: number;
};

export type ClassParams = {
  id: string;
  /** Real type this parameter set is based on, e.g. "C172S". */
  label: string;
  /** Honest disclosure shown on the handoff card, e.g. "C172 MODEL THIS BUILD". */
  modelNote: string;
  /** Which force model this class flies. Defaults to "fixed-wing" when a params file omits it. */
  modelKind: ModelKind;
  /** Present only when modelKind === "rotor"; sim/params.ts requires it in that case. */
  rotor?: RotorParams;
  massKg: number;
  wingAreaM2: number;
  wingSpanM: number;
  aspectRatio: number;
  aero: {
    /** Lift coefficient at zero AoA. */
    cl0: number;
    clAlphaPerRad: number;
    /** AoA at which the linear lift curve reaches CLmax (clean) — the break. */
    stallAlphaRad: number;
    /**
     * Width of the post-stall fade toward flat-plate lift, in radians. Larger = softer,
     * mushier break. CLmax itself is unaffected: it is exactly cl0 + clAlpha*stallAlpha.
     */
    postStallDecayRad: number;
    /** TUNING KNOB — parasite drag. See sources.tuning. */
    cd0: number;
    /**
     * Parasitic-drag CD0 increment from extended gear. 0 for a fixed-gear class — its drag is
     * already folded into cd0, so this term must not double-count it (GR-003). Effective
     * parasitic drag is cd0 + gearDragCd0 * gearPosition (sim/forces.ts computeForces).
     */
    gearDragCd0: number;
    /**
     * Parasitic-drag CD0 increment from a fully-deployed speedbrake/spoiler. 0 for a class
     * with no airbrake (e.g. the C172), so the term vanishes with no branch. Effective
     * parasitic drag adds speedbrakeCd0 when ControlVector.speedbrake is true (#51).
     */
    speedbrakeCd0: number;
    /** TUNING KNOB — Oswald span efficiency. See sources.tuning. */
    oswaldE: number;
    /** Side-force slope per radian of sideslip (negative = restoring). */
    cyBeta: number;
  };
  control: {
    rollRateMaxRadS: number;
    pitchRateMaxRadS: number;
    yawRateMaxRadS: number;
    rollDampingPerS: number;
    pitchDampingPerS: number;
    yawDampingPerS: number;
    /** Pitch stiffness toward the trimmed AoA (1/s^2 per radian of AoA error). */
    pitchStiffnessPerS2: number;
    /** Weathercock stiffness toward zero sideslip (1/s^2 per radian). */
    yawStiffnessPerS2: number;
    /** Dynamic pressure at which controls have full authority; below this they go mushy. */
    refDynamicPressurePa: number;
    /** Trimmed AoA at trim = 0. */
    trimAlphaCenterRad: number;
    /** Trim authority: trim = ±1 shifts the trimmed AoA by ±this. */
    trimAlphaRangeRad: number;
  };
  propulsion: {
    maxPowerW: number;
    /** Which density-altitude power lapse this powerplant obeys. */
    lapseModel: LapseModel;
    /** Peak propeller efficiency, reached at and above propPeakSpeedMs. */
    propEfficiency: number;
    /**
     * Speed at which the prop reaches peak efficiency. Below it, efficiency falls off
     * linearly — which is also what caps static thrust: T -> eta*P/propPeakSpeedMs.
     */
    propPeakSpeedMs: number;
    /**
     * Dry→wet thrust multiplier when ControlVector.afterburner is true. 1.0 for any class
     * without an afterburner — a factor of 1 leaves thrustNewtons unchanged, so no branch.
     */
    afterburnerFactor: number;
    /**
     * Turbofan flat-rating corner altitude (m): full rated thrust at/below it, density lapse above.
     * Optional — omitted classes use the shared TURBOFAN_CORNER_M default (b738/f5e keep FL380).
     * A jet that cruises above the default corner (e.g. a bizjet at FL430) sets a lower corner so
     * its sea-level thrust margin — and thus climb — is realistic. Only read when lapseModel="turbofan".
     */
    turbofanCornerM?: number;
    /** Turbofan stratospheric lapse exponent. Optional; defaults to TURBOFAN_LAPSE_EXP (1.0). */
    turbofanLapseExp?: number;
    /**
     * Turboprop flat-rating corner altitude (m): full flat-rated SHAFT power at/below it, density
     * lapse above. Optional — omitted classes use the shared TURBOPROP_CORNER_M default (FL200).
     * Only read when lapseModel="turboprop" (a free-turbine turboprop holds shaft power with
     * altitude far better than a piston, so its ceiling is real; see forces.ts turbopropPowerLapse).
     */
    turbopropCornerM?: number;
    /** Turboprop stratospheric shaft-power lapse exponent. Optional; defaults to TURBOPROP_LAPSE_EXP (1.0). */
    turbopropLapseExp?: number;
  };
  limits: {
    vneIasMs: number;
    /** Max structural cruising speed — top of the ASI's green arc, bottom of the yellow. */
    vnoIasMs: number;
    /** Max flaps-extended speed — top of the ASI's white arc. */
    vfeIasMs: number;
    gLimitPos: number;
    gLimitNeg: number;
    serviceCeilingM: number;
    /** Max operating Mach. The HUD trips a Mach-overspeed annunciator past this. */
    mmo: number;
    /**
     * Max gear-extended speed, IAS m/s — named like its siblings (vneIasMs/vnoIasMs/vfeIasMs),
     * not the design spec's "vleKt": every other limits field is SI internally per CLAUDE.md, and
     * this keeps the GEAR O'SPD gate a plain iasMs comparison with no unit conversion (GR-004).
     */
    vleIasMs: number;
  };
  flaps: FlapDetent[];
  gear: "fixed" | "retractable";
  /** Per-class instrument faces — data, so no jet flies the C172's 40–180 kt gauge (spec §6). */
  display: {
    asiMinKt: number;
    asiMaxKt: number;
    attitudeStyle: AttitudeStyle;
  };
  /** Free-text provenance for every number above; displayed nowhere, read by humans. */
  sources: Record<string, string>;
};

/** Normalized control input, sampled once per physics tick. */
export type ControlVector = {
  /** [-1, 1], positive = nose up (stick back). */
  pitch: number;
  /** [-1, 1], positive = roll right. */
  roll: number;
  /** [-1, 1], positive = nose right (right rudder). */
  yaw: number;
  /** [0, 1]. */
  throttle: number;
  /** Index into ClassParams.flaps. */
  flapDetent: number;
  /** [-1, 1], elevator trim: shifts the AoA the aircraft settles at. */
  trim: number;
  /** Dry (false) / wet (true) — the F-5E's burner toggle. Ignored where afterburnerFactor is 1. */
  afterburner: boolean;
  /**
   * Commanded gear target — true = down/extended. Edge-toggled by KeyG (input/controls.ts),
   * ignored (pinned) when ClassParams.gear === "fixed". The integrated position is
   * SimState.gearPosition, not this field (GR-001).
   */
  gearDown: boolean;
  /**
   * Commanded speedbrake — true = deployed. Edge-toggled by KeyB (input/controls.ts); adds
   * ClassParams.aero.speedbrakeCd0 to parasitic drag while true. Instant (no transition state),
   * like afterburner; inert where speedbrakeCd0 === 0 (#51).
   */
  speedbrake: boolean;
};

/** Everything the physics owns. Mutated in place by stepAircraft (via a fresh object). */
export type SimState = {
  /** ECEF metres. */
  position: Vec3;
  /** ECEF m/s. */
  velocity: Vec3;
  /** body -> ECEF. */
  attitude: Quat;
  /** body rad/s: x = p (roll), y = q (pitch), z = r (yaw). */
  rates: Vec3;
  /** Seconds of sim time since spawn. */
  timeS: number;
  // ---- derived readouts, recomputed every step for the HUD and the end classifier ----
  altitudeM: number;
  tasMs: number;
  iasMs: number;
  aoaRad: number;
  sideslipRad: number;
  verticalSpeedMs: number;
  loadFactor: number;
  /** True when the g clamp had to scale lift down this step. */
  gLimited: boolean;
  /** True when |AoA| is past the stall break for the current flap setting. */
  stalled: boolean;
  /** Mach number = TAS / local speed of sound. HUD annunciator only; ASI face is unchanged. */
  machNumber: number;
  /**
   * 0 = fully retracted, 1 = fully extended. Eased toward ControlVector.gearDown over
   * GEAR_TRANSITION_S seconds by stepAircraft (sim/aircraft.ts); pinned to 1 when
   * ClassParams.gear === "fixed" (GR-001/GR-002/GR-005).
   */
  gearPosition: number;
};
