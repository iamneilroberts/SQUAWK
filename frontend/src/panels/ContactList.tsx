/*
 * Right-rail contact list: one row per live contact, sorted callsign-then-hex, synced
 * bidirectionally with the globe's selection via the shared store. Selecting a contact
 * reveals the TAKE CONTROLS button, enabled only when checkEligibility passes; when
 * disabled, its tooltip and the label beneath it name the failing gate.
 */
import { useStore } from "../state/store";
import type { Contact } from "../data/types";
import { checkEligibility } from "../takeover/eligibility";
import { saveProvisionalBriefing } from "../auth/session";

/**
 * Sorts by `flight ?? ""` via `localeCompare`, hex as tiebreaker. Contacts with no
 * callsign compare as the empty string, which sorts *before* any lettered callsign —
 * so unidentified contacts appear first, not last.
 */
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

/**
 * The prompt shown where the TAKE CONTROLS button will appear, so it's obvious a contact must
 * be picked first — the flow is not discoverable on touch, where nothing else says "tap a plane"
 * (issue: mobile take-controls discoverability). Null once one is selected (the button replaces
 * it) or when the list is empty (the NO CONTACTS line already explains the blank). Wording is
 * device-neutral — "select" covers both a tap and a click.
 */
export function selectionHint(selectedHex: string | null, rowCount: number): string | null {
  if (selectedHex !== null) return null;
  if (rowCount === 0) return null;
  return "SELECT A CONTACT TO TAKE CONTROLS";
}

export default function ContactList({
  authenticated = false,
  onSignInRequired,
}: {
  authenticated?: boolean;
  onSignInRequired?: (aircraftHex: string) => void;
}) {
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const feedStatus = useStore((s) => s.feedStatus);
  const select = useStore((s) => s.select);

  const rows = sortContacts(Array.from(contacts.values()));
  const selected = selectedHex === null ? null : contacts.get(selectedHex) ?? null;
  const eligibility = checkEligibility(selected);
  const hint = selectionHint(selectedHex, rows.length);

  return (
    <div className="panel flex h-full flex-col">
      <div className="label px-2 py-1">Contacts</div>

      <div className="flex-1 overflow-y-auto min-h-0">
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

      {selectedHex !== null ? (
        <div className="p-2">
          <button
            disabled={!eligibility.eligible}
            title={eligibility.eligible ? "Take controls of this contact" : eligibility.reason}
            className={eligibility.eligible ? "control-button w-full" : "control-button-disabled w-full"}
            onClick={() => {
              // Freeze the snapshot NOW: applyFetch nulls selectedHex the moment the
              // contact leaves the feed, and the origin must survive that (spec §4).
              if (!eligibility.eligible || selected === null) return;
              if (!authenticated) {
                try {
                  saveProvisionalBriefing(sessionStorage, { aircraftHex: selected.hex });
                } catch {
                  // Sign-in can continue without restorable provisional state.
                }
                onSignInRequired?.(selected.hex);
                return;
              }
              useStore.getState().setOrigin({ hex: selected.hex, snapshot: { ...selected } });
              useStore.getState().fire("TAKE_CONTROLS");
            }}
          >
            TAKE CONTROLS
          </button>
          {!eligibility.eligible && <div className="label takeover-reason">{eligibility.reason}</div>}
        </div>
      ) : hint !== null ? (
        <div className="p-2">
          <div className="label contact-select-hint">{hint}</div>
        </div>
      ) : null}
    </div>
  );
}
