/*
 * The takeover gate (spec §4). Pure, shared by the TAKE CONTROLS button's disabled state
 * and by its tooltip — the SAME predicate produces the reason string, so the button can
 * never be disabled for a reason the UI cannot name.
 *
 * Class resolution: every contact resolves to a flight model (fighter → f5e, airliner →
 * b738, GA → c172s; unknown/missing/unmatched → c172s), and the substitution is disclosed
 * on the handoff card rather than silently defaulted. Type and military status are no
 * longer refusals — only the physical gates below can refuse a takeover.
 */
import type { Contact } from "../data/types";
import type { ClassParams } from "../sim/types";
import { EM_DASH } from "../hud/format";
import gaTypes from "../params/ga-types.json";
import airlinerTypes from "../params/airliner-types.json";
import fighterTypes from "../params/fighter-types.json";

export const GA_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(gaTypes.designators);
export const AIRLINER_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(airlinerTypes.designators);
export const FIGHTER_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(fighterTypes.designators);

/** readsb `seen_pos` can run to ~50 s; spawning on a 50-second-old position is a lie. */
export const MAX_SEEN_POS_S = 15;

export type ClassResolution = { classId: string; matched: boolean };

/**
 * Which flight model a contact flies, inferred from its real ICAO type designator (spec §4).
 * Fighter → f5e, airliner → b738, GA → c172s; unknown / missing / unmatched → c172s (the
 * substitution is disclosed on the handoff card, never silent). Military is NOT a refusal here:
 * a military fast-jet resolves to f5e, an unmatched military type falls to the c172s default.
 */
export function resolveClass(contact: Contact): ClassResolution {
  const t = contact.t;
  if (t !== null) {
    if (FIGHTER_TYPE_DESIGNATORS.has(t)) return { classId: "f5e", matched: true };
    if (AIRLINER_TYPE_DESIGNATORS.has(t)) return { classId: "b738", matched: true };
    if (GA_TYPE_DESIGNATORS.has(t)) return { classId: "c172s", matched: true };
  }
  return { classId: "c172s", matched: false };
}

/** The handoff card's disclosure: REAL TYPE → MODEL, flagged when no class matched. */
export function disclosureLine(contact: Contact, params: ClassParams, matched: boolean): string {
  const real = contact.t ?? EM_DASH;
  return `${real} → ${params.modelNote}${matched ? "" : " (NO MATCHING CLASS)"}`;
}

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

/**
 * The PHYSICAL gates only (spec §4): a contact that cannot be honestly spawned is refused.
 * Type is no longer a refusal — every type resolves to some class (disclosed). Military is no
 * longer a refusal — the F-5E is military. The button's disabled state and its tooltip share
 * this one predicate, so the button can never be disabled for a reason the UI cannot name.
 */
export function checkEligibility(contact: Contact | null | undefined): EligibilityResult {
  if (!contact) return { eligible: false, reason: "NO CONTACT SELECTED" };
  if (contact.alt_baro === "ground") return { eligible: false, reason: "ON GROUND" };
  if (contact.seen_pos === null || contact.seen_pos > MAX_SEEN_POS_S) {
    const age = contact.seen_pos === null ? EM_DASH : String(contact.seen_pos);
    return { eligible: false, reason: `POSITION STALE (${age}S)` };
  }
  if (contact.alt_geom === null && contact.alt_baro === null) {
    return { eligible: false, reason: "NO ALTITUDE" };
  }
  if (contact.gs === null) return { eligible: false, reason: "NO GROUND SPEED" };
  if (contact.track === null) return { eligible: false, reason: "NO TRACK" };
  return { eligible: true };
}
