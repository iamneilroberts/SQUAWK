/*
 * Tactical-map display modes and the single-chip cycle between them (#67 rework). Pure so the
 * cycle is unit-tested without rendering; UnifiedGlass holds the state and applies the effects
 * (large = bigger panel, hidden = collapse to a restore tab).
 */
export type NavMode = "normal" | "large" | "hidden";

/** The chip cycles normal -> large -> hidden -> normal. */
export function nextNavMode(mode: NavMode): NavMode {
  switch (mode) {
    case "normal":
      return "large";
    case "large":
      return "hidden";
    case "hidden":
      return "normal";
  }
}

/** Chip label = the action it performs (the mode you land in), matching the HUD action-chip idiom. */
export function navModeChipLabel(mode: NavMode): string {
  switch (mode) {
    case "normal":
      return "ENLARGE";
    case "large":
      return "HIDE";
    case "hidden":
      return "SHOW";
  }
}
