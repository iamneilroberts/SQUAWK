/*
 * End of session (parent spec §5, owner decision B-5). Not a freeze frame: the default
 * mouse controls are back on behind this card so the impact or landing site can be orbited.
 */
import type { FlightStats } from "../game/stats";
import { EM_DASH, formatAirtime, formatAltFt, formatG, formatIasKt } from "../hud/format";

const M_PER_NM = 1852;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="handoff-row">
      <span className="label">{label}</span>
      <span className="handoff-value">{value}</span>
    </div>
  );
}

export default function EndCard({
  stats,
  callsign = null,
  onExit,
}: {
  stats: FlightStats;
  /** Set-once SIM callsign, shown on the debrief per UI-002 (identity lives off the live rail). */
  callsign?: string | null;
  onExit(): void;
}) {
  return (
    <div className="end-overlay">
      <div className="panel end-card">
        <div className="label handoff-title">{stats.classification}</div>
        <Row label="CALLSIGN" value={callsign ?? EM_DASH} />
        <Row label="AIRTIME" value={formatAirtime(stats.airtimeS)} />
        <Row label="DISTANCE" value={`${(stats.distanceM / M_PER_NM).toFixed(1)} NM`} />
        <Row label="MAX IAS" value={`${formatIasKt(stats.maxIasMs)} KT`} />
        <Row label="MAX ALT" value={`${formatAltFt(stats.maxAltitudeM)} FT`} />
        <Row label="MAX G" value={formatG(stats.maxG)} />
        <Row label="IMPACT SINK" value={`${Math.round(stats.impactSinkFpm)} FPM`} />
        <Row label="IMPACT SPEED" value={`${formatIasKt(stats.impactIasMs)} KT`} />
        <div className="handoff-disclosure">DRAG TO ORBIT THE SITE</div>
        <button className="control-button" onClick={onExit}>
          EXIT TO BROWSE
        </button>
      </div>
    </div>
  );
}
