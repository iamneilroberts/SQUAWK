/*
 * The takeover gate (spec §4). Pure, shared by the TAKE CONTROLS button's disabled state
 * and by its tooltip — the SAME predicate produces the reason string, so the button can
 * never be disabled for a reason the UI cannot name.
 *
 * Class resolution is explicit: fighter → f5e, airliner → b738, GA → c172s. Unknown,
 * missing, and unmatched types remain browsable but cannot start a mission.
 */
import type { Contact } from "../data/types";
import type { ClassParams } from "../sim/types";
import type { AircraftClassId } from "../mission/types";
import { EM_DASH } from "../hud/format";
import gaTypes from "../params/ga-types.json";
import airlinerTypes from "../params/airliner-types.json";
import fighterTypes from "../params/fighter-types.json";
import bizTypes from "../params/biz-types.json";

export const GA_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(gaTypes.designators);
export const AIRLINER_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(airlinerTypes.designators);
export const FIGHTER_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(fighterTypes.designators);
export const BIZ_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(bizTypes.designators);

/** readsb `seen_pos` can run to ~50 s; spawning on a 50-second-old position is a lie. */
export const MAX_SEEN_POS_S = 15;

export type ClassResolution =
  | { supported: true; classId: AircraftClassId; matched: true }
  | { supported: false; classId: null; matched: false; reason: "MISSING AIRCRAFT TYPE" | "UNSUPPORTED AIRCRAFT TYPE" };

/**
 * Which flight model a contact flies, inferred from its real ICAO type designator (spec §4).
 * Fighter → f5e, airliner → b738, GA → c172s. Military is not itself a refusal: a military
 * fast-jet resolves to f5e, while an unmatched military type is explicitly unsupported.
 */
export function resolveClass(contact: Contact): ClassResolution {
  const t = contact.t;
  if (t !== null) {
    if (FIGHTER_TYPE_DESIGNATORS.has(t)) return { supported: true, classId: "f5e", matched: true };
    if (AIRLINER_TYPE_DESIGNATORS.has(t)) return { supported: true, classId: "b738", matched: true };
    if (BIZ_TYPE_DESIGNATORS.has(t)) return { supported: true, classId: "biz", matched: true };
    if (GA_TYPE_DESIGNATORS.has(t)) return { supported: true, classId: "c172s", matched: true };
    return { supported: false, classId: null, matched: false, reason: "UNSUPPORTED AIRCRAFT TYPE" };
  }
  return { supported: false, classId: null, matched: false, reason: "MISSING AIRCRAFT TYPE" };
}

/** The handoff card's disclosure: REAL TYPE → MODEL, flagged when no class matched. */
export function disclosureLine(contact: Contact, params: ClassParams, matched: boolean): string {
  const real = contact.t ?? EM_DASH;
  return matched ? `${real} → ${params.modelNote}` : `${real} → UNSUPPORTED`;
}

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

/**
 * Physical gates shared by takeover and in-flight re-sync. Re-sync deliberately uses this
 * subset because the already-locked class does not change when a later feed row omits type data.
 */
export function checkPhysicalEligibility(contact: Contact | null | undefined): EligibilityResult {
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

/** Physical truth plus an explicit supported-class gate for starting a new mission. */
export function checkEligibility(contact: Contact | null | undefined): EligibilityResult {
  const physical = checkPhysicalEligibility(contact);
  if (!physical.eligible) return physical;
  const resolution = resolveClass(contact as Contact);
  return resolution.supported ? { eligible: true } : { eligible: false, reason: resolution.reason };
}
