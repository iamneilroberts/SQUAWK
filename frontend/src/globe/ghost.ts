/*
 * The ghost (owner decision B-4, ground rule 2 taken literally): after takeover the REAL
 * aircraft keeps polling and keeps rendering, dimmed, with an honest staleness label — so
 * the player watches their synthetic flight diverge from the real one.
 *
 * The label never claims freshness it does not have: an age is shown only when the feed
 * itself is LIVE and the contact reported a position age. Otherwise it reads NO DATA.
 */
import { Cartesian2, Color, LabelStyle, VerticalOrigin, type Label, type LabelCollection } from "cesium";
import { Cartesian3 } from "cesium";
import type { Contact, FeedStatus } from "../data/types";
import { contactHeightM } from "./contactBillboards";

/**
 * Re-exported so callers have one import for everything ghost-shaped. It LIVES in
 * contactBillboards.ts — that is the module that applies it to a billboard — and importing
 * it in this direction keeps the dependency acyclic (ghost -> contactBillboards, never back).
 */
export { GHOST_ALPHA } from "./contactBillboards";

export function ghostLabelText(contact: Contact | undefined, feedStatus: FeedStatus): string {
  if (!contact || feedStatus !== "live" || contact.seen_pos === null) return "GHOST · NO DATA";
  return `GHOST · AGE ${Math.round(contact.seen_pos)}S`;
}

/** Create, move or remove the single ghost label. Mutated in place, never rebuilt. */
export function syncGhostLabel(
  labels: LabelCollection,
  ref: { label: Label | null },
  contact: Contact | undefined,
  feedStatus: FeedStatus,
): void {
  const height = contact ? contactHeightM(contact) : null;
  if (!contact || height === null) {
    if (ref.label) {
      labels.remove(ref.label);
      ref.label = null;
    }
    return;
  }
  const position = Cartesian3.fromDegrees(contact.lon, contact.lat, height);
  const text = ghostLabelText(contact, feedStatus);
  if (ref.label === null) {
    ref.label = labels.add({
      position,
      text,
      font: "11px monospace",
      fillColor: Color.fromCssColorString("#ffb000").withAlpha(0.8),
      style: LabelStyle.FILL,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -18),
    });
    return;
  }
  ref.label.position = position;
  ref.label.text = text;
}
