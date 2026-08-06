/*
 * The instrument overlay (parent spec §9). No logic beyond arranging strings — every
 * decision about what a number reads is in format.ts, where it is tested.
 *
 * LORAN visual language: monospace, 1px borders, bracket corners, translucent, no radius,
 * no shadows. Amber is the SIM accent and warnings; cyan is nominal data.
 *
 * .hud-root brings its own `position: absolute; inset: 0` (tokens.css) — ViewerHost's
 * ViewerContext.Provider does not itself absolute-overlay its children over the Cesium
 * canvas, so the HUD supplies that positioning itself rather than relying on the parent.
 */
import type { HudSnapshot } from "./snapshot";
import {
  formatAirtime, formatAltFt, formatAoaDeg, formatClass, formatClearanceFt, formatFlaps,
  formatG, formatGear, formatHeadingDeg, formatIasKt, formatSimRate, formatTasKt,
  formatThrottlePct, formatVsiFpm, warningsFor,
} from "./format";

function Readout({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="hud-readout">
      <span className="hud-readout-label">{label}</span>
      <span className="hud-readout-value">{value}</span>
      {unit ? <span className="hud-readout-unit">{unit}</span> : null}
    </div>
  );
}

export default function Hud({
  snapshot,
  terrainNote,
}: {
  snapshot: HudSnapshot | null;
  terrainNote: string;
}) {
  if (snapshot === null) return null;
  const warnings = warningsFor(snapshot);
  const simRate = formatSimRate(snapshot.simRate);

  return (
    <div className="hud-root">
      <div className="hud-banner">
        <span className="hud-sim-badge">SIM</span>
        <span>{formatClass(snapshot.classLabel)}</span>
        <span>{snapshot.callsign}</span>
        <span className="hud-model-note">{snapshot.modelNote}</span>
        {simRate ? <span className="hud-warning">{simRate}</span> : null}
      </div>

      <div className="hud-left">
        <Readout label="IAS" value={formatIasKt(snapshot.iasMs)} unit="KT" />
        <Readout label="TAS" value={formatTasKt(snapshot.tasMs)} unit="KT" />
        <Readout label="AOA" value={formatAoaDeg(snapshot.aoaRad)} unit="°" />
        <Readout label="G" value={formatG(snapshot.loadFactor)} />
      </div>

      <div className="hud-right">
        <Readout label="ALT" value={formatAltFt(snapshot.altitudeM)} unit="FT" />
        <Readout label="VSI" value={formatVsiFpm(snapshot.verticalSpeedMs)} unit="FPM" />
        <Readout label="AGL" value={formatClearanceFt(snapshot.terrainClearanceM)} unit="FT" />
        <Readout label="T" value={formatAirtime(snapshot.airtimeS)} />
      </div>

      <div className="hud-heading">
        <span className="hud-readout-label">HDG</span>
        <span className="hud-heading-value">{formatHeadingDeg(snapshot.headingRad)}</span>
      </div>

      <div className="hud-bottom">
        <span>THR {formatThrottlePct(snapshot.throttle)}</span>
        <span>{formatFlaps(snapshot.flapLabel)}</span>
        <span>{formatGear(snapshot.gear)}</span>
      </div>

      {warnings.length > 0 && (
        <div className="hud-warnings">
          {warnings.map((w) => (
            <span key={w} className="hud-warning">{w}</span>
          ))}
        </div>
      )}

      <div className="hud-attribution">
        IMAGERY © ESRI · {terrainNote} · TRAFFIC: AIRPLANES.LIVE / ADSB.LOL / ADSB.FI
      </div>
    </div>
  );
}
