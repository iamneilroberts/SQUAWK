/*
 * The artificial-horizon SVG, extracted verbatim from SixPack so the six-pack dial and the
 * mobile immersive top bar draw the SAME horizon from the SAME geometry — one place to be right.
 * Every angle still comes from gaugeMath.ts (attitudeRollDeg / attitudePitchOffsetPx), so a
 * dial and the bar can never disagree about the aeroplane's attitude.
 *
 * Hook-free like SixPack: the tests call it as a plain function and walk the element tree
 * without jsdom. `clipId` is a prop so two instances (the dial and the bar) never collide on a
 * duplicate SVG id; `className` sizes the face (a 120x120 viewBox scales to any pixel box).
 */
import type { HudSnapshot } from "../hud/snapshot";
import type { AttitudeStyle } from "../sim/types";
import { attitudePitchOffsetPx, attitudeRollDeg, bankScaleTicks, pitchLadderRungs } from "./gaugeMath";

const C = 60; // dial centre inside the 120x120 viewBox
const R = 54; // bezel radius

function polar(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

/** One rounding rule for every transform, so the tests can assert exact strings. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function AttitudeIndicator({
  snapshot,
  attitudeStyle,
  clipId = "adiClip",
  className = "gauge-face",
}: {
  snapshot: HudSnapshot | null;
  attitudeStyle: AttitudeStyle;
  clipId?: string;
  className?: string;
}) {
  const roll = attitudeRollDeg(snapshot?.rollRad ?? null);
  const pitch = attitudePitchOffsetPx(snapshot?.pitchRad ?? null);

  return (
    <svg viewBox="0 0 120 120" className={className} role="img">
      <defs><clipPath id={clipId}><circle cx={C} cy={C} r={R} /></clipPath></defs>
      <circle cx={C} cy={C} r={R} className="gauge-bezel" />
      {roll !== null && pitch !== null && (
        attitudeStyle === "ball" ? (
          <>
            <g clipPath={`url(#${clipId})`} transform={`rotate(${round(roll)} ${C} ${C})`}>
              <g transform={`translate(0 ${round(pitch.px)})`}>
                <rect x={C - R} y={C - R * 3} width={R * 2} height={R * 3} className="gauge-adi-sky" />
                <rect x={C - R} y={C} width={R * 2} height={R * 3} className="gauge-adi-ground" />
                <line x1={C - 46} y1={C} x2={C + 46} y2={C} className="gauge-adi-horizon" />
                {pitchLadderRungs().map((r) => (
                  <g key={r.deg}>
                    <line
                      x1={C - r.halfWidthPx} y1={C + round(r.px)}
                      x2={C + r.halfWidthPx} y2={C + round(r.px)}
                      className="gauge-ladder"
                    />
                    {/* Degree numbers on both ends of the rung, as on a real ADI — the bare line
                        alone doesn't say how many degrees of climb/dive it marks. */}
                    <text x={C - r.halfWidthPx - 4} y={C + round(r.px) + 3} textAnchor="end" className="gauge-ladder-num">{r.label}</text>
                    <text x={C + r.halfWidthPx + 4} y={C + round(r.px) + 3} textAnchor="start" className="gauge-ladder-num">{r.label}</text>
                  </g>
                ))}
              </g>
              {bankScaleTicks().map((t) => (
                <line
                  key={t.deg}
                  x1={polar(t.deg, R).x} y1={polar(t.deg, R).y}
                  x2={polar(t.deg, R - (t.major ? 8 : 4)).x} y2={polar(t.deg, R - (t.major ? 8 : 4)).y}
                  className={t.major ? "gauge-adi-bank-major" : "gauge-adi-bank"}
                />
              ))}
            </g>
            <path
              d={`M ${C - 4} ${C - R + 2} L ${C + 4} ${C - R + 2} L ${C} ${C - R + 10} Z`}
              className="gauge-adi-pointer"
            />
          </>
        ) : (
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
        )
      )}
      <path d={`M ${C - 18} ${C} L ${C - 6} ${C} L ${C} ${C + 5} L ${C + 6} ${C} L ${C + 18} ${C}`}
        className="gauge-aircraft" />
    </svg>
  );
}
