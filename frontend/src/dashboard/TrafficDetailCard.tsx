/*
 * Click a windscreen tag, get this: everything the feed said about that aircraft, plus the
 * adsbdb enrichment from the backend's /api/type/{hex}.
 *
 * THREE adsbdb states, never collapsed into one, because they mean different things:
 *   loading      the lookup is in flight
 *   ok, all null adsbdb answered and has genuinely never heard of this hex
 *   unreachable  we do not know whether adsbdb has a record for this hex
 * "unreachable" has two causes rendered identically, both meaning the same thing to a
 * player: the fetch to OUR backend itself failing (kind: "unreachable"), and OUR backend
 * answering but reporting that adsbdb did not (kind: "ok", info.available === false, e.g. an
 * adsbdb timeout). Folding these into one visible state — not into `emptyRecord` — is what
 * keeps a real adsbdb outage from rendering as "NO ADSBDB RECORD", which would assert an
 * answer adsbdb never gave.
 * Every individual field the feed or adsbdb omitted is an em-dash.
 *
 * Split as usual: `TrafficDetailBody` is hook-free and holds every element (and every test);
 * `TrafficDetailCard` owns the fetch.
 */
import { useEffect, useState } from "react";
import type { Contact, TypeInfo } from "../data/types";
import { fetchTypeInfo } from "../data/api";
import { useStore } from "../state/store";
import { EM_DASH, formatHeadingDeg } from "../hud/format";
import { degToRad } from "../sim/units";

export type EnrichmentState =
  | { kind: "loading" }
  | { kind: "ok"; info: TypeInfo }
  | { kind: "unreachable" };

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

function baroLine(alt: Contact["alt_baro"]): string {
  if (alt === null) return EM_DASH;
  if (alt === "ground") return "GROUND";
  return `${alt} FT`;
}

export function TrafficDetailBody({ contact, enrichment, onClose }: {
  contact: Contact;
  enrichment: EnrichmentState;
  onClose(): void;
}) {
  const info = enrichment.kind === "ok" ? enrichment.info : null;
  // adsbdb itself being unreachable is reported two ways - the fetch to our own backend
  // failing outright, or our backend answering with available: false - and both mean the
  // same thing here: we do not know whether adsbdb has a record for this hex.
  const adsbdbUnreachable = enrichment.kind === "unreachable" || info?.available === false;
  const emptyRecord =
    info !== null && info.available &&
    info.type === null && info.manufacturer === null && info.registration === null;

  return (
    <div className="traffic-card panel">
      <div className="label handoff-title">CONTACT</div>

      <Row label="CALLSIGN" value={orDash(contact.flight?.trim() ?? null)} />
      <Row label="HEX" value={contact.hex.toUpperCase()} />
      <Row label="TYPE (FEED)" value={orDash(contact.t)} />
      <Row label="ALT GEOM" value={orDash(contact.alt_geom, " FT")} />
      <Row label="ALT BARO" value={baroLine(contact.alt_baro)} />
      <Row label="GROUND SPEED" value={orDash(contact.gs === null ? null : Math.round(contact.gs), " KT")} />
      <Row label="TRACK" value={contact.track === null ? EM_DASH : formatHeadingDeg(degToRad(contact.track))} />
      <Row label="VERT RATE" value={orDash(contact.baro_rate, " FPM")} />
      <Row label="POSITION AGE" value={orDash(contact.seen_pos === null ? null : Math.round(contact.seen_pos), " S")} />
      {contact.military ? <div className="handoff-note">MILITARY (dbFlags)</div> : null}

      <div className="label handoff-title">ADSBDB</div>
      {enrichment.kind === "loading" && <div className="handoff-adjustment">ADSBDB LOOKUP…</div>}
      {adsbdbUnreachable && (
        <div className="handoff-note">ADSBDB UNREACHABLE — ENRICHMENT UNKNOWN</div>
      )}
      {emptyRecord && <div className="handoff-note">NO ADSBDB RECORD FOR THIS HEX</div>}
      {info !== null && info.available && !emptyRecord && (
        <>
          <Row label="TYPE" value={orDash(info.type)} />
          <Row label="MANUFACTURER" value={orDash(info.manufacturer)} />
          <Row label="REGISTRATION" value={orDash(info.registration)} />
        </>
      )}

      <button type="button" className="control-button" onClick={onClose}>CLOSE</button>
    </div>
  );
}

export default function TrafficDetailCard({ hex, onClose }: { hex: string; onClose(): void }) {
  const contact = useStore((s) => s.contacts.get(hex));
  const [enrichment, setEnrichment] = useState<EnrichmentState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setEnrichment({ kind: "loading" });
    fetchTypeInfo(hex)
      .then((info) => { if (!cancelled) setEnrichment({ kind: "ok", info }); })
      .catch(() => { if (!cancelled) setEnrichment({ kind: "unreachable" }); });
    return () => { cancelled = true; };
  }, [hex]);

  // The contact left the feed while the card was open. Closing is the honest response: a card
  // frozen on a last-known snapshot would keep looking live.
  if (!contact) return null;

  return <TrafficDetailBody contact={contact} enrichment={enrichment} onClose={onClose} />;
}
