/*
 * The handoff moment (spec §4). Everything on this card is either a value straight from
 * the feed or a disclosure about what the sim is about to do differently. The adjustments
 * list is printed verbatim from buildSpawnState — clamping is legal, silent clamping is not.
 */
import type { Contact } from "../data/types";
import type { SpawnResult } from "../takeover/spawn";
import { formatCallsign } from "../hud/format";
import { mToFt, msToKt, radToDeg } from "../sim/units";
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
  countdown,
  note,
}: {
  contact: Contact;
  spawn: SpawnResult | null;
  countdown: number | null;
  note: string;
}) {
  const heading =
    spawn === null
      ? "—"
      : String(
          Math.round(((radToDeg(hprFromQuat(spawn.state.attitude, spawn.state.position).headingRad) % 360) + 360) % 360),
        ).padStart(3, "0");

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

      <div className="handoff-disclosure">
        FLYING THE {spawn === null ? "—" : "C172 MODEL THIS BUILD"} · GROUND SPEED IS USED AS
        TRUE AIRSPEED (STILL AIR) · ALTITUDE FROM{" "}
        {spawn === null ? "—" : spawn.altitudeSource === "alt_geom" ? "ALT_GEOM" : "ALT_BARO"}
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
