/*
 * The handoff moment (spec §4). Everything on this card is either a value straight from
 * the feed or a disclosure about what the sim is about to do differently. The adjustments
 * list is printed verbatim from buildSpawnState — clamping is legal, silent clamping is not.
 */
import type { Contact } from "../data/types";
import type { ClassParams } from "../sim/types";
import type { SpawnResult } from "../takeover/spawn";
import { disclosureLine } from "../takeover/eligibility";
import { EM_DASH, formatCallsign, formatClass, formatHeadingDeg } from "../hud/format";
import { mToFt, msToKt } from "../sim/units";
import { hprFromQuat } from "../sim/quat";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="handoff-row">
      <span className="label">{label}</span>
      <span className="handoff-value">{value}</span>
    </div>
  );
}

export default function HandoffCard({
  contact,
  spawn,
  params,
  matched,
  countdown,
  note,
}: {
  contact: Contact;
  spawn: SpawnResult | null;
  params: ClassParams | null;
  matched: boolean;
  countdown: number | null;
  note: string;
}) {
  // Reuses hud/format.ts's formatHeadingDeg rather than re-deriving the wrap: it rounds
  // BEFORE the final modulo, so a heading like 359.6° reads "000", not the "360" a naive
  // round-after-wrap produces — the card is this phase's disclosure surface, so it gets the
  // same honesty rule as the in-flight HUD.
  const heading = formatHeadingDeg(
    spawn === null ? null : hprFromQuat(spawn.state.attitude, spawn.state.position).headingRad,
  );

  return (
    <div className="handoff-card panel">
      <div className="label handoff-title">TAKE CONTROLS</div>

      <Row label="CONTACT" value={contact.flight ?? "—"} />
      <Row label="HEX" value={contact.hex.toUpperCase()} />
      <Row label="TYPE (FEED)" value={contact.t ?? "—"} />
      <Row label="ALTITUDE" value={spawn === null ? "—" : `${Math.round(mToFt(spawn.state.altitudeM))} FT`} />
      <Row label="SPEED" value={spawn === null ? "—" : `${Math.round(msToKt(spawn.state.tasMs))} KT`} />
      <Row label="HEADING" value={heading} />
      <Row label="CALLSIGN" value={formatCallsign(contact.hex)} />
      <Row label="AIRCRAFT CLASS" value={params === null ? EM_DASH : formatClass(params.label)} />

      <div className="handoff-disclosure">
        FLYING THE {spawn === null || params === null ? EM_DASH : disclosureLine(contact, params, matched)} ·
        GROUND SPEED IS USED AS TRUE AIRSPEED (STILL AIR) · ALTITUDE FROM{" "}
        {spawn === null ? EM_DASH : spawn.altitudeSource === "alt_geom" ? "ALT_GEOM" : "ALT_BARO"}
      </div>

      <div className="label handoff-title">ADJUSTMENTS</div>
      {spawn === null || spawn.adjustments.length === 0 ? (
        <div className="handoff-adjustment">NO ADJUSTMENTS — SNAPSHOT FLOWN AS RECEIVED</div>
      ) : (
        spawn.adjustments.map((a, i) => (
          <div className="handoff-adjustment" key={`${a.field}-${i}`}>
            <span className="handoff-adjust-field">{a.field}</span>
            <span>
              {a.from} → {a.to}
            </span>
            <span className="handoff-adjust-reason">{a.reason}</span>
          </div>
        ))
      )}

      {note ? <div className="handoff-note">{note}</div> : null}
      {countdown !== null ? <div className="handoff-countdown">{countdown}</div> : null}
    </div>
  );
}
