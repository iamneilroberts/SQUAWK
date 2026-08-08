/*
 * The fighter (f5e) HUD-style primary for the unified glass: a fixed boresight/gun cross, a
 * roll/pitch climb-dive ladder, the velocity vector (flight-path marker), a heading scale across
 * the top, and prominent G / Mach / AOA readouts with the F-5E's A/B DRY/WET annunciator. Sparse
 * on purpose. New to this build, but the ladder geometry is REUSED from gaugeMath (one scale as
 * the ADI, so ladder and marker agree) and the marker/heading math from glassMath — both tested.
 * Every digital string comes from hud/format.ts (unknown -> em-dash). Hook-free like SixPack.
 */
import type { HudSnapshot } from "../hud/snapshot";
import type { ClassParams } from "../sim/types";
import {
  EM_DASH, formatIasKt, formatAltFt, formatMach, formatG, formatAoaDeg, formatAfterburner,
} from "../hud/format";
import { attitudeRollDeg, attitudePitchOffsetPx, pitchLadderRungs, AI_PX_PER_DEG } from "./gaugeMath";
import { velocityVectorOffsetPx, headingTapeTicks } from "./glassMath";

const W = 220;
const H = 170;
const CX = W / 2;
const CY = H / 2 + 6; // nudge down so the heading scale has room up top
const HDG_Y = 16;
const HDG_PX_PER_DEG = 2.4;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function HudDisplay({ snapshot, params: _params }: {
  snapshot: HudSnapshot | null;
  params: ClassParams;
}) {
  void _params; // face is class-agnostic; kept for the uniform primary-display signature
  const roll = attitudeRollDeg(snapshot?.rollRad ?? null);
  const pitch = attitudePitchOffsetPx(snapshot?.pitchRad ?? null);
  const vv = velocityVectorOffsetPx({
    aoaRad: snapshot?.aoaRad ?? null,
    sideslipRad: snapshot?.sideslipRad ?? null,
    pxPerDeg: AI_PX_PER_DEG,
  });
  const hdgTicks = headingTapeTicks({
    headingDeg: snapshot ? (((snapshot.headingRad * 180) / Math.PI) % 360 + 360) % 360 : null,
    halfSpanDeg: 22, stepDeg: 5, pxPerDeg: HDG_PX_PER_DEG,
  });
  const abLit = snapshot ? (snapshot.afterburner ?? false) : null;

  return (
    <div className="hud-display">
      <svg viewBox={`0 0 ${W} ${H}`} className="hud-face" role="img">
        <defs>
          <clipPath id="hudLadderClip"><rect x={24} y={26} width={W - 48} height={H - 62} /></clipPath>
          <clipPath id="hudHdgClip"><rect x={CX - 56} y={4} width={112} height={20} /></clipPath>
        </defs>

        {/* heading scale */}
        <g clipPath="url(#hudHdgClip)">
          {hdgTicks.map((t) => (
            <g key={t.deg}>
              <line x1={CX + t.px} y1={HDG_Y} x2={CX + t.px} y2={HDG_Y - (t.major ? 6 : 3)} className="hud-line" />
              {t.major && t.label !== "" && (
                <text x={CX + t.px} y={HDG_Y + 8} className="hud-num" textAnchor="middle">{t.label}</text>
              )}
            </g>
          ))}
        </g>
        <path d={`M ${CX - 4} ${HDG_Y + 2} L ${CX + 4} ${HDG_Y + 2} L ${CX} ${HDG_Y + 7} Z`} className="hud-caret" />

        {/* pitch/roll ladder + horizon */}
        {roll !== null && pitch !== null && (
          <g clipPath="url(#hudLadderClip)">
            <g transform={`rotate(${round(roll)} ${CX} ${CY})`}>
              <g transform={`translate(0 ${round(pitch.px)})`}>
                <line x1={CX - 70} y1={CY} x2={CX + 70} y2={CY} className="hud-horizon" />
                {pitchLadderRungs().map((r) => (
                  <g key={r.deg}>
                    <line
                      x1={CX - r.halfWidthPx} y1={CY + round(r.px)} x2={CX + r.halfWidthPx} y2={CY + round(r.px)}
                      className="hud-ladder"
                    />
                    <text x={CX + r.halfWidthPx + 6} y={CY + round(r.px) + 3} className="hud-num" textAnchor="start">
                      {r.label}
                    </text>
                  </g>
                ))}
              </g>
            </g>
          </g>
        )}

        {/* fixed boresight / gun cross (aircraft waterline) */}
        <path
          d={`M ${CX - 20} ${CY} L ${CX - 7} ${CY} L ${CX} ${CY + 5} L ${CX + 7} ${CY} L ${CX + 20} ${CY}`}
          className="hud-boresight"
        />
        <line x1={CX} y1={CY - 5} x2={CX} y2={CY - 12} className="hud-boresight" />

        {/* velocity vector / flight-path marker */}
        {vv !== null && (
          <g className="hud-velocity-vector" transform={`translate(${round(CX + vv.x)} ${round(CY + vv.y)})`}>
            <circle cx={0} cy={0} r={5} className="hud-vv-ring" />
            <line x1={5} y1={0} x2={11} y2={0} className="hud-vv-ring" />
            <line x1={-5} y1={0} x2={-11} y2={0} className="hud-vv-ring" />
            <line x1={0} y1={-5} x2={0} y2={-11} className="hud-vv-ring" />
          </g>
        )}

        {/* airspeed (left) and altitude (right) boxes */}
        <text x={20} y={CY - 4} className="hud-box-label" textAnchor="start">IAS</text>
        <text x={20} y={CY + 8} className="hud-box-value" textAnchor="start">{formatIasKt(snapshot?.iasMs ?? null)}</text>
        <text x={W - 20} y={CY - 4} className="hud-box-label" textAnchor="end">ALT</text>
        <text x={W - 20} y={CY + 8} className="hud-box-value" textAnchor="end">{formatAltFt(snapshot?.altitudeM ?? null)}</text>
      </svg>

      {/* prominent tactical readouts below the glass */}
      <div className="hud-readouts">
        <span className="hud-readout">
          <span className="hud-readout-label label">G</span>
          <span className="hud-readout-value hud-readout-g">{formatG(snapshot?.loadFactor ?? null)}</span>
        </span>
        <span className="hud-readout">
          <span className="hud-readout-label label">AOA</span>
          <span className="hud-readout-value">{formatAoaDeg(snapshot?.aoaRad ?? null)}</span>
        </span>
        <span className="hud-readout">
          <span className="hud-readout-label label">MACH</span>
          <span className="hud-readout-value">{formatMach(snapshot ? snapshot.machNumber : null)}</span>
        </span>
        <span className={abLit ? "hud-readout hud-ab-wet" : "hud-readout"}>
          <span className="hud-readout-value">{formatAfterburner(abLit)}</span>
        </span>
      </div>
      {snapshot === null && <div className="hud-nodata label">{EM_DASH} NO SIGNAL</div>}
    </div>
  );
}
