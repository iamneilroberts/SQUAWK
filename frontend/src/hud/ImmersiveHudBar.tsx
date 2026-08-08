/*
 * The single dense translucent top status bar for the mobile immersive / fullscreen flight view
 * (#13 follow-up). It REPLACES the scattered corner readout clusters in immersive mode with one
 * glance strip pinned to the top edge — the only edge the touch controls leave free (stick
 * bottom-left, throttle right, buttons bottom-centre).
 *
 * Why it is its own component and STAYS visible: this is essential flight instrumentation. Unlike
 * the attribution and the rest of the informational chrome (which keep the video-player auto-hide),
 * you must be able to read alt / speed / heading while flying, so the bar is deliberately NOT in
 * the fade set (see tokens.css). Warnings still surface here (safety).
 *
 * Honest-data + SIM rules hold compactly: every number goes through the SHARED hud/format.ts
 * formatters (unknown -> em-dash, never a zero), and the SIM identity is folded in with the amber
 * accent + SIM-<hex> callsign + class, so the big separate SIM banner can drop in immersive mode
 * without ever losing SIM-unmistakability. The attitude indicator REUSES the six-pack geometry
 * (AttitudeIndicator), so the dial and the bar can never disagree about the aeroplane's attitude.
 *
 * Hook-free on purpose (like SixPack/Hud): the test calls it as a plain function and walks the
 * returned tree without jsdom.
 */
import type { HudSnapshot } from "./snapshot";
import type { AttitudeStyle } from "../sim/types";
import AttitudeIndicator from "../dashboard/AttitudeIndicator";
import {
  formatAltFt, formatClass, formatClearanceFt, formatHeadingDeg,
  formatIasKt, formatVsiFpm, warningsFor,
} from "./format";

export type BarField = { label: string; value: string; unit?: string };

/**
 * The dense field strip, in reading order. Pure and formatter-only, so it is unit-tested without a
 * renderer and can never disagree with the desktop HUD about what a number reads. Deliberately the
 * five essential glance fields only — AOA and G were dropped from the mobile immersive bar (owner:
 * "make it tiny, minimalist") so the strip stays a single short row on a phone. Those two remain on
 * the desktop dashboard (HudDisplay) where there is room.
 */
export function immersiveBarFields(snapshot: HudSnapshot): BarField[] {
  return [
    { label: "ALT", value: formatAltFt(snapshot.altitudeM), unit: "FT" },
    { label: "IAS", value: formatIasKt(snapshot.iasMs), unit: "KT" },
    { label: "HDG", value: formatHeadingDeg(snapshot.headingRad) },
    { label: "VSI", value: formatVsiFpm(snapshot.verticalSpeedMs), unit: "FPM" },
    { label: "AGL", value: formatClearanceFt(snapshot.terrainClearanceM), unit: "FT" },
  ];
}

export default function ImmersiveHudBar({
  snapshot,
  attitudeStyle,
}: {
  snapshot: HudSnapshot;
  attitudeStyle: AttitudeStyle;
}) {
  const fields = immersiveBarFields(snapshot);
  const warnings = warningsFor(snapshot);

  return (
    <div className="imm-bar">
      {/* SIM identity, folded in — amber accent keeps the sim unmistakable without the big banner. */}
      <div className="imm-bar-sim">
        <span className="hud-sim-badge">SIM</span>
        <span className="imm-bar-callsign">{snapshot.callsign}</span>
        <span className="imm-bar-class">{formatClass(snapshot.classLabel)}</span>
      </div>

      {/* Compact artificial horizon — same geometry as the six-pack ADI, small. */}
      <div className="imm-bar-adi">
        <AttitudeIndicator
          snapshot={snapshot}
          attitudeStyle={attitudeStyle}
          clipId="immAdiClip"
          className="imm-adi-face"
        />
      </div>

      <div className="imm-bar-fields">
        {fields.map((f) => (
          <span key={f.label} className="imm-field">
            <span className="imm-field-label">{f.label}</span>
            <span className="imm-field-value">{f.value}</span>
            {f.unit ? <span className="imm-field-unit">{f.unit}</span> : null}
          </span>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="imm-bar-warnings">
          {warnings.map((w) => (
            <span key={w} className="hud-warning">{w}</span>
          ))}
        </div>
      )}
    </div>
  );
}
