/*
 * Six analog dials, hand-rolled SVG, LORAN line style: 1px strokes, cyan for nominal data,
 * amber for anything the aeroplane is doing that it should not be. No logic lives here —
 * every angle comes from gaugeMath.ts, where it is tested, and every digital readout comes
 * from hud/format.ts, so a dial and the HUD can never disagree about the same number.
 *
 * Hook-free on purpose: that is what lets the test call it as a plain function and walk the
 * returned element tree without jsdom.
 */
import type { ReactNode } from "react";
import type { HudSnapshot } from "../hud/snapshot";
import type { ClassParams } from "../sim/types";
import { EM_DASH, formatHeadingDeg, formatIasKt, formatVsiFpm } from "../hud/format";
import {
  asiArcs, asiNeedle, asiTicks, altimeterDrum, altimeterNeedle, attitudePitchOffsetPx, attitudeRollDeg,
  headingCardDeg, pitchLadderRungs, slipBallOffsetPx, turnSymbolBankDeg, vsiNeedle,
  TC_SYMBOL_BANK_AT_STD_DEG, type Arc, type Needle,
} from "./gaugeMath";

const C = 60;   // dial centre inside the 120x120 viewBox
const R = 54;   // bezel radius

function polar(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

function arcPath(fromDeg: number, toDeg: number, radius: number): string {
  const a = polar(fromDeg, radius);
  const b = polar(toDeg, radius);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

function Dial({ title, digits, needle, children }: {
  title: string;
  digits: string;
  needle: Needle | null;
  children?: ReactNode;
}) {
  return (
    <div className="gauge">
      <svg viewBox="0 0 120 120" className="gauge-face" role="img">
        <circle cx={C} cy={C} r={R} className="gauge-bezel" />
        {children}
        {needle && (
          <line
            x1={C} y1={C} x2={C} y2={14}
            className={needle.pegged ? "gauge-needle gauge-needle-pegged" : "gauge-needle"}
            transform={`rotate(${round(needle.deg)} ${C} ${C})`}
          />
        )}
        <circle cx={C} cy={C} r={3} className="gauge-hub" />
      </svg>
      <div className="gauge-label label">{title}</div>
      <div className="gauge-digits">{digits}</div>
      {needle?.pegged ? <div className="gauge-peg">PEG</div> : null}
    </div>
  );
}

/** One rounding rule for every transform, so the tests can assert exact strings. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function arcClass(a: Arc): string {
  return `gauge-arc gauge-arc-${a.kind}`;
}

export default function SixPack({ snapshot, params }: {
  snapshot: HudSnapshot | null;
  params: ClassParams;
}) {
  const ias = snapshot?.iasMs ?? null;
  const alt = snapshot?.altitudeM ?? null;
  const vsi = snapshot?.verticalSpeedMs ?? null;

  const roll = attitudeRollDeg(snapshot?.rollRad ?? null);
  const pitch = attitudePitchOffsetPx(snapshot?.pitchRad ?? null);
  const card = headingCardDeg(snapshot?.headingRad ?? null);
  const turn = turnSymbolBankDeg(snapshot?.turnRateRadS ?? null);
  const ball = slipBallOffsetPx(snapshot?.sideslipRad ?? null);

  return (
    <div className="six-pack">
      {/* --- airspeed --- */}
      <Dial title="ASI KT" digits={formatIasKt(ias)} needle={asiNeedle(ias, params.display.asiMinKt, params.display.asiMaxKt)}>
        {asiArcs(params).map((a) => (
          <path
            key={a.kind}
            className={arcClass(a)}
            d={a.kind === "red"
              ? `M ${polar(a.fromDeg, R - 10).x.toFixed(2)} ${polar(a.fromDeg, R - 10).y.toFixed(2)} L ${polar(a.fromDeg, R - 2).x.toFixed(2)} ${polar(a.fromDeg, R - 2).y.toFixed(2)}`
              : arcPath(a.fromDeg, a.toDeg, R - 6)}
          />
        ))}
        {asiTicks(params.display.asiMinKt, params.display.asiMaxKt).map((t) => (
          <text key={t.kt} x={polar(t.deg, R - 16).x} y={polar(t.deg, R - 16).y + 3}
            className="gauge-card-text" textAnchor="middle">{t.label}</text>
        ))}
      </Dial>

      {/* --- attitude --- */}
      <div className="gauge">
        <svg viewBox="0 0 120 120" className="gauge-face" role="img">
          <circle cx={C} cy={C} r={R} className="gauge-bezel" />
          {roll !== null && pitch !== null && (
            <g transform={`rotate(${round(roll)} ${C} ${C})`}>
              <g transform={`translate(0 ${round(pitch.px)})`}>
                <line x1={C - 46} y1={C} x2={C + 46} y2={C} className="gauge-horizon" />
                {pitchLadderRungs().map((r) => (
                  <line
                    key={r.deg}
                    x1={C - r.halfWidthPx} y1={C + round(r.px)}
                    x2={C + r.halfWidthPx} y2={C + round(r.px)}
                    className="gauge-ladder"
                  />
                ))}
              </g>
            </g>
          )}
          <path d={`M ${C - 18} ${C} L ${C - 6} ${C} L ${C} ${C + 5} L ${C + 6} ${C} L ${C + 18} ${C}`}
            className="gauge-aircraft" />
        </svg>
        <div className="gauge-label label">ATTITUDE</div>
        <div className="gauge-digits">
          {roll === null ? EM_DASH : `${roll > 0 ? "L" : roll < 0 ? "R" : ""}${Math.abs(Math.round(roll))}°`}
        </div>
      </div>

      {/* --- altimeter (drum-pointer: one hundreds hand + a digital drum) --- */}
      <Dial title="ALT FT" digits={altimeterDrum(alt)} needle={altimeterNeedle(alt)}>
        {[0, 90, 180, 270].map((d) => (
          <line key={d}
            x1={polar(d, R - 10).x} y1={polar(d, R - 10).y}
            x2={polar(d, R - 2).x} y2={polar(d, R - 2).y}
            className="gauge-tick" />
        ))}
      </Dial>

      {/* --- turn coordinator: rate-of-turn symbol + the sideslip ball --- */}
      <div className="gauge">
        <svg viewBox="0 0 120 120" className="gauge-face" role="img">
          <circle cx={C} cy={C} r={R} className="gauge-bezel" />
          <line x1={polar(-TC_SYMBOL_BANK_AT_STD_DEG, R - 14).x} y1={polar(-TC_SYMBOL_BANK_AT_STD_DEG, R - 14).y}
            x2={polar(-TC_SYMBOL_BANK_AT_STD_DEG, R - 4).x} y2={polar(-TC_SYMBOL_BANK_AT_STD_DEG, R - 4).y}
            className="gauge-tick" />
          <line x1={polar(TC_SYMBOL_BANK_AT_STD_DEG, R - 14).x} y1={polar(TC_SYMBOL_BANK_AT_STD_DEG, R - 14).y}
            x2={polar(TC_SYMBOL_BANK_AT_STD_DEG, R - 4).x} y2={polar(TC_SYMBOL_BANK_AT_STD_DEG, R - 4).y}
            className="gauge-tick" />
          {turn && (
            <g transform={`rotate(${round(turn.deg)} ${C} ${C})`}
              className={turn.pegged ? "gauge-needle-pegged" : undefined}>
              <line x1={C - 26} y1={C - 8} x2={C + 26} y2={C - 8} className="gauge-aircraft" />
              <line x1={C} y1={C - 8} x2={C} y2={C + 2} className="gauge-aircraft" />
            </g>
          )}
          <rect x={C - 32} y={C + 20} width={64} height={14} rx={2} className="gauge-race" />
          {ball && <circle cx={C + round(ball.px)} cy={C + 27} r={5} className="gauge-ball" />}
        </svg>
        <div className="gauge-label label">TURN</div>
        <div className="gauge-digits">SLIP β {ball === null ? EM_DASH : ""}</div>
        {turn?.pegged ? <div className="gauge-peg">PEG</div> : null}
      </div>

      {/* --- directional gyro --- */}
      <div className="gauge">
        <svg viewBox="0 0 120 120" className="gauge-face" role="img">
          <circle cx={C} cy={C} r={R} className="gauge-bezel" />
          {card !== null && (
            <g transform={`rotate(${round(card)} ${C} ${C})`}>
              {[0, 90, 180, 270].map((d, i) => (
                <text key={d} x={polar(d, R - 16).x} y={polar(d, R - 16).y + 4}
                  className="gauge-card-text" textAnchor="middle">
                  {["N", "E", "S", "W"][i]}
                </text>
              ))}
              {[30, 60, 120, 150, 210, 240, 300, 330].map((d) => (
                <line key={d}
                  x1={polar(d, R - 10).x} y1={polar(d, R - 10).y}
                  x2={polar(d, R - 3).x} y2={polar(d, R - 3).y}
                  className="gauge-tick" />
              ))}
            </g>
          )}
          <path d={`M ${C - 5} 10 L ${C + 5} 10 L ${C} 18 Z`} className="gauge-lubber" />
        </svg>
        <div className="gauge-label label">HDG</div>
        <div className="gauge-digits">{formatHeadingDeg(snapshot?.headingRad ?? null)}</div>
      </div>

      {/* --- vertical speed --- */}
      <Dial title="VSI FPM" digits={formatVsiFpm(vsi)} needle={vsiNeedle(vsi)}>
        {[180, 270, 360].map((d) => (
          <line key={d}
            x1={polar(d, R - 10).x} y1={polar(d, R - 10).y}
            x2={polar(d, R - 2).x} y2={polar(d, R - 2).y}
            className="gauge-tick" />
        ))}
      </Dial>
    </div>
  );
}
