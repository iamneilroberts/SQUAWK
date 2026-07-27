/*
 * Right-rail contact list: one row per live contact, sorted callsign-then-hex, synced
 * bidirectionally with the globe's selection via the shared store. Selecting a contact
 * reveals the disabled TAKE CONTROLS button — honestly inert until Phase C.
 */
import { useStore } from "../state/store";
import type { Contact } from "../data/types";

/** Callsign first (contacts without one sort after those with one), hex as tiebreaker. */
export function sortContacts(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const ka = a.flight ?? "";
    const kb = b.flight ?? "";
    return ka !== kb ? ka.localeCompare(kb) : a.hex.localeCompare(b.hex);
  });
}

export function formatAlt(c: Contact): string {
  if (c.alt_baro === "ground") return "GND";
  const alt = c.alt_geom ?? c.alt_baro;
  return alt === null ? "—" : `${alt} FT`;
}

export function formatGs(c: Contact): string {
  return c.gs === null ? "—" : `${c.gs} KT`;
}

export default function ContactList() {
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const feedStatus = useStore((s) => s.feedStatus);
  const select = useStore((s) => s.select);

  const rows = sortContacts(Array.from(contacts.values()));

  return (
    <div className="panel flex h-full flex-col">
      <div className="label px-2 py-1">Contacts</div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="label p-2">NO CONTACTS — {feedStatus.toUpperCase()}</div>
        ) : (
          rows.map((c) => (
            <div
              key={c.hex}
              onClick={() => select(c.hex)}
              className={
                "contact-row" +
                (c.military ? " contact-row-military" : "") +
                (c.hex === selectedHex ? " contact-row-selected" : "")
              }
            >
              <span className="contact-cell-id">{c.flight ?? "—"}</span>
              <span className="contact-cell-id">{c.t ?? "—"}</span>
              <span className="contact-cell-num">{formatAlt(c)}</span>
              <span className="contact-cell-num">{formatGs(c)}</span>
            </div>
          ))
        )}
      </div>

      {selectedHex !== null && (
        <div className="p-2">
          <button disabled title="Phase C" className="control-button-disabled w-full">
            TAKE CONTROLS
          </button>
        </div>
      )}
    </div>
  );
}
