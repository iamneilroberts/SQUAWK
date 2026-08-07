/*
 * Re-sync to the real aircraft (issue #5b). Owner-approved arcade escape hatch: re-run the
 * takeover against the CURRENT live contact for the flown ICAO so the player can jump back to
 * where the genuine aeroplane actually is now.
 *
 * The honesty rule (CLAUDE.md, spec §4) is load-bearing here: if the genuine aircraft is stale,
 * off the feed or otherwise ineligible we REFUSE — we do NOT synthesize a position (owner
 * decision). This module is the pure decision: it reuses the SAME `checkEligibility` gate (and
 * its freshness rule) the initial takeover used, so re-sync can never accept a contact the
 * original takeover would have rejected, and the refusal reason is the gate's own honest string.
 *
 * Pure and Cesium-free so resync.test.ts can prove both the accept and the refuse paths without
 * a renderer; FlightSession wires the key and either calls loop.resync(spawn) or shows the reason.
 */
import type { Contact } from "../data/types";
import type { ClassParams } from "../sim/types";
import { buildSpawnState, type SpawnResult } from "./spawn";
import { checkEligibility } from "./eligibility";

export type ResyncDecision =
  | { ok: true; spawn: SpawnResult }
  | { ok: false; reason: string };

export function resyncDecision(
  contact: Contact | null | undefined,
  params: ClassParams,
  opts: { terrainHeightM: number | null },
): ResyncDecision {
  const eligibility = checkEligibility(contact);
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason };
  // checkEligibility has proven the contact is present and non-null; buildSpawnState is safe.
  const spawn = buildSpawnState(contact as Contact, params, opts);
  return { ok: true, spawn };
}
