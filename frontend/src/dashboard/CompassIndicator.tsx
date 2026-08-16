/*
 * The small top-right compass card (hud chrome rework, owner-approved mock "Compass S · signin
 * moved"). Mirrors AttitudeIndicator.tsx's LORAN styling and geometry (same 120x120 viewBox,
 * same C/R dial constants, the same `gauge-bezel`/`gauge-lubber` classes) so the two cards read as
 * one instrument family, but this one is a standalone rotating DG rather than a shared subcomponent
 * — SixPack already has its own inline directional gyro for the six-pack face, this is the
 * dedicated top-right overlay instrument the split-HUD chrome hangs off the screen edge.
 *
 * Tick layout is pure/tested (gaugeMath.compassTicks); the digital readout is formatHeadingDeg,
 * the same string the HUD top bar prints, so the dial and the number can never disagree.
 * Hook-free like AttitudeIndicator: the test calls it as a plain function and walks the tree.
 */
import { formatHeadingDeg } from "../hud/format";
import { compassTicks, headingCardDeg } from "./gaugeMath";

const C = 60; // dial centre inside the 120x120 viewBox, same as AttitudeIndicator
const R = 54; // bezel radius

function polar(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

/** One rounding rule for the rotate transform, so tests can assert an exact string. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function CompassIndicator({
  headingRad,
  className = "compass-face",
}: {
  headingRad: number | null;
  className?: string;
}) {
  const card = headingCardDeg(headingRad);

  return (
    <div className="compass-card">
      <div className="compass-card-label label">HDG</div>
      <div className="compass-face-wrap">
        <svg viewBox="0 0 120 120" className={className} role="img">
          <circle cx={C} cy={C} r={R} className="gauge-bezel" />
          {card !== null && (
            <g transform={`rotate(${round(card)} ${C} ${C})`}>
              {compassTicks().map((t) => (
                <line
                  key={t.deg}
                  x1={polar(t.deg, R).x} y1={polar(t.deg, R).y}
                  x2={polar(t.deg, R - (t.major ? 11 : 6)).x} y2={polar(t.deg, R - (t.major ? 11 : 6)).y}
                  className={t.major ? "compass-tick-major" : "compass-tick-minor"}
                />
              ))}
              {compassTicks().filter((t) => t.major).map((t) => (
                <text
                  key={t.deg}
                  x={polar(t.deg, R - 20).x} y={polar(t.deg, R - 20).y + 3}
                  textAnchor="middle"
                  className={t.cardinal !== null ? "compass-cardinal" : "compass-tick-label"}
                >
                  {t.cardinal ?? String(t.deg / 10)}
                </text>
              ))}
            </g>
          )}
          {/* Fixed lubber triangle — never rotates, always points at the true heading at top. */}
          <path d={`M ${C - 6} 8 L ${C + 6} 8 L ${C} 18 Z`} className="gauge-lubber" />
        </svg>
        <div className="compass-digital">{formatHeadingDeg(headingRad)}</div>
      </div>
    </div>
  );
}
