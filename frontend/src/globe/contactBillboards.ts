/*
 * In-place billboard sync for the browse globe.
 *
 * Same lesson as LORAN's aircraftLayer.ts: billboards are reused across frames, keyed by
 * ICAO hex, and only added/removed when the contact set actually changes. Everything else
 * (position/rotation/color/scale) is mutated on the existing primitive.
 *
 * Color lives in the chevron's icon image (civil cyan vs. military amber), not in the
 * billboard's `.color` tint, which stays a constant white multiplier. Every kept billboard
 * calls `Billboard.setImage(colorHex, canvas)` unconditionally so a `military` flip between
 * fetches (feed failover sources can disagree on dbFlags) picks up the right icon within one
 * sync tick, rather than freezing at whatever color the contact had when its billboard was
 * first added.
 *
 * `setImage` (not the plain `.image =` setter) is what makes that unconditional call cheap:
 * per @cesium/engine's Billboard/BillboardTexture source, the plain `.image` setter mints a
 * fresh GUID for any image that isn't a string URL (a canvas has no `.src`), so reassigning it
 * every ~5s tick would re-register a "new" image with the texture atlas every time — churn,
 * not a no-op. `setImage(id, image)` instead threads our own stable id (the color hex) through,
 * and `BillboardTexture.loadImage` short-circuits (`if (this._id === id) return`) when the id
 * hasn't changed, so an unchanged color is a cheap no-op while an actual flip reloads correctly.
 * The two chevron canvases are also cached at the *collection* level
 * (`billboardTextureCache`, keyed by that same id) so every civil (or military) contact shares
 * one atlas entry, not one per billboard.
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

/** Loads (or confirms) the billboard's icon for the contact's current color. */
function applyIcon(bb: Billboard, c: Contact): void {
  const color = contactColor(c);
  bb.setImage(color, makeChevronCanvas(color));
}

/**
 * Sync `collection` to `contacts`: add billboards for new contacts, remove ones that
 * dropped out, and mutate position/rotation/icon/scale in place for the rest. Billboard
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
      rotation: contactRotationRad(c.track),
      color: Color.WHITE, // constant tint; the icon image itself carries civil/military color
      scale: scaleFor(hex, selectedHex),
    });
    applyIcon(bb, c);
    byHex.set(hex, bb);
  }

  for (const hex of kept) {
    const c = contacts.get(hex)!;
    const bb = byHex.get(hex)!;
    bb.position = Cartesian3.fromDegrees(c.lon, c.lat, 0);
    bb.rotation = contactRotationRad(c.track);
    applyIcon(bb, c); // cheap no-op unless the contact's color actually changed
    bb.scale = scaleFor(hex, selectedHex);
  }
}
