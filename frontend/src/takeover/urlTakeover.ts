/*
 * Legacy deep-link protocol from LORAN:
 *   https://fly.voygent.app/?takeover=<hex>
 *
 * Task 8 deliberately reinterprets "takeover" as "open this aircraft's provisional mission
 * briefing". A URL can never bypass the overview, authentication, or authoritative mission
 * revalidation. The pure functions here never touch browser or store state.
 */
import type { Contact } from "../data/types";

const ICAO_HEX = /^[0-9a-f]{6}$/;

export function parseTakeoverHex(search: string): string | null {
  const raw = new URLSearchParams(search).get("takeover");
  if (raw === null) return null;
  const hex = raw.trim().toLowerCase();
  return ICAO_HEX.test(hex) ? hex : null;
}

export type TakeoverStep =
  | { status: "absent" }
  | { status: "select"; contact: Contact };

export function evaluateTakeover(contact: Contact | null | undefined): TakeoverStep {
  return contact ? { status: "select", contact } : { status: "absent" };
}

export function takeoverFallbackMessage(
  hex: string,
  contact: Contact | null | undefined,
): string {
  const label = hex.toUpperCase();
  return contact
    ? `TAKEOVER TARGET ${label} BRIEFING OPENED`
    : `TAKEOVER TARGET ${label} NOT IN FEED`;
}
