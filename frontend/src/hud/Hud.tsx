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
import type { AttitudeStyle } from "../sim/types";
import ImmersiveHudBar, {
  type ImmersiveHudNavCue,
  type ImmersiveHudVariant,
  type TapeRange,
} from "./ImmersiveHudBar";
import {
  formatAirtime, formatAltFt, formatAoaDeg, formatClass, formatClearanceFt, formatFlaps,
  formatG, formatGear, formatHeadingDeg, formatIasKt, formatLightPhase, formatSimRate,
  formatTasKt, formatThrottlePct, formatVsiFpm, warningsFor,
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
  attribution,
  immersive = false,
  faded = false,
  attitudeStyle = "line",
  immersiveVariant = "balanced",
  onImmersiveVariantChange,
  immersiveNavCue = null,
  immersiveApproachWarnings = [],
  narrow = false,
  tapeRange = null,
}: {
  snapshot: HudSnapshot | null;
  attribution: string;
  /** Mobile immersive/fullscreen flight (#13): replaces the scattered corner readout clusters with
   *  a single dense top status bar (ImmersiveHudBar), clear of the touch zones. */
  immersive?: boolean;
  /** Video-player auto-hide: fade the informational overlays to opacity 0. Warnings are NEVER
   *  faded (safety), the flight controls are a separate layer, and — in immersive mode — the top
   *  status bar is essential instrumentation and is NOT in the fade set either. */
  faded?: boolean;
  /** The flown class's attitude style, threaded through to the immersive bar's mini ADI so it
   *  reuses the same six-pack geometry (line horizon vs filled ball). Ignored off immersive. */
  attitudeStyle?: AttitudeStyle;
  immersiveVariant?: ImmersiveHudVariant;
  onImmersiveVariantChange?(variant: ImmersiveHudVariant): void;
  immersiveNavCue?: ImmersiveHudNavCue | null;
  immersiveApproachWarnings?: string[];
  /** A narrow phone viewport, even before the user taps FULL: gets the compact rail too, not the
   *  desktop scattered-corner HUD. Does NOT gate the fade — only true immersive/fullscreen does. */
  narrow?: boolean;
  /** Per-class IAS/ALT tape scale (Task 2/3). Null renders the tapes' honest em-dash fallback. */
  tapeRange?: { ias: TapeRange; alt: TapeRange } | null;
}) {
  if (snapshot === null) return null;
  const warnings = warningsFor(snapshot);
  const simRate = formatSimRate(snapshot.simRate);
  const showBar = immersive || narrow;
  const rootClass =
    "hud-root" + (showBar ? " hud-immersive" : "") + (immersive && faded ? " hud-faded" : "");

  // Immersive mobile flight (or any narrow phone, even pre-FULL): ONE dense top bar carries the
  // essential flight data + SIM identity + warnings and STAYS visible (it is not faded) unless
  // faded is scoped to true immersive/fullscreen. Only the attribution keeps its auto-hide. The
  // desktop / non-immersive tree below is untouched.
  if (showBar) {
    return (
      <div className={rootClass}>
        <ImmersiveHudBar
          snapshot={snapshot}
          attitudeStyle={attitudeStyle}
          variant={immersiveVariant}
          onVariantChange={onImmersiveVariantChange}
          navCue={immersiveNavCue}
          approachWarnings={immersiveApproachWarnings}
          tapeRange={tapeRange}
        />
        <div className="hud-attribution">{attribution}</div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <div className="hud-banner">
        <span className="hud-sim-badge">SIM</span>
        <span>{formatClass(snapshot.classLabel)}</span>
        <span>{snapshot.callsign}</span>
        <span className="hud-model-note">{snapshot.modelNote}</span>
        {simRate ? <span className="hud-warning">{simRate}</span> : null}
      </div>

      <div className="hud-left hud-scrim">
        <Readout label="IAS" value={formatIasKt(snapshot.iasMs)} unit="KT" />
        <Readout label="TAS" value={formatTasKt(snapshot.tasMs)} unit="KT" />
        <Readout label="AOA" value={formatAoaDeg(snapshot.aoaRad)} unit="°" />
        <Readout label="G" value={formatG(snapshot.loadFactor)} />
      </div>

      <div className="hud-right hud-scrim">
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
        <span>{formatGear(snapshot.gear, snapshot.gearPosition)}</span>
        <span>{formatLightPhase(snapshot.lightPhase)}</span>
      </div>

      {warnings.length > 0 && (
        <div className="hud-warnings">
          {warnings.map((w) => (
            <span key={w} className="hud-warning">{w}</span>
          ))}
        </div>
      )}

      <div className="hud-attribution">{attribution}</div>
    </div>
  );
}
