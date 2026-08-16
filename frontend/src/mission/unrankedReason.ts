/*
 * Ranked integrity for #87's assists: SKIP TO FINAL and time compression > 1x both mean the
 * player did not fly the assigned route at real pace, so a ranked mission's result is not a fair
 * scored run. Mirrors the existing `repositioned` mechanism (spawn chooser's reposition + unranked
 * decision) rather than inventing a new one — this is the same honesty gate, generalized to name
 * ALL the reasons that applied, not just one, so the debrief message stays true to what happened.
 * Instant/anonymous flights are already unranked before this ever runs (FlightSession.tsx checks
 * those first) — this only applies to a normal locked (ranked, signed-in) mission.
 */
export type UnrankedFlags = {
  /** Spawn chooser's reposition (base/final) or SKIP TO FINAL — either way the route was skipped. */
  repositioned: boolean;
  /** Time compression > 1x was used at any point in the flight (sticky — never un-sets mid-flight). */
  timeCompressed: boolean;
};

/** Null when nothing disqualifies the flight from ranking; otherwise the honest debrief message. */
export function unrankedMessage(flags: UnrankedFlags): string | null {
  const reasons: string[] = [];
  if (flags.repositioned) reasons.push("REPOSITIONED");
  if (flags.timeCompressed) reasons.push("TIME COMPRESSION USED");
  if (reasons.length === 0) return null;
  return `${reasons.join(" + ")} — LOCAL AND UNRANKED. NO RESULT SUBMITTED.`;
}
