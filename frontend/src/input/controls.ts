/*
 * Held-key Set -> normalized ControlVector, sampled once per physics tick.
 *
 * Three different behaviours live here on purpose:
 *  - stick axes are SPRUNG: they ramp toward the commanded deflection while a key is held
 *    and self-centre when it is released, so a digital keyboard feels like an analogue
 *    stick instead of a bang-bang switch;
 *  - throttle and trim are LEVERS: they ramp while held and stay where they were left;
 *  - flaps are a DETENT SWITCH: edge-triggered, one detent per press, which is why the
 *    sampler keeps its own memory of the previous tick's keys.
 */
import type { ClassParams, ControlVector } from "../sim/types";
import type { AnalogAxes } from "./analog";

/** Documented for the README and the HUD help line; the sampler reads the codes directly. */
export const KEYMAP: Readonly<Record<string, string>> = {
  ArrowUp: "pitch down (stick forward)",
  ArrowDown: "pitch up (stick back)",
  ArrowLeft: "roll left",
  ArrowRight: "roll right",
  KeyA: "rudder left",
  KeyD: "rudder right",
  KeyW: "throttle up",
  KeyS: "throttle down",
  Equal: "throttle up",
  Minus: "throttle down",
  NumpadAdd: "throttle up",
  NumpadSubtract: "throttle down",
  KeyF: "flaps down one detent",
  KeyV: "flaps up one detent",
  KeyG: "gear up/down",
  Comma: "trim nose down",
  Period: "trim nose up",
  KeyL: "return to level (assist)",
  KeyB: "speedbrake extend/retract",
  KeyR: "afterburner dry/wet",
  Escape: "pause",
  // Cockpit chrome, not flight controls: the sampler matches on codes and never sees these.
  // They live here so ControlsHelp can render the keymap without a second, hand-copied list.
  KeyE: "exterior / chase camera",
  KeyC: "collapse / restore the cockpit strip",
  KeyT: "tactical map show / hide",
  KeyY: "re-sync to live aircraft (assist)",
  Slash: "controls help",
};

const STICK_RATE_PER_S = 2.5; // full deflection in 0.4 s
const STICK_CENTRE_PER_S = 4.0; // springs back faster than it deflects
const THROTTLE_RATE_PER_S = 0.5; // idle to full in 2 s
const TRIM_RATE_PER_S = 0.25; // full range in 8 s — trim is a slow, deliberate control

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** One sprung axis: ramp toward `target`, or spring back to zero when target is 0. */
function stepAxis(current: number, target: number, dtS: number): number {
  if (target === 0) {
    const decay = STICK_CENTRE_PER_S * dtS;
    if (Math.abs(current) <= decay) return 0;
    return current - Math.sign(current) * decay;
  }
  const next = current + Math.sign(target) * STICK_RATE_PER_S * dtS;
  return clamp(next, -1, 1);
}

/** Cold start: centred stick, idle, flaps up, neutral trim. */
const COLD: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0, flapDetent: 0, trim: 0, gearDown: false, afterburner: false, speedbrake: false };

/**
 * `initial` is how the takeover hands over a TRIMMED, POWERED aircraft: buildSpawnState
 * works out the throttle and trim that hold the snapshot's speed, and they have to be the
 * sampler's starting position or the player inherits an idle, untrimmed aeroplane and the
 * handoff card's promise is a lie.
 */
export function createControlSampler(params: ClassParams, initial: ControlVector = COLD): {
  sample(held: ReadonlySet<string>, dtS: number, analog?: AnalogAxes): ControlVector;
  reset(): void;
} {
  let pitch = initial.pitch;
  let roll = initial.roll;
  let yaw = initial.yaw;
  let throttle = initial.throttle;
  let trim = initial.trim;
  let flapDetent = initial.flapDetent;
  let prevFlapDown = false;
  let prevFlapUp = false;
  let afterburner = initial.afterburner;
  let prevBurner = false;
  let gearDown = initial.gearDown;
  let prevGear = false;
  let speedbrake = initial.speedbrake;
  let prevBrake = false;

  return {
    sample(held, dtS, analog) {
      const axis = (neg: string, pos: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);

      // ArrowDown = stick back = nose up, so ArrowDown is the positive direction.
      pitch = stepAxis(pitch, axis("ArrowUp", "ArrowDown"), dtS);
      roll = stepAxis(roll, axis("ArrowLeft", "ArrowRight"), dtS);
      yaw = stepAxis(yaw, axis("KeyA", "KeyD"), dtS);

      const throttleDir =
        (held.has("KeyW") || held.has("Equal") || held.has("NumpadAdd") ? 1 : 0) -
        (held.has("KeyS") || held.has("Minus") || held.has("NumpadSubtract") ? 1 : 0);
      throttle = clamp(throttle + throttleDir * THROTTLE_RATE_PER_S * dtS, 0, 1);

      // Analog override (Option B, spec §6): an axis the optional analog provider drives
      // (touch stick / throttle slider, later tilt) replaces the sprung/lever value DIRECTLY,
      // bypassing the spring for that axis only. Any axis it leaves `undefined` keeps the
      // keyboard behaviour computed above — so the keyboard path is untouched when `analog`
      // is absent or empty. Assigning into the closure vars means that when the provider lets
      // go of an axis, it springs back to centre from where the analog left it (return-to-
      // centre on stick release is the keyboard spring, reused).
      if (analog) {
        if (analog.pitch !== undefined) pitch = clamp(analog.pitch, -1, 1);
        if (analog.roll !== undefined) roll = clamp(analog.roll, -1, 1);
        if (analog.yaw !== undefined) yaw = clamp(analog.yaw, -1, 1);
        if (analog.throttle !== undefined) throttle = clamp(analog.throttle, 0, 1);
      }

      const trimDir = (held.has("Period") ? 1 : 0) - (held.has("Comma") ? 1 : 0);
      trim = clamp(trim + trimDir * TRIM_RATE_PER_S * dtS, -1, 1);

      // Edge-triggered: one detent per press, however long the key is held.
      const flapDown = held.has("KeyF");
      const flapUp = held.has("KeyV");
      if (flapDown && !prevFlapDown) flapDetent = Math.min(params.flaps.length - 1, flapDetent + 1);
      if (flapUp && !prevFlapUp) flapDetent = Math.max(0, flapDetent - 1);
      prevFlapDown = flapDown;
      prevFlapUp = flapUp;

      const burnerKey = held.has("KeyR");
      if (burnerKey && !prevBurner) afterburner = !afterburner;
      prevBurner = burnerKey;

      // Speedbrake toggle (#51). Edge-triggered like gear/burner; inert where speedbrakeCd0 === 0
      // (the drag term vanishes), so no per-class gate is needed here.
      const brakeKey = held.has("KeyB");
      if (brakeKey && !prevBrake) speedbrake = !speedbrake;
      prevBrake = brakeKey;

      const gearKey = held.has("KeyG");
      if (gearKey && !prevGear && params.gear === "retractable") gearDown = !gearDown;
      prevGear = gearKey;

      return { pitch, roll, yaw, throttle, flapDetent, trim, gearDown, afterburner, speedbrake };
    },
    reset() {
      pitch = initial.pitch; roll = initial.roll; yaw = initial.yaw;
      throttle = initial.throttle; trim = initial.trim; flapDetent = initial.flapDetent;
      prevFlapDown = false; prevFlapUp = false;
      afterburner = initial.afterburner; prevBurner = false;
      gearDown = initial.gearDown; prevGear = false;
    },
  };
}
