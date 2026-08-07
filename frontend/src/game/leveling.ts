/*
 * Return-to-level assist (issue #5a). Owner-approved arcade escape hatch.
 *
 * The roll axis is a RATE command (forces.ts: pCmd = roll * rollRateMaxRadS * authority) with a
 * self-centring stick, so releasing the keys HOLDS the current bank — a steep bank is
 * unrecoverable-feeling on a keyboard. This is a pure proportional controller over that same
 * rate-command model: it commands a roll (and pitch) RATE proportional to the current bank (and
 * pitch) error, so the command shrinks as the error shrinks and the existing rate damping makes
 * the aeroplane EASE to level over ~2 s rather than snapping there instantly (owner decision).
 *
 * Pure and Cesium-free on purpose: it takes the current bank/pitch in radians and returns stick
 * commands in [-1, 1], so leveling.test.ts can drive it through the REAL stepAircraft and prove
 * the bank actually decays (broken-arm), with no rendering in the loop.
 */

export type LevelingParams = {
  /** Bank error (rad) at which the controller commands full opposite roll; below it, it eases. */
  refRollRad: number;
  /** Pitch error (rad) at which the controller commands full opposite pitch. */
  refPitchRad: number;
  /** Below this bank AND pitch (rad) the assist considers the aircraft level and disengages. */
  levelToleranceRad: number;
};

/**
 * C172 tuning. refRollRad ~7 deg: a bank steeper than that gets full opposite stick until it
 * decays under 7 deg, then the command eases with a ~0.17 s roll-rate time constant, which
 * together with the rate damping brings a 45 deg bank to near-level in about two seconds.
 */
export const C172_LEVELING: LevelingParams = {
  refRollRad: 0.12,
  refPitchRad: 0.12,
  levelToleranceRad: 0.02,
};

/** Auto-disengage timeout (s): a safety net if the aircraft can't reach level (owner decision). */
export const MAX_LEVELING_S = 4;

function clampStick(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * The controller: command a roll/pitch RATE opposite to the current error, clamped to the stick
 * range. Positive roll = right wing down (types.ts), so a right bank (rollRad > 0) commands a
 * negative (left) roll; positive pitch = nose up, so a nose-up attitude commands nose-down.
 */
export function levelingCommand(
  rollRad: number,
  pitchRad: number,
  params: LevelingParams,
): { roll: number; pitch: number } {
  return {
    roll: clampStick(-rollRad / params.refRollRad),
    pitch: clampStick(-pitchRad / params.refPitchRad),
  };
}

/** True once the aircraft is within tolerance of wings-level and level-pitch. */
export function isLevel(rollRad: number, pitchRad: number, params: LevelingParams): boolean {
  return (
    Math.abs(rollRad) < params.levelToleranceRad && Math.abs(pitchRad) < params.levelToleranceRad
  );
}
