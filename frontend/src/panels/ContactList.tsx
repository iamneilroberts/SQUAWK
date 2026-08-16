/*
 * Right-rail contact list: one row per live contact, sorted callsign-then-hex, synced
 * bidirectionally with the globe's selection via the shared store. Selecting a contact opens
 * the map-first provisional MissionTray; authentication and controls live there, not in rows.
 */
import { useEffect, useRef, useState } from "react";
import { secondsSinceTrafficApplied, useStore } from "../state/store";
import type { Contact } from "../data/types";
import { checkEligibility, resolveClass } from "../takeover/eligibility";

/** How often the list re-evaluates flyability against the wall clock (piece 3). */
const AGE_TICK_MS = 5_000;

export type ContactClassFilter = "all" | "c172s" | "b738" | "f5e" | "biz" | "tprop" | "r44" | "unsupported";
export type ContactAltitudeFilter = "all" | "low" | "mid" | "high";
export type ContactEligibilityFilter = "all" | "eligible" | "ineligible";

export type ContactFilters = {
  query: string;
  classId: ContactClassFilter;
  altitude: ContactAltitudeFilter;
  eligibility: ContactEligibilityFilter;
};

function altitudeFt(contact: Contact): number | null {
  return contact.alt_geom ?? (typeof contact.alt_baro === "number" ? contact.alt_baro : null);
}

export function filterContacts(contacts: Contact[], filters: ContactFilters): Contact[] {
  const query = filters.query.trim().toLowerCase();
  return contacts.filter((contact) => {
    if (query !== "" && ![contact.flight, contact.hex, contact.t]
      .some((value) => value?.toLowerCase().includes(query))) return false;

    const resolved = resolveClass(contact);
    if (filters.classId === "unsupported" && resolved.supported) return false;
    if (filters.classId !== "all" && filters.classId !== "unsupported" &&
        (!resolved.supported || resolved.classId !== filters.classId)) return false;

    const altitude = altitudeFt(contact);
    if (filters.altitude === "low" && (altitude === null || altitude >= 5_000)) return false;
    if (filters.altitude === "mid" && (altitude === null || altitude < 5_000 || altitude >= 20_000)) return false;
    if (filters.altitude === "high" && (altitude === null || altitude < 20_000)) return false;

    const eligible = checkEligibility(contact).eligible;
    if (filters.eligibility === "eligible" && !eligible) return false;
    if (filters.eligibility === "ineligible" && eligible) return false;
    return true;
  });
}

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

/**
 * Age a frozen snapshot's `seen_pos` forward by the seconds elapsed since it was fetched, so the
 * displayed flyability matches real elapsed time between polls (piece 3). Between 30 s browse polls
 * a snapshot's `seen_pos` is frozen, so a contact fetched fresh would keep looking flyable even as
 * it truly ages past the 15 s freshness gate. Pure: returns a shallow clone rather than mutating,
 * and leaves a null `seen_pos` (already ineligible) and non-positive elapsed untouched.
 */
export function agedContact(contact: Contact, secondsSince: number): Contact {
  if (contact.seen_pos === null || secondsSince <= 0) return contact;
  return { ...contact, seen_pos: contact.seen_pos + secondsSince };
}

/**
 * Flyable (eligible) contacts first, so the one thing the player can act on is at the top of the
 * list (piece 2). Stable within each group: the callsign/hex order from sortContacts is preserved.
 * Eligibility is read from whatever contacts are passed in, so callers that pre-age with
 * agedContact get a flyable-first order that matches the dimming.
 */
export function sortContactsFlyableFirst(contacts: Contact[]): Contact[] {
  const flyable: Contact[] = [];
  const rest: Contact[] = [];
  for (const contact of sortContacts(contacts)) {
    (checkEligibility(contact).eligible ? flyable : rest).push(contact);
  }
  return [...flyable, ...rest];
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
  return "SELECT A CONTACT FOR MISSION BRIEFING";
}

export default function ContactList({
  focusRequest = 0,
  onSelected,
}: {
  focusRequest?: number;
  onSelected?: (aircraftHex: string) => void;
}) {
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const feedStatus = useStore((s) => s.feedStatus);
  const select = useStore((s) => s.select);
  const searchRef = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState<ContactFilters>({
    query: "",
    classId: "all",
    altitude: "all",
    eligibility: "all",
  });

  useEffect(() => {
    if (focusRequest > 0) searchRef.current?.focus();
  }, [focusRequest]);

  // Flyability changes with wall-clock time (piece 3): a fresh contact ages past 15 s between
  // polls. Force a re-render on a slow tick so rows dim honestly without waiting for the next poll.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setAgeTick((t) => t + 1), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const secondsSince = secondsSinceTrafficApplied();
  const aged = Array.from(contacts.values()).map((c) => agedContact(c, secondsSince));
  const rows = sortContactsFlyableFirst(filterContacts(aged, filters));
  const hint = selectionHint(selectedHex, rows.length);

  return (
    <div className="panel flex h-full flex-col">
      <div className="contact-list-header">
        <label className="label" htmlFor={`contact-search-${focusRequest}`}>Contacts · {rows.length}</label>
        <input
          ref={searchRef}
          id={`contact-search-${focusRequest}`}
          className="contact-search"
          data-testid="contact-search"
          type="search"
          value={filters.query}
          placeholder="CALLSIGN / HEX / TYPE"
          aria-label="Search contacts by callsign, hex, or aircraft type"
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
        />
        <div className="contact-filters">
          <select
            className="contact-filter"
            aria-label="Filter contacts by aircraft class"
            value={filters.classId}
            onChange={(event) => setFilters((current) => ({ ...current, classId: event.target.value as ContactClassFilter }))}
          >
            <option value="all">ALL CLASSES</option>
            <option value="c172s">GA</option>
            <option value="b738">AIRLINER</option>
            <option value="f5e">FIGHTER</option>
            <option value="biz">BUSINESS JET</option>
            <option value="tprop">TURBOPROP</option>
            <option value="r44">HELICOPTER</option>
            <option value="unsupported">UNSUPPORTED</option>
          </select>
          <select
            className="contact-filter"
            aria-label="Filter contacts by altitude"
            value={filters.altitude}
            onChange={(event) => setFilters((current) => ({ ...current, altitude: event.target.value as ContactAltitudeFilter }))}
          >
            <option value="all">ALL ALT</option>
            <option value="low">&lt; 5K FT</option>
            <option value="mid">5–20K FT</option>
            <option value="high">20K+ FT</option>
          </select>
          <select
            className="contact-filter"
            aria-label="Filter contacts by flyability"
            value={filters.eligibility}
            onChange={(event) => setFilters((current) => ({ ...current, eligibility: event.target.value as ContactEligibilityFilter }))}
          >
            <option value="all">ALL FLYABLE</option>
            <option value="eligible">FLYABLE</option>
            <option value="ineligible">NOT FLYABLE</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {rows.length === 0 ? (
          <div className="label p-2">
            {contacts.size === 0 ? `NO CONTACTS — ${feedStatus.toUpperCase()}` : "NO CONTACTS MATCH FILTERS"}
          </div>
        ) : (
          rows.map((c) => {
            const eligible = checkEligibility(c).eligible;
            return (
            <button
              type="button"
              key={c.hex}
              onClick={() => {
                select(c.hex);
                onSelected?.(c.hex);
              }}
              aria-pressed={c.hex === selectedHex}
              className={
                "contact-row" +
                (c.military ? " contact-row-military" : "") +
                (c.hex === selectedHex ? " contact-row-selected" : "") +
                (eligible ? "" : " contact-row-ineligible")
              }
            >
              <span className="contact-cell-flag" aria-label={eligible ? "Flyable" : undefined}>
                {eligible ? "►" : ""}
              </span>
              <span className="contact-cell-id">{c.flight ?? "—"}</span>
              <span className="contact-cell-id">{c.t ?? "—"}</span>
              <span className="contact-cell-num">{formatAlt(c)}</span>
              <span className="contact-cell-num">{formatGs(c)}</span>
            </button>
            );
          })
        )}
      </div>

      {hint !== null ? (
        <div className="p-2">
          <div className="label contact-select-hint">{hint}</div>
        </div>
      ) : null}
    </div>
  );
}
