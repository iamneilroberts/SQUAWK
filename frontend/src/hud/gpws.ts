/*
 * Visual GPWS (issue #3): a sink-rate-aware ground-proximity annunciator, replacing the crude
 * fixed-500-ft floor that nagged on any level flight — including a normal final approach — below
 * that height. Pure so it is unit-testable without the flight loop; the display edge (format.ts)
 * folds its output into warningsFor so desktop and mobile share one source of truth.
 *
 * This is a simplified take on the real GPWS Mode 1 (Excessive Descent Rate) envelope: the closer
 * to the ground you are, the less descent rate is tolerated. Two amber tiers — a "SINK RATE"
 * caution and a stronger "PULL UP" — both driven by the same altitude-scaled boundaries. No pure
 * altitude floor: steady low-level flight that is not descending dangerously stays silent.
 *
 * DESIGN NOTE (owner's call, see docs/decisions.md 2026-08-14): both tiers render in the single
 * amber the design system allows. A red "PULL UP" severity colour is a design-system change and is
 * deferred to the owner.
 */
import type { HudSnapshot } from "./snapshot";
import { mToFt, msToFpm } from "../sim/units";

/*
 * Tunable envelope constants. Allowed sink rate (fpm) scales linearly with height above ground:
 *   caution  = SINK_BASE   + AGL_ft * SINK_SLOPE
 *   pull-up  = PULLUP_BASE + AGL_ft * PULLUP_SLOPE
 * Values chosen to sit above a normal stabilized approach (a 3deg airliner final descends
 * ~700 fpm near the ground, a light single far less) so the annunciator does not nag, while
 * catching a genuinely excessive descent for the height. They loosely track the real Mode 1
 * boundaries at low altitude (~1000 fpm at the surface, ~1500 fpm at 500 ft for the caution).
 * OWNER: review these against the flight model's real approach profiles before shipping widely.
 */
export const GPWS_SINK_BASE_FPM = 1000;
export const GPWS_SINK_SLOPE_FPM_PER_FT = 1.0;
export const GPWS_PULLUP_BASE_FPM = 1600;
export const GPWS_PULLUP_SLOPE_FPM_PER_FT = 1.6;
/** Above this height above ground the Mode-1 envelope is disarmed — no descent-rate warning. */
export const GPWS_ARM_ALT_FT = 2500;
/** TERRAIN UNVERIFIED is only actionable near the ground: an unknown floor at cruise cannot be
 *  struck, and at high altitude the sampler routinely can't resolve the low-detail tile under the
 *  aircraft, so the chip would nag for the whole flight. Above this MSL altitude we suppress it
 *  (the terrain-independent crash floor, #58, still guards a genuine dive). Owner call 2026-08-18. */
export const GPWS_TERRAIN_WARN_MAX_ALT_FT = 15000;

/**
 * Ground-proximity warnings, most urgent first, at most one entry. TERRAIN UNVERIFIED (we do not
 * know where the ground is) takes precedence and is never mixed with a proximity call — proximity
 * is only ever claimed against a measured clearance.
 */
export function gpwsWarningsFor(s: HudSnapshot): string[] {
  // Honest first: if the sampler has no ground height, say so and claim nothing about proximity —
  // but only while low enough for an unknown floor to matter. At cruise the chip is pure noise (and
  // the sampler often can't resolve the tile directly under a high aircraft), so suppress it there.
  if (s.terrainUnverified) {
    return mToFt(s.altitudeM) < GPWS_TERRAIN_WARN_MAX_ALT_FT ? ["TERRAIN UNVERIFIED"] : [];
  }
  if (s.terrainClearanceM === null) return [];

  const aglFt = mToFt(s.terrainClearanceM);
  if (aglFt >= GPWS_ARM_ALT_FT) return [];

  // Sink rate as a positive number of fpm; a climb or level flight is negative or zero and silent.
  const sinkFpm = -msToFpm(s.verticalSpeedMs);
  if (sinkFpm <= 0) return [];

  if (sinkFpm >= GPWS_PULLUP_BASE_FPM + aglFt * GPWS_PULLUP_SLOPE_FPM_PER_FT) return ["PULL UP"];
  if (sinkFpm >= GPWS_SINK_BASE_FPM + aglFt * GPWS_SINK_SLOPE_FPM_PER_FT) return ["SINK RATE"];
  return [];
}

/**
 * True while an active ground-proximity call (SINK RATE / PULL UP) is up — drives the amber
 * emphasis on the AGL readout. TERRAIN UNVERIFIED is excluded: that readout already reads its
 * honest em-dash, and amber-emphasising a dash would claim a proximity we cannot measure.
 */
export function groundProximityActive(s: HudSnapshot): boolean {
  return gpwsWarningsFor(s).some((w) => w === "SINK RATE" || w === "PULL UP");
}
