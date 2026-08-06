/*
 * The takeover gate (spec §4). Pure, shared by the TAKE CONTROLS button's disabled state
 * and by its tooltip — the SAME predicate produces the reason string, so the button can
 * never be disabled for a reason the UI cannot name.
 *
 * Owner decision B-3: GA-class contacts only this phase. The allowlist is a data file, so
 * widening the gate is a JSON edit, not a code change.
 */
import type { Contact } from "../data/types";
import gaTypes from "../params/ga-types.json";

export const GA_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(gaTypes.designators);

/** readsb `seen_pos` can run to ~50 s; spawning on a 50-second-old position is a lie. */
export const MAX_SEEN_POS_S = 15;

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

export function checkEligibility(contact: Contact | null | undefined): EligibilityResult {
  if (!contact) return { eligible: false, reason: "NO CONTACT SELECTED" };

  if (contact.t === null) return { eligible: false, reason: "NO TYPE IN FEED" };
  if (!GA_TYPE_DESIGNATORS.has(contact.t)) {
    return { eligible: false, reason: `TYPE ${contact.t} NOT GA PISTON` };
  }
  if (contact.military) return { eligible: false, reason: "MILITARY CONTACT" };
  if (contact.alt_baro === "ground") return { eligible: false, reason: "ON GROUND" };
  if (contact.seen_pos === null || contact.seen_pos > MAX_SEEN_POS_S) {
    const age = contact.seen_pos === null ? "—" : String(contact.seen_pos);
    return { eligible: false, reason: `POSITION STALE (${age}S)` };
  }
  if (contact.alt_geom === null && contact.alt_baro === null) {
    return { eligible: false, reason: "NO ALTITUDE" };
  }
  if (contact.gs === null) return { eligible: false, reason: "NO GROUND SPEED" };
  if (contact.track === null) return { eligible: false, reason: "NO TRACK" };

  return { eligible: true };
}
