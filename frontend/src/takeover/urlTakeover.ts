/*
 * Deep-link takeover (LORAN → adsb-game): the pure half.
 *
 * Protocol (fixed contract, the LORAN side is built to match):
 *   https://adsb.voygent.app/?takeover=<hex>
 * where <hex> is the lowercase ICAO 24-bit hex of an aircraft currently on the live feed.
 * On load the app auto-selects that contact and takes control of it (see useUrlTakeover.ts
 * for the browser wiring). This module is the pure, unit-testable decision layer — it never
 * touches the DOM, the store, or history; it only parses the param and turns a (contact,
 * eligibility) pair into either a take-now decision or an honest fallback message.
 *
 * Honesty rule #1 holds here as everywhere: we NEVER synthesize a contact to force a
 * takeover. The only sanctioned synthesized object is the player's SIM aircraft, and that is
 * produced solely by the real eligible-takeover path (setOrigin → TAKE_CONTROLS). If the hex
 * is absent from the feed or ineligible, we fall back to BROWSE and say why.
 */
import type { Contact } from "../data/types";
import type { EligibilityResult } from "./eligibility";

/** An ICAO 24-bit address is exactly six hex digits. */
const ICAO_HEX = /^[0-9a-f]{6}$/;

/**
 * Parse and normalize the `takeover` URL param from a `location.search` string.
 *
 * Returns the lowercased hex when the param is a well-formed ICAO 24-bit address (six hex
 * digits, case-insensitive, surrounding whitespace tolerated), or null when the param is
 * missing, empty, or garbage. Being strict here is the honest choice: a malformed hex can
 * never match a real feed contact, so we reject it up front rather than wait out a timeout.
 */
export function parseTakeoverHex(search: string): string | null {
  const raw = new URLSearchParams(search).get("takeover");
  if (raw === null) return null;
  const hex = raw.trim().toLowerCase();
  return ICAO_HEX.test(hex) ? hex : null;
}

/**
 * The "ready to take over" decision for the current feed snapshot. Given the contact looked up
 * by the target hex (or null/undefined when it is not on the feed yet) and its eligibility from
 * checkEligibility, say whether to take now, keep waiting, or that it is present-but-ineligible.
 *
 *   - absent      → the hex is not on the feed this poll; the caller keeps waiting until timeout.
 *   - ineligible  → present but a physical gate refuses it (on ground, stale, …); keep waiting in
 *                   case it becomes eligible (a taxiing plane takes off), fall back at timeout.
 *   - take        → present and eligible; perform the real ContactList take-control sequence.
 */
export type TakeoverStep =
  | { status: "absent" }
  | { status: "ineligible"; reason: string }
  | { status: "take"; contact: Contact };

export function evaluateTakeover(
  contact: Contact | null | undefined,
  eligibility: EligibilityResult,
): TakeoverStep {
  if (!contact) return { status: "absent" };
  if (eligibility.eligible) return { status: "take", contact };
  return { status: "ineligible", reason: eligibility.reason };
}

/**
 * The honest fallback message shown when the deep-link takeover could not be performed within
 * the wait window. Names the reason in LORAN's uppercase terminal register: whether the target
 * never appeared on the feed, or appeared but was ineligible (with the failing gate's reason).
 * The hex is echoed in upper case to match the rest of the HUD/annunciator vocabulary.
 */
export function takeoverFallbackMessage(
  hex: string,
  contact: Contact | null | undefined,
  eligibility: EligibilityResult,
): string {
  const label = hex.toUpperCase();
  if (!contact) return `TAKEOVER TARGET ${label} NOT IN FEED`;
  if (!eligibility.eligible) return `TAKEOVER TARGET ${label} INELIGIBLE — ${eligibility.reason}`;
  // Defensive: a caller should not ask for a fallback message on an eligible contact, but if it
  // does, stay honest rather than invent a refusal reason.
  return `TAKEOVER TARGET ${label} READY`;
}
