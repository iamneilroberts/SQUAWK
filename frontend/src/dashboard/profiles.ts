/*
 * The class -> dashboard-profile registry (unified-glass redesign). This is DATA, exactly like
 * sim/params.ts::loadClassById: a class id resolves to a profile by a table lookup, never by an
 * `if (class === "...")` branch in render code. Adding a class is one row here, not a new code
 * path. The render side (UnifiedGlass) maps `primary` -> component through its own data table,
 * so no component ever asks "which class am I?".
 *
 * `background` is the seam for the DEFERRED realistic-dashboard art pass: it is a plain CSS
 * background value applied to the primary region. It is "transparent" for every profile now
 * (LORAN vector language only); the later art pass swaps in a per-profile texture/gradient here
 * and nowhere else, so the functional layout below never has to change to gain a skin.
 */

/** Which primary flight display a class flies. Each maps to a component in UnifiedGlass. */
export type PrimaryKind = "sixpack" | "efis" | "hud";

export type DashboardProfile = {
  /** The class id this profile serves after resolveClass has returned `supported: true`. */
  classId: string;
  /** The primary flight instrument layout. */
  primary: PrimaryKind;
  /** Realistic-art seam: a CSS background for the primary region. "transparent" until the art pass. */
  background: string;
};

/**
 * The registry. Four basic profiles for the four flight models. Order is documentation only;
 * lookups are by key. Realistic/skeuomorphic backgrounds are DEFERRED — `background` stays
 * "transparent" (the LORAN vector look) and is the single place the art pass will touch.
 */
const PROFILES: Record<string, DashboardProfile> = {
  c172s: { classId: "c172s", primary: "sixpack", background: "transparent" },
  b738: { classId: "b738", primary: "efis", background: "transparent" },
  f5e: { classId: "f5e", primary: "hud", background: "transparent" },
  biz: { classId: "biz", primary: "efis", background: "transparent" },
  tprop: { classId: "tprop", primary: "sixpack", background: "transparent" },
  r44: { classId: "r44", primary: "sixpack", background: "transparent" },
};

/** Every class id the registry knows — for tests and iteration, never a branch. */
export const DASHBOARD_PROFILE_IDS: readonly string[] = Object.keys(PROFILES);

/**
 * Resolve a class id to its dashboard profile. Unknown id is a bug (a class shipped params but
 * no profile), not data — so it throws, mirroring sim/params.ts::loadClassById.
 */
export function profileForClass(classId: string): DashboardProfile {
  const profile = PROFILES[classId];
  if (profile === undefined) {
    throw new Error(`no dashboard profile for class id: ${classId}`);
  }
  return profile;
}
