/*
 * Right-rail ship list: one row per live AIS contact, sorted name-then-mmsi, synced
 * bidirectionally with the globe's ship selection via the shared store. Mirrors
 * ContactList's layout and em-dash-for-null honesty.
 */
import { useStore } from "../state/store";
import type { ShipContact } from "../data/types";

/**
 * Sorts by `name ?? ""` via `localeCompare`, mmsi as tiebreaker. Ships with no name
 * compare as the empty string, which sorts *before* any lettered name — so unnamed
 * ships appear first, not last.
 */
export function sortShips(ships: ShipContact[]): ShipContact[] {
  return [...ships].sort((a, b) => {
    const ka = a.name ?? "";
    const kb = b.name ?? "";
    return ka !== kb ? ka.localeCompare(kb) : a.mmsi.localeCompare(b.mmsi);
  });
}

export function formatSog(s: ShipContact): string {
  return s.sog === null ? "—" : `${s.sog} KT`;
}

export function formatNavStatus(s: ShipContact): string {
  return s.nav_status ?? "—";
}

export default function ShipList() {
  const ships = useStore((s) => s.ships);
  const selectedMmsi = useStore((s) => s.selectedMmsi);
  const shipFeedStatus = useStore((s) => s.shipFeedStatus);
  const selectShip = useStore((s) => s.selectShip);

  const rows = sortShips(Array.from(ships.values()));

  return (
    <div className="panel flex h-full flex-col">
      <div className="label px-2 py-1">Ships {ships.size}</div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="label p-2">NO SHIPS — {shipFeedStatus.toUpperCase()}</div>
        ) : (
          rows.map((s) => (
            <div
              key={s.mmsi}
              onClick={() => selectShip(s.mmsi)}
              className={
                "contact-row" + (s.mmsi === selectedMmsi ? " contact-row-selected" : "")
              }
            >
              <span className="contact-cell-id">{s.name ?? "—"}</span>
              <span className="contact-cell-id">{s.ship_type ?? "—"}</span>
              <span className="contact-cell-num">{formatSog(s)}</span>
              <span className="contact-cell-num">{formatNavStatus(s)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
