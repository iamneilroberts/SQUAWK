/*
 * Tap another aircraft in flight, get this: a compact terminal callout with what the feed said
 * about that contact, plus its range + bearing from own ship (#86). Deliberately smaller than the
 * BROWSE-side TrafficDetailCard — no adsbdb enrichment fetch, just the live-feed fields — because
 * it rides over the flying view and must not steal focus.
 *
 * Only a REAL contact is ever shown: identifiedHex is set by a pick that hit a live billboard
 * (ViewerHost + pickRouting), and the body resolves it against the live contact map, rendering
 * nothing if it has left the feed. Own-ship and the origin ghost render through separate paths and
 * are not in that map as "other aircraft" — tapping the ghost would at most show the real contact
 * the flight was seeded from, which is honest. Every field the feed omitted is an em-dash.
 *
 * Split like TrafficDetailCard: `IdentifiedContactBody` is hook-free (and holds every test);
 * the default export reads the store + HUD snapshot and gates on mode.
 */
import { useSyncExternalStore } from "react";
import type { Contact } from "../data/types";
import { useStore } from "../state/store";
import { hudSnapshot } from "../hud/snapshot";
import { EM_DASH } from "../hud/format";
import { contactHeightM } from "../data/contactGeo";
import { mToFt } from "../sim/units";
import { bearingDeg, rangeNm } from "../dashboard/geoRange";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="handoff-row">
      <span className="label">{label}</span>
      <span className="handoff-value">{value}</span>
    </div>
  );
}

const orDash = (v: string | number | null | undefined, suffix = ""): string =>
  v === null || v === undefined || v === "" ? EM_DASH : `${v}${suffix}`;

/** Placed height, feet — alt_geom only, the same rule the billboard uses (data/contactGeo). */
function altLine(c: Contact): string {
  const h = contactHeightM(c);
  return h === null ? EM_DASH : `${Math.round(mToFt(h))} FT`;
}

export function IdentifiedContactBody({ contact, own, onClose }: {
  contact: Contact;
  own: { latDeg: number; lonDeg: number } | null;
  onClose(): void;
}) {
  const callsign = contact.flight?.trim();
  const rangeStr = own === null
    ? EM_DASH
    : `${rangeNm(own.latDeg, own.lonDeg, contact.lat, contact.lon).toFixed(1)} NM`;
  const bearingStr = own === null
    ? EM_DASH
    : `${String(Math.round(bearingDeg(own.latDeg, own.lonDeg, contact.lat, contact.lon)) % 360)
        .padStart(3, "0")}°`;

  return (
    <div className="identify-callout panel">
      <div className="label handoff-title">CONTACT</div>
      <Row label="CALLSIGN" value={orDash(callsign ? callsign : null)} />
      <Row label="HEX" value={contact.hex.toUpperCase()} />
      <Row label="TYPE" value={orDash(contact.t)} />
      <Row label="ALT" value={altLine(contact)} />
      <Row label="GND SPD" value={orDash(contact.gs === null ? null : Math.round(contact.gs), " KT")} />
      <Row label="RANGE" value={rangeStr} />
      <Row label="BEARING" value={bearingStr} />
      <button type="button" className="control-button" onClick={onClose}>CLOSE</button>
    </div>
  );
}

export default function IdentifiedContactCallout() {
  const mode = useStore((s) => s.mode);
  const identifiedHex = useStore((s) => s.identifiedHex);
  const contact = useStore((s) => (identifiedHex === null ? undefined : s.contacts.get(identifiedHex)));
  const snapshot = useSyncExternalStore(hudSnapshot.subscribe, hudSnapshot.get, hudSnapshot.get);

  // Belt-and-braces gate: the mount site already limits this to FLYING/PAUSED, but self-gating
  // keeps the component honest if it is ever mounted elsewhere.
  if (mode !== "FLYING" && mode !== "PAUSED") return null;
  // The contact left the feed (or was never known): show nothing rather than a frozen callout.
  if (identifiedHex === null || contact === undefined) return null;

  const own = snapshot === null ? null : { latDeg: snapshot.latDeg, lonDeg: snapshot.lonDeg };
  return (
    <IdentifiedContactBody
      contact={contact}
      own={own}
      onClose={() => useStore.getState().setIdentifiedHex(null)}
    />
  );
}
