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
import { contactHeightM } from "../data/contactGeo";

/** Ghost billboards are dimmed, not hidden — the real aircraft is still real. */
export const GHOST_ALPHA = 0.35;

/**
 * Re-exported so the globe layer still has one import for everything billboard-shaped. It now
 * LIVES in data/contactGeo.ts, which is Cesium-free, because dashboard/trafficProjection.ts
 * applies the same datum rule and must not import a module that pulls in Cesium.
 */
export { contactHeightM } from "../data/contactGeo";

/** The subset of contacts that can be placed in 3D. */
export function renderableContacts(contacts: Map<string, Contact>): Map<string, Contact> {
  const out = new Map<string, Contact>();
  for (const [hex, c] of contacts) {
    if (contactHeightM(c) !== null) out.set(hex, c);
  }
  return out;
}

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
  opts: { ghostHex?: string | null } = {},
): void {
  const drawable = renderableContacts(contacts);
  const { added, removed, kept } = diffContacts(new Set(byHex.keys()), drawable);
  const ghostHex = opts.ghostHex ?? null;

  for (const hex of removed) {
    const bb = byHex.get(hex);
    if (bb) collection.remove(bb);
    byHex.delete(hex);
  }

  for (const hex of added) {
    const c = drawable.get(hex)!;
    const bb = collection.add({
      id: hex,
      position: Cartesian3.fromDegrees(c.lon, c.lat, contactHeightM(c)!),
      rotation: contactRotationRad(c.track),
      color: hex === ghostHex ? Color.WHITE.withAlpha(GHOST_ALPHA) : Color.WHITE,
      scale: scaleFor(hex, selectedHex),
    });
    applyIcon(bb, c);
    byHex.set(hex, bb);
  }

  for (const hex of kept) {
    const c = drawable.get(hex)!;
    const bb = byHex.get(hex)!;
    bb.position = Cartesian3.fromDegrees(c.lon, c.lat, contactHeightM(c)!);
    bb.rotation = contactRotationRad(c.track);
    applyIcon(bb, c); // cheap no-op unless the contact's color actually changed
    bb.scale = scaleFor(hex, selectedHex);
    // The origin aircraft keeps flying on the live feed, dimmed — it is still real.
    bb.color = hex === ghostHex ? Color.WHITE.withAlpha(GHOST_ALPHA) : Color.WHITE;
  }
}
