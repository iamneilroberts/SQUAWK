/*
 * Runtime-selectable mobile HUD rails. "balanced" is concept A: the shortest scan path across
 * discrete readouts. "tapes" is concept C: speed/altitude edge tapes around a compact flight
 * director. Both occupy only the top edge, leaving the touch stick, throttle and button row alone.
 *
 * This component stays hook-free so its layout and toggle behavior remain cheap to unit-test as a
 * plain React tree. FlightSession owns the selected variant for the life of the flight.
 */
import type { HudSnapshot } from "./snapshot";
import type { AttitudeStyle } from "../sim/types";
import AttitudeIndicator from "../dashboard/AttitudeIndicator";
import ControlIconCell from "./controls/ControlIconCell";
import {
  EM_DASH,
  formatAltFt,
  formatClearanceFt,
  formatHeadingDeg,
  formatIasKt,
  formatThrottlePct,
  formatTrim,
  formatVsiFpm,
  warningsFor,
} from "./format";
import { radToDeg, mToFt, msToKt } from "../sim/units";

export type BarField = { label: string; value: string; unit?: string };
export type ImmersiveHudVariant = "balanced" | "tapes";
export type ImmersiveHudNavCue = {
  destination: string;
  bearingDeg: number;
  distanceNm: number;
};

export type TapeRange = { min: number; max: number; step: number; major: number; pxPerUnit: number };

/** Fixed tape viewport height in px. MUST equal the .tape-window height in tokens.css. */
export const TAPE_WINDOW_PX = 44;

export function tapeTicks(range: TapeRange): { value: number; major: boolean; y: number }[] {
  const ticks: { value: number; major: boolean; y: number }[] = [];
  for (let v = range.min; v <= range.max; v += range.step) {
    ticks.push({ value: v, major: v % range.major === 0, y: (v - range.min) * range.pxPerUnit });
  }
  return ticks;
}

export function tapeStripOffset(value: number, range: TapeRange, windowPx: number = TAPE_WINDOW_PX): number {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  return (clamped - range.min) * range.pxPerUnit - windowPx / 2;
}

/** Pick a readable step/major/pxPerUnit for a display span, targeting ~10 ticks in the window. */
function tapeStepsForSpan(span: number): { step: number; major: number; pxPerUnit: number } {
  // ~10 unit-values visible across the fixed window; strip is tall enough that pxPerUnit stays > 0.
  const rawStep = span / 20;
  const step = rawStep <= 5 ? 5 : rawStep <= 10 ? 10 : rawStep <= 50 ? 50 : 100;
  const major = step * 2;
  // scale so the full span is ~ (span/step * 10)px tall — 10px between ticks
  const pxPerUnit = 10 / step;
  return { step, major, pxPerUnit };
}

export function tapeRangesFor(params: {
  display: { asiMinKt: number; asiMaxKt: number };
  limits: { serviceCeilingM: number };
}): { ias: TapeRange; alt: TapeRange } {
  const iasSpan = params.display.asiMaxKt - params.display.asiMinKt;
  const iasSteps = tapeStepsForSpan(iasSpan);
  const altMax = Math.ceil(mToFt(params.limits.serviceCeilingM) / 1000) * 1000;
  const altSteps = tapeStepsForSpan(altMax);
  return {
    ias: { min: params.display.asiMinKt, max: params.display.asiMaxKt, ...iasSteps },
    alt: { min: 0, max: altMax, ...altSteps },
  };
}

export function immersiveBarFields(snapshot: HudSnapshot): BarField[] {
  return [
    { label: "ALT", value: formatAltFt(snapshot.altitudeM), unit: "FT" },
    { label: "IAS", value: formatIasKt(snapshot.iasMs), unit: "KT" },
    { label: "HDG", value: formatHeadingDeg(snapshot.headingRad) },
    { label: "VSI", value: formatVsiFpm(snapshot.verticalSpeedMs), unit: "FPM" },
    { label: "AGL", value: formatClearanceFt(snapshot.terrainClearanceM), unit: "FT" },
  ];
}

export function nextImmersiveHudVariant(variant: ImmersiveHudVariant): ImmersiveHudVariant {
  return variant === "balanced" ? "tapes" : "balanced";
}

/** Safety calls lead; approach coaching follows. Dedupe and cap the rail so it stays glanceable. */
export function prioritizedImmersiveWarnings(
  snapshot: HudSnapshot,
  approachWarnings: string[] = [],
): string[] {
  return [...new Set([...warningsFor(snapshot), ...approachWarnings])].slice(0, 3);
}

/** Signed destination bearing relative to the nose: left negative, right positive. */
export function relativeBearingDeg(headingRad: number, bearingDeg: number): number {
  const headingDeg = ((radToDeg(headingRad) % 360) + 360) % 360;
  return ((bearingDeg - headingDeg + 540) % 360) - 180;
}

/** Shared control-state cells for both mobile rails (#48): mirrors Hud.tsx's HudControlRow so
 *  the glass strip, desktop HUD bottom, and mobile rails never disagree. Mobile previously
 *  lacked gear + trim; it now gets the full set. Hook-free so both rails can call it inline. */
export function ImmersiveControlRow({ snapshot }: { snapshot: HudSnapshot | null }) {
  const throttle = snapshot?.throttle ?? null;
  const trimText = formatTrim(snapshot?.trim ?? null);
  return (
    <>
      <ControlIconCell kind="throttle" snapshot={snapshot} label="THR"
        value={formatThrottlePct(throttle)} valueTone={throttle != null && throttle > 0.92 ? "amber" : "cyan"} />
      <ControlIconCell kind="flaps" snapshot={snapshot} label="FLP" value={snapshot?.flapLabel ?? "—"} />
      <ControlIconCell kind="trim" snapshot={snapshot} label="TRM" value={trimText}
        valueTone={trimText === "NEUTRAL" ? "dim" : "cyan"} />
      <ControlIconCell kind="gear" snapshot={snapshot} label="GEAR" />
      {snapshot?.hasSpeedbrake && (
        <ControlIconCell kind="speedbrake" snapshot={snapshot} label="SPD BRK"
          value={snapshot?.speedbrake ? "OUT" : null} valueTone="amber" />
      )}
    </>
  );
}

function CompactField({ label, value, unit }: BarField) {
  return (
    <span className="imm-field">
      <span className="imm-field-label">{label}</span>
      <span className="imm-field-value">{value}</span>
      {unit ? <span className="imm-field-unit">{unit}</span> : null}
    </span>
  );
}

function MiniAttitude({ snapshot, attitudeStyle }: {
  snapshot: HudSnapshot;
  attitudeStyle: AttitudeStyle;
}) {
  return (
    <div className="imm-bar-adi">
      <AttitudeIndicator
        snapshot={snapshot}
        attitudeStyle={attitudeStyle}
        clipId="immAdiClip"
        className="imm-adi-face"
      />
    </div>
  );
}

/*
 * UI-002 (owner decision): callsign and class are set-once identity, not live flight data —
 * they belong on the spawn card and debrief, not this rail. Only the amber SIM badge stays
 * here, so the live HUD never loses the unmistakability the badge alone provides.
 */
function SimIdentity(_: { snapshot: HudSnapshot }) {
  return (
    <span className="imm-bar-sim">
      <span className="hud-sim-badge">SIM</span>
    </span>
  );
}

function NavDirector({ snapshot, navCue, compact = false }: {
  snapshot: HudSnapshot;
  navCue: ImmersiveHudNavCue | null;
  compact?: boolean;
}) {
  const relative = navCue === null ? null : relativeBearingDeg(snapshot.headingRad, navCue.bearingDeg);
  const relativeText = relative === null ? null : `${relative >= 0 ? "+" : "−"}${Math.abs(Math.round(relative))}°`;
  return (
    <span className={compact ? "imm-director-copy imm-director-copy-compact" : "imm-director-copy"}>
      <span className="imm-director-label">
        {navCue === null ? "NO DESTINATION SET" : `${navCue.destination} · ${navCue.distanceNm.toFixed(1)} NM`}
      </span>
      <span className="imm-director-heading">HDG {formatHeadingDeg(snapshot.headingRad)}°</span>
      {relativeText !== null && (
        <span className="imm-director-nav">
          <span
            className="imm-director-arrow"
            style={{ transform: `rotate(${Math.round(relative ?? 0)}deg)` }}
            aria-hidden="true"
          >↑</span>
          DEST {relativeText}
        </span>
      )}
      {compact && (
        <span className="imm-director-secondary">
          VSI {formatVsiFpm(snapshot.verticalSpeedMs)} · AGL {formatClearanceFt(snapshot.terrainClearanceM)}
        </span>
      )}
    </span>
  );
}

function BalancedRail({ snapshot, attitudeStyle, navCue }: {
  snapshot: HudSnapshot;
  attitudeStyle: AttitudeStyle;
  navCue: ImmersiveHudNavCue | null;
}) {
  return (
    <div className="imm-bar imm-bar-balanced" data-hud-variant="balanced">
      <SimIdentity snapshot={snapshot} />
      <CompactField label="IAS" value={formatIasKt(snapshot.iasMs)} unit="KT" />
      <MiniAttitude snapshot={snapshot} attitudeStyle={attitudeStyle} />
      <NavDirector snapshot={snapshot} navCue={navCue} compact />
      <CompactField label="ALT" value={formatAltFt(snapshot.altitudeM)} unit="FT" />
      <ImmersiveControlRow snapshot={snapshot} />
    </div>
  );
}

function Tape({ side, label, unit, value, range }: {
  side: "left" | "right";
  label: string;
  unit: string;
  value: number;
  range: TapeRange | null;
}) {
  const shown = Math.round(value);
  return (
    <span className="imm-tape" data-side={side}>
      <span className="imm-field-label">{label} · {unit}</span>
      <span className="tape-window">
        {range && (
          <span
            className="tape-strip"
            style={{ height: `${(range.max - range.min) * range.pxPerUnit}px`,
                     transform: `translateY(${tapeStripOffset(value, range)}px)` }}
          >
            {tapeTicks(range).map((t) => (
              <span
                key={t.value}
                className={`tape-tick ${t.major ? "major" : "minor"}`}
                style={{ bottom: `${t.y}px` }}
              >
                {t.major ? <span className="tt-label">{t.value}</span> : null}
              </span>
            ))}
          </span>
        )}
        <span className="tape-ptr">
          <span className="imm-field-value">{range ? shown : EM_DASH}</span>
        </span>
      </span>
    </span>
  );
}

function TapeRail({ snapshot, attitudeStyle, navCue, tapeRange }: {
  snapshot: HudSnapshot;
  attitudeStyle: AttitudeStyle;
  navCue: ImmersiveHudNavCue | null;
  tapeRange: { ias: TapeRange; alt: TapeRange } | null;
}) {
  return (
    <div className="imm-bar imm-bar-tapes" data-hud-variant="tapes">
      <Tape side="left" label="IAS" unit="KT" value={msToKt(snapshot.iasMs)} range={tapeRange?.ias ?? null} />
      <span className="imm-director">
        <MiniAttitude snapshot={snapshot} attitudeStyle={attitudeStyle} />
        <span className="imm-director-stack">
          <SimIdentity snapshot={snapshot} />
          <NavDirector snapshot={snapshot} navCue={navCue} />
          <span className="imm-director-systems">
            <span>VSI <b>{formatVsiFpm(snapshot.verticalSpeedMs)}</b></span>
            <span>AGL <b>{formatClearanceFt(snapshot.terrainClearanceM)}</b></span>
            <ImmersiveControlRow snapshot={snapshot} />
          </span>
        </span>
      </span>
      <Tape side="right" label="ALT" unit="FT" value={mToFt(snapshot.altitudeM)} range={tapeRange?.alt ?? null} />
    </div>
  );
}

export default function ImmersiveHudBar({
  snapshot,
  attitudeStyle,
  variant = "balanced",
  onVariantChange,
  navCue = null,
  approachWarnings = [],
  tapeRange = null,
  decluttered = false,
  toggleFaded = false,
}: {
  snapshot: HudSnapshot;
  attitudeStyle: AttitudeStyle;
  variant?: ImmersiveHudVariant;
  onVariantChange?(variant: ImmersiveHudVariant): void;
  navCue?: ImmersiveHudNavCue | null;
  approachWarnings?: string[];
  tapeRange?: { ias: TapeRange; alt: TapeRange } | null;
  /** Manual declutter (#57): hides the HUD-A/C layout toggle, an informational-only control. */
  decluttered?: boolean;
  /** Immersive auto-hide (#75): fade the HUD-A/C toggle with the rest of the chrome while flying.
   *  The instrument rail itself stays — only this layout-picker button hides. */
  toggleFaded?: boolean;
}) {
  const warnings = prioritizedImmersiveWarnings(snapshot, approachWarnings);
  return (
    <div className={`imm-hud imm-hud-${variant}`}>
      {variant === "balanced"
        ? <BalancedRail snapshot={snapshot} attitudeStyle={attitudeStyle} navCue={navCue} />
        : <TapeRail snapshot={snapshot} attitudeStyle={attitudeStyle} navCue={navCue} tapeRange={tapeRange} />}

      {onVariantChange !== undefined && !decluttered && (
        <button
          type="button"
          className={"imm-hud-toggle" + (toggleFaded ? " imm-hud-toggle-faded" : "")}
          onClick={() => onVariantChange(nextImmersiveHudVariant(variant))}
          aria-label={`HUD layout ${variant === "balanced" ? "A balanced rail" : "C compact tapes"}; switch to ${variant === "balanced" ? "C compact tapes" : "A balanced rail"}`}
          title={`Switch to HUD ${variant === "balanced" ? "C" : "A"}`}
        >
          HUD {variant === "balanced" ? "A" : "C"}
        </button>
      )}

      {warnings.length > 0 && (
        <div className="imm-hud-warnings" role="status" aria-live="polite">
          {warnings.map((warning) => (
            <span key={warning} className="hud-warning">{warning}</span>
          ))}
        </div>
      )}
    </div>
  );
}
