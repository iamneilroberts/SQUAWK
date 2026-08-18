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
  ApproachReadoutBlock,
  type ImmersiveHudNavCue,
  type ImmersiveHudVariant,
  type TapeRange,
} from "./ImmersiveHudBar";
import type { ApproachBand } from "../mission/approachBand";
import type { DescentGuidance } from "../mission/descentGuidance";
import type { ApproachReadout } from "../mission/approachReadout";
import EdgeTurnCue from "./EdgeTurnCue";
import HudWarning from "./HudWarning";
import {
  formatAirtime, formatAltFt, formatAoaDeg, formatClass, formatClearanceFt,
  formatG, formatHeadingDeg, formatIasKt, formatLightPhase, formatSimRate,
  formatTasKt, formatVsiFpm, warningsFor,
} from "./format";
import { groundProximityActive } from "./gpws";
import ControlStateCells from "./controls/ControlStateCells";

/*
 * Desktop destination indicator (#47). The scattered desktop HUD had no equivalent of the mobile
 * bar's NavDirector; this top-center cue names the assigned airport and its range — a fixed
 * reference, not a turn indicator. Driven by the same immersiveNavCue the bar uses — so it lights
 * up for instant flight (ungated) and for any ranked flight whose assist level includes the
 * destination cue. Renders nothing when there is no assigned destination, so the desktop view
 * stays clean (no persistent "NO DESTINATION" chip).
 *
 * The turn direction used to live here too (a rotating ↑ arrow + "DEST +N°"), but #47 gave desktop
 * the same edge-anchored turn cue mobile got in #82 (EdgeTurnCue, mounted below in Hud's desktop
 * return) — so this cue no longer computes or shows a relative bearing; that's the edge cue's job
 * now, matching the one-turn-indicator rule #82 established for the immersive bar.
 */
function HudDestinationCue({ navCue }: { navCue: ImmersiveHudNavCue | null }) {
  if (navCue === null) return null;
  return (
    <div className="hud-destination hud-scrim" aria-label="Assigned destination">
      <span className="hud-destination-dest">{navCue.destination}</span>
      <span className="hud-destination-dist">{navCue.distanceNm.toFixed(1)} NM</span>
    </div>
  );
}

/*
 * Desktop twin of the mobile ApproachReadoutBlock: same component, just mounted here instead of
 * in the immersive bar tree, stacked under .hud-destination (top: 78px, #hud-chrome-rework) so
 * both cues can be up at once (destination pointer + approach readout) rather than overlapping.
 * 104 keeps the same ~26px gap the two cues have always had — 78 + 26 — just shifted down with
 * .hud-destination so neither lands under the top bar's wrapped second row.
 */
function HudApproachReadout({ readout, snapshot }: {
  readout: ApproachReadout | null;
  snapshot: HudSnapshot;
}) {
  if (readout === null) return null;
  return (
    <div className="hud-approach-readout" style={{ top: 104 }} aria-label="Approach guidance">
      <ApproachReadoutBlock readout={readout} snapshot={snapshot} />
    </div>
  );
}

function Readout({ label, value, unit, emphasis = false }: {
  label: string; value: string; unit?: string;
  /** #3: amber-emphasise this readout — the AGL cell wears it while a GPWS proximity call is up. */
  emphasis?: boolean;
}) {
  return (
    <div className={"hud-readout" + (emphasis ? " hud-readout-alert" : "")}>
      <span className="hud-readout-label">{label}</span>
      <span className="hud-readout-value">{value}</span>
      {unit ? <span className="hud-readout-unit">{unit}</span> : null}
    </div>
  );
}

/*
 * Desktop HUD bottom strip control-state cells (#48). Renders the shared ControlStateCells, so its
 * value/tone/gating logic is identical to the glass strip (ControlState) by construction, not by
 * review. Hook-free so it is directly testable without rendering the store-reading Hud component.
 */
export function HudControlRow({ snapshot }: { snapshot: HudSnapshot | null }) {
  return <ControlStateCells snapshot={snapshot} />;
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
  approachReadout = null,
  immersiveApproachWarnings = [],
  immersiveApproachBand = null,
  immersiveDescentGuidance = null,
  narrow = false,
  tapeRange = null,
  decluttered = false,
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
  /** The expanded approach readout (target alt/speed/sink, course, distance + time-to-landing);
   *  falls back to the turn-to-final heading/distance before the aircraft is established. */
  approachReadout?: ApproachReadout | null;
  immersiveApproachWarnings?: string[];
  /** #52: per-class suggested approach speed + glide-slope altitude band, shown during final. */
  immersiveApproachBand?: ApproachBand | null;
  /** Range descent advisory shown beyond the approach length (hands off to the band on final). */
  immersiveDescentGuidance?: DescentGuidance | null;
  /** A narrow phone viewport, even before the user taps FULL: gets the compact rail too, not the
   *  desktop scattered-corner HUD. Does NOT gate the fade — only true immersive/fullscreen does. */
  narrow?: boolean;
  /** Per-class IAS/ALT tape scale (Task 2/3). Null renders the tapes' honest em-dash fallback. */
  tapeRange?: { ias: TapeRange; alt: TapeRange } | null;
  /** Manual declutter (#57): hides the HUD-A/C layout toggle, threaded to ImmersiveHudBar. */
  decluttered?: boolean;
}) {
  if (snapshot === null) return null;
  const warnings = warningsFor(snapshot);
  const aglAlert = groundProximityActive(snapshot);
  const simRate = formatSimRate(snapshot.simRate);
  // #87: honest markers while time compression is active — the multiplier, and a reminder that
  // live traffic/the ghost are still polling on REAL wall time (never fast-forwarded/extrapolated
  // to match), so they visibly lag under compression.
  const compressionActive = (snapshot.timeCompression ?? 1) > 1;
  const showBar = immersive || narrow;
  const rootClass =
    "hud-root" + (showBar ? " hud-immersive" : "") + (faded ? " hud-faded" : "");

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
          approachReadout={approachReadout}
          approachWarnings={immersiveApproachWarnings}
          approachBand={immersiveApproachBand}
          descentGuidance={immersiveDescentGuidance}
          tapeRange={tapeRange}
          decluttered={decluttered}
          // #48: an active warning forces the chrome visible (faded=false), which would un-hide
          // the HUD-A/C layout picker mid-alert. Keep that toggle hidden while any warning is up —
          // the warning annunciator has its own never-faded layer, so safety text still shows.
          toggleFaded={faded || warnings.length > 0}
        />
        {/* #82: the prominent edge turn-direction cue. Left/right edge chevron for the required
            turn to the assigned destination; renders nothing when there is no destination. It is
            the immersive HUD's single turn indicator (the bar's inline arrow was removed). */}
        <EdgeTurnCue headingRad={snapshot.headingRad} navCue={immersiveNavCue} />
        <div className="hud-attribution">{attribution}</div>
      </div>
    );
  }

  // Desktop declutter (#49): the SIM banner, IAS/TAS/AOA/G, ALT/VSI/AGL/T and the HDG readout
  // used to be FOUR separately-anchored corner clusters (top-center banner, left column, right
  // column, top-center heading). They are now ONE top bar, mirroring the mobile immersive bar's
  // "one dense strip" approach (#13) instead of scattering flight data around the screen edges.
  // Control state (THR/FLAPS/TRIM/GEAR) and SKY are no longer duplicated here — they live once,
  // in the cockpit glass panel below (UnifiedGlass's control-state strip / mini-dash, #49).
  return (
    <div className={rootClass}>
      <div className="hud-top-bar hud-scrim">
        <span className="hud-top-bar-sim">
          <span className="hud-sim-badge">SIM</span>
          <span>{formatClass(snapshot.classLabel)}</span>
          <span>{snapshot.callsign}</span>
          <span className="hud-model-note">{snapshot.modelNote}</span>
          {simRate ? <span className="hud-warning">{simRate}</span> : null}
          {compressionActive ? (
            <span className="hud-warning">{snapshot.timeCompression}×</span>
          ) : null}
          {compressionActive ? (
            <span className="hud-model-note">LIVE TRAFFIC REAL-TIME</span>
          ) : null}
        </span>
        <span className="hud-top-bar-sep" aria-hidden="true" />
        <Readout label="IAS" value={formatIasKt(snapshot.iasMs)} unit="KT" />
        <Readout label="TAS" value={formatTasKt(snapshot.tasMs)} unit="KT" />
        <Readout label="HDG" value={formatHeadingDeg(snapshot.headingRad)} unit="°" />
        <Readout label="ALT" value={formatAltFt(snapshot.altitudeM)} unit="FT" />
        <Readout label="VSI" value={formatVsiFpm(snapshot.verticalSpeedMs)} unit="FPM" />
        <Readout label="AGL" value={formatClearanceFt(snapshot.terrainClearanceM)} unit="FT" emphasis={aglAlert} />
        <Readout label="AOA" value={formatAoaDeg(snapshot.aoaRad)} unit="°" />
        <Readout label="G" value={formatG(snapshot.loadFactor)} />
        <Readout label="T" value={formatAirtime(snapshot.airtimeS)} />
        <span className="hud-top-bar-sky">{formatLightPhase(snapshot.lightPhase)}</span>
      </div>

      <HudDestinationCue navCue={immersiveNavCue} />
      <HudApproachReadout readout={approachReadout} snapshot={snapshot} />

      {/* #47: desktop twin of the mobile edge turn-direction cue (#82) — reuses the same
          platform-agnostic helper/component, just mounted here instead of in the immersive bar
          tree. Left/right edge chevron for the required turn to the assigned destination;
          renders nothing when there is no destination. */}
      <EdgeTurnCue headingRad={snapshot.headingRad} navCue={immersiveNavCue} />

      {warnings.length > 0 && (
        <div className="hud-warnings">
          {warnings.map((w) => (
            <HudWarning key={w} warning={w} />
          ))}
        </div>
      )}

      <div className="hud-attribution">{attribution}</div>
    </div>
  );
}
