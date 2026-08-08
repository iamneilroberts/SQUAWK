/*
 * The airliner (b738) EFIS primary flight display for the unified glass: an attitude ball in the
 * middle, a moving SPEED tape on the left with flap/limit speed bugs, a moving ALTITUDE tape on
 * the right reading flight levels, heading across the top, and a Mach + config strip below. New
 * to this build, but every angle/offset comes from glassMath.ts (tested) and every string from
 * hud/format.ts (tested, unknown -> em-dash), so a tape and the HUD can never disagree.
 *
 * Hook-free like SixPack/AttitudeIndicator: the test calls it as a plain function and walks the
 * element tree without jsdom. The attitude ball is REUSED verbatim from AttitudeIndicator.
 */
import type { HudSnapshot } from "../hud/snapshot";
import type { ClassParams } from "../sim/types";
import { msToKt, mToFt } from "../sim/units";
import {
  EM_DASH, formatIasKt, formatAltFt, formatHeadingDeg, formatMach, formatFlightLevel,
  formatThrottlePct, formatFlaps, formatGear,
} from "../hud/format";
import { tapeTicks, tapeBugPx, type TapeTick } from "./glassMath";
import AttitudeIndicator from "./AttitudeIndicator";

const TAPE_H = 120; // px, tape column height
const TAPE_CY = TAPE_H / 2; // centre pointer
const SPD_HALF = 40; // kt visible each side of centre
const SPD_PX = 1.4; // px per kt
const ALT_HALF = 1000; // ft visible each side of centre
const ALT_PX = 0.055; // px per ft

type Bug = { px: number; label: string; kind: "limit" | "flap" };

function VerticalTape({ label, boxDigits, ticks, bugs, unit }: {
  label: string;
  boxDigits: string;
  ticks: TapeTick[];
  bugs: Bug[];
  unit: "spd" | "alt";
}) {
  const W = unit === "alt" ? 52 : 44;
  const cx = unit === "alt" ? 4 : W - 4; // ticks hang off the pointer edge
  const dir = unit === "alt" ? 1 : -1;
  return (
    <div className="efis-tape">
      <div className="efis-tape-label label">{label}</div>
      <svg viewBox={`0 0 ${W} ${TAPE_H}`} className="efis-tape-face" role="img">
        <rect x={0.5} y={0.5} width={W - 1} height={TAPE_H - 1} className="efis-tape-frame" />
        {ticks.map((t) => (
          <g key={t.value}>
            <line
              x1={cx} y1={TAPE_CY + t.px} x2={cx + dir * (t.major ? 8 : 4)} y2={TAPE_CY + t.px}
              className="efis-tape-tick"
            />
            {t.major && (
              <text
                x={cx + dir * 11} y={TAPE_CY + t.px + 3}
                className="efis-tape-num" textAnchor={unit === "alt" ? "start" : "end"}
              >
                {t.label}
              </text>
            )}
          </g>
        ))}
        {bugs.map((b, i) => (
          <rect
            key={i} x={cx - dir * 3} y={TAPE_CY + b.px - 2} width={6} height={4}
            className={b.kind === "limit" ? "efis-bug efis-bug-limit" : "efis-bug efis-bug-flap"}
          >
            <title>{b.label}</title>
          </rect>
        ))}
        <rect x={0} y={TAPE_CY - 9} width={W} height={18} className="efis-tape-box" />
        <text x={W / 2} y={TAPE_CY + 4} className="efis-tape-value" textAnchor="middle">
          {boxDigits}
        </text>
      </svg>
    </div>
  );
}

export default function EfisDisplay({ snapshot, params }: {
  snapshot: HudSnapshot | null;
  params: ClassParams;
}) {
  const iasKt = snapshot ? msToKt(snapshot.iasMs) : null;
  const altFt = snapshot ? mToFt(snapshot.altitudeM) : null;
  const mach = snapshot ? snapshot.machNumber : null;

  const spdTicks = tapeTicks({ center: iasKt, step: 10, halfWindow: SPD_HALF, pxPerUnit: SPD_PX, majorEvery: 2 });
  const altTicks = tapeTicks({ center: altFt, step: 200, halfWindow: ALT_HALF, pxPerUnit: ALT_PX, majorEvery: 2 });

  // Flap-maneuvering / limit speed bugs on the speed tape — the airliner's placard speeds, drawn
  // where they fall relative to the live IAS (glassMath keeps them off-tape when out of window).
  const speedBug = (valMs: number, label: string, kind: Bug["kind"]): Bug | null => {
    const px = tapeBugPx({ value: msToKt(valMs), center: iasKt, halfWindow: SPD_HALF, pxPerUnit: SPD_PX });
    return px === null ? null : { px, label, kind };
  };
  const bugs = [
    speedBug(params.limits.vfeIasMs, "VFE", "flap"),
    speedBug(params.limits.vnoIasMs, "VNO", "limit"),
    speedBug(params.limits.vneIasMs, "VNE", "limit"),
  ].filter((b): b is Bug => b !== null);

  return (
    <div className="efis">
      <div className="efis-top">
        <span className="efis-hdg-label label">HDG</span>
        <span className="efis-hdg-value">{formatHeadingDeg(snapshot?.headingRad ?? null)}</span>
      </div>
      <div className="efis-row">
        <VerticalTape label="SPD" boxDigits={formatIasKt(snapshot?.iasMs ?? null)} ticks={spdTicks} bugs={bugs} unit="spd" />
        <div className="efis-adi-wrap">
          <AttitudeIndicator
            snapshot={snapshot}
            attitudeStyle={params.display.attitudeStyle}
            clipId="efisAdi"
            className="efis-adi"
          />
        </div>
        <VerticalTape label="ALT" boxDigits={formatAltFt(snapshot?.altitudeM ?? null)} ticks={altTicks} bugs={[]} unit="alt" />
      </div>
      <div className="efis-strip">
        <span className="efis-strip-item">
          MACH <span className="efis-strip-value">{formatMach(mach)}</span>
        </span>
        <span className="efis-strip-item">{formatFlightLevel(snapshot?.altitudeM ?? null)}</span>
        {/* The airliner has no modeled N1 — throttle % is the honest thrust readout (decisions). */}
        <span className="efis-strip-item">THR {formatThrottlePct(snapshot?.throttle ?? null)}</span>
        <span className="efis-strip-item">{formatFlaps(snapshot?.flapLabel ?? null)}</span>
        <span className="efis-strip-item">
          {formatGear(snapshot?.gear ?? null, snapshot?.gearPosition ?? null)}
        </span>
      </div>
      {snapshot === null && <div className="efis-nodata label">{EM_DASH} NO SIGNAL</div>}
    </div>
  );
}
