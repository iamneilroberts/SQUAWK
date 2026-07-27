/*
 * In-place billboard sync for the browse globe.
 *
 * Same lesson as LORAN's aircraftLayer.ts: billboards are reused across frames, keyed by
 * ICAO hex, and only added/removed when the contact set actually changes. Everything else
 * (position/rotation/color/scale) is mutated on the existing primitive.
 */
import { Billboard, BillboardCollection, Cartesian3, Color } from "cesium";
import type { Contact } from "../data/types";
import { contactColor, contactRotationRad, makeChevronCanvas } from "./icons";

/** Pure set/map partition: what to add, remove, and leave in place. Tested without Cesium. */
export function diffContacts(
  prev: Set<string>,
  next: Map<string, Contact>,
): { added: string[]; removed: string[]; kept: string[] } {
  const added: string[] = [];
  const kept: string[] = [];
  for (const hex of next.keys()) {
    if (prev.has(hex)) kept.push(hex);
    else added.push(hex);
  }
  const removed: string[] = [];
  for (const hex of prev) {
    if (!next.has(hex)) removed.push(hex);
  }
  return { added, removed, kept };
}

function scaleFor(hex: string, selectedHex: string | null): number {
  return hex === selectedHex ? 1.4 : 1;
}

/**
 * Sync `collection` to `contacts`: add billboards for new contacts, remove ones that
 * dropped out, and mutate position/rotation/color/scale in place for the rest. Billboard
 * `id` is the hex string, so Task 7's picking can read it straight off the pick result.
 */
export function syncBillboards(
  collection: BillboardCollection,
  byHex: Map<string, Billboard>,
  contacts: Map<string, Contact>,
  selectedHex: string | null,
): void {
  const { added, removed, kept } = diffContacts(new Set(byHex.keys()), contacts);

  for (const hex of removed) {
    const bb = byHex.get(hex);
    if (bb) collection.remove(bb);
    byHex.delete(hex);
  }

  for (const hex of added) {
    const c = contacts.get(hex)!;
    const bb = collection.add({
      id: hex,
      position: Cartesian3.fromDegrees(c.lon, c.lat, 0),
      image: makeChevronCanvas(contactColor(c)),
      rotation: contactRotationRad(c.track),
      color: Color.WHITE,
      scale: scaleFor(hex, selectedHex),
    });
    byHex.set(hex, bb);
  }

  for (const hex of kept) {
    const c = contacts.get(hex)!;
    const bb = byHex.get(hex)!;
    bb.position = Cartesian3.fromDegrees(c.lon, c.lat, 0);
    bb.rotation = contactRotationRad(c.track);
    bb.color = Color.WHITE;
    bb.scale = scaleFor(hex, selectedHex);
  }
}
