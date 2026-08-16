/*
 * Time compression (#87): scale ELAPSED WALL TIME before it reaches the fixed-step accumulator,
 * never the physics dt itself — sim/integrator.ts always advances in exact 1/60 s steps
 * regardless of the factor, so attitude integration and ground sampling are unaffected.
 * Compression just means more of those steps run per rendered frame.
 *
 * Only 1x/2x/4x are offered. Higher factors are deliberately withheld in v1: at a typical 60 fps
 * frame (~1/60 s elapsed), 4x needs ~4 steps — comfortably inside MAX_STEPS_PER_FRAME (15,
 * sim/integrator.ts) with plenty of headroom for frame-rate jitter. Beyond that the clamp starts
 * being the limiting factor rather than the player's choice: the accumulator would routinely drop
 * the excess and simRate would honestly report a shortfall instead of the requested multiple —
 * i.e. it would silently degrade instead of actually compressing. Revisit only if a reason emerges
 * to raise MAX_STEPS_PER_FRAME itself.
 */
import { ftToM } from "../sim/units";

export type TimeCompressionFactor = 1 | 2 | 4;

export const TIME_COMPRESSION_FACTORS: readonly TimeCompressionFactor[] = [1, 2, 4];

/** Elapsed wall time -> elapsed time fed to the accumulator. Physics dt itself never changes. */
export function scaleElapsed(elapsedS: number, factor: TimeCompressionFactor): number {
  return elapsedS * factor;
}

/**
 * Auto-reset height above ground (owner judgment, #87): well above any class's flareHeightFt
 * (10-40 ft, mission/profiles/*.json) so a compressed approach is always flying at 1x with time
 * to stabilize well before the flare, never surprising the player at the moment it matters most.
 * ~1000 ft is comparable to a traffic-pattern altitude — high enough that ordinary cruise rarely
 * brushes it, low enough that it fires well before a normal final approach gets serious.
 */
export const AUTO_RESET_AGL_M = ftToM(1000);

/**
 * True when compression is active and the aircraft has descended within the auto-reset floor.
 * Pure so it is unit-testable without spinning the flight loop; `terrainClearanceM === null`
 * (ground never sampled) never triggers it — an unmeasured clearance is not a proximity claim.
 */
export function shouldAutoResetCompression(
  factor: TimeCompressionFactor,
  terrainClearanceM: number | null,
  autoResetAglM: number = AUTO_RESET_AGL_M,
): boolean {
  return factor > 1 && terrainClearanceM !== null && terrainClearanceM < autoResetAglM;
}
