/*
 * In-place billboard sync for AIS ship contacts — parallel to contactBillboards.ts, own
 * BillboardCollection, own icon, keyed by MMSI instead of ICAO hex. See contactBillboards.ts
 * for the full rationale on `setImage` vs. the plain `.image` setter and the per-collection
 * canvas cache; the same reasoning applies here unchanged.
 *
 * Ships add one wrinkle aircraft don't have: `lat`/`lon` can be null (a vessel seen only via
 * ShipStaticData, before any PositionReport arrives). Those are skipped entirely — no
 * billboard is created — per ground rule 1 (never render invented positions).
 */
import { Billboard, BillboardCollection, Cartesian3, Color } from "cesium";
import type { ShipContact } from "../data/types";
import { SHIP_COLOR, makeShipCanvas, shipRotationRad } from "./icons";

/** Pure set/map partition: what to add, remove, and leave in place. Tested without Cesium. */
export function diffShips(
  prev: Set<string>,
  next: Map<string, ShipContact>,
): { added: string[]; removed: string[]; kept: string[] } {
  const added: string[] = [];
  const kept: string[] = [];
  for (const mmsi of next.keys()) {
    if (prev.has(mmsi)) kept.push(mmsi);
    else added.push(mmsi);
  }
  const removed: string[] = [];
  for (const mmsi of prev) {
    if (!next.has(mmsi)) removed.push(mmsi);
  }
  return { added, removed, kept };
}

function scaleFor(mmsi: string, selectedMmsi: string | null): number {
  return mmsi === selectedMmsi ? 1.4 : 1;
}

/** Loads (or confirms) the billboard's icon. One nominal color — no military-style split. */
function applyIcon(bb: Billboard): void {
  bb.setImage(SHIP_COLOR, makeShipCanvas(SHIP_COLOR));
}

/**
 * Sync `collection` to `ships`: add billboards for new ships, remove ones that dropped out,
 * and mutate position/rotation/icon/scale in place for the rest. Billboard `id` is the MMSI
 * string, so pick handling can read it straight off the pick result. Ships with no position
 * (null lat/lon) are skipped — never added to `collection` or `byMmsi`.
 */
export function syncShipBillboards(
  collection: BillboardCollection,
  byMmsi: Map<string, Billboard>,
  ships: Map<string, ShipContact>,
  selectedMmsi: string | null,
): void {
  const { added, removed, kept } = diffShips(new Set(byMmsi.keys()), ships);

  for (const mmsi of removed) {
    const bb = byMmsi.get(mmsi);
    if (bb) collection.remove(bb);
    byMmsi.delete(mmsi);
  }

  for (const mmsi of added) {
    const s = ships.get(mmsi)!;
    if (s.lat === null || s.lon === null) continue; // no fix yet — nothing honest to draw
    const bb = collection.add({
      id: mmsi,
      position: Cartesian3.fromDegrees(s.lon, s.lat, 0),
      rotation: shipRotationRad(s.heading, s.cog),
      color: Color.WHITE, // constant tint; the icon image itself carries the ship color
      scale: scaleFor(mmsi, selectedMmsi),
    });
    applyIcon(bb);
    byMmsi.set(mmsi, bb);
  }

  for (const mmsi of kept) {
    const s = ships.get(mmsi)!;
    const bb = byMmsi.get(mmsi)!;
    if (s.lat === null || s.lon === null) continue; // defensive: kept ships always had a fix
    bb.position = Cartesian3.fromDegrees(s.lon, s.lat, 0);
    bb.rotation = shipRotationRad(s.heading, s.cog);
    applyIcon(bb); // cheap no-op — ship color never changes
    bb.scale = scaleFor(mmsi, selectedMmsi);
  }
}
