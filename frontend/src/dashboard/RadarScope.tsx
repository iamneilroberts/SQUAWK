/*
 * The PPI scope (spec D-4). SVG rather than canvas (decisions.md CD-008): a few dozen blips at
 * 10 Hz is nothing for the DOM, it keeps this a pure function of its props — which is what makes
 * it testable without jsdom — and it is the same drawing idiom as SixPack.
 *
 * Hook-free. The selected range is state in DashboardStrip, handed down and changed by callback,
 * for the same reason panel collapse is (CD-006).
 */
import type { Contact, FeedStatus } from "../data/types";
import type { HudSnapshot } from "../hud/snapshot";
import { formatHeadingDeg } from "../hud/format";
import { radToDeg } from "../sim/units";
import {
  RANGE_PRESETS_NM, SCOPE_RADIUS_PX, blipsFor, ringsFor, scopeStatus,
} from "./radarMath";

const SIZE = SCOPE_RADIUS_PX * 2 + 16; // a little bezel outside the outer ring
const C = SIZE / 2;

export default function RadarScope({
  snapshot, contacts, feedStatus, ghostHex, scopeRangeNm, onRangeChange,
}: {
  snapshot: HudSnapshot | null;
  contacts: Map<string, Contact>;
  feedStatus: FeedStatus;
  ghostHex: string | null;
  scopeRangeNm: number;
  onRangeChange(nm: number): void;
}) {
  const status = scopeStatus(feedStatus);
  const ownHeadingDeg = snapshot === null ? 0 : radToDeg(snapshot.headingRad);
  const blips =
    snapshot === null
      ? []
      : blipsFor({
          contacts,
          own: { latDeg: snapshot.latDeg, lonDeg: snapshot.lonDeg },
          ownHeadingDeg,
          scopeRangeNm,
          ghostHex,
        });

  return (
    <div className="radar">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={status.dim ? "radar-face radar-dim" : "radar-face"} role="img">
        {ringsFor(scopeRangeNm).map((ring) => (
          <g key={ring.labelNm}>
            <circle cx={C} cy={C} r={ring.radiusPx} className="radar-ring" />
            <text x={C + 3} y={C - ring.radiusPx + 9} className="radar-ring-label">
              {ring.labelNm}
            </text>
          </g>
        ))}
        <line x1={C} y1={C - SCOPE_RADIUS_PX} x2={C} y2={C + SCOPE_RADIUS_PX} className="radar-ring" />
        <line x1={C - SCOPE_RADIUS_PX} y1={C} x2={C + SCOPE_RADIUS_PX} y2={C} className="radar-ring" />

        {blips.map((b) => (
          <rect
            key={b.hex}
            data-hex={b.hex}
            x={C + b.x - 2}
            y={C + b.y - 2}
            width={4}
            height={4}
            className={[
              "radar-blip",
              b.military ? "radar-blip-mil" : "",
              b.ghost ? "radar-blip-ghost" : "",
            ].filter(Boolean).join(" ")}
          />
        ))}

        <path d={`M ${C} ${C - 7} L ${C - 5} ${C + 5} L ${C} ${C + 2} L ${C + 5} ${C + 5} Z`}
          className="radar-own" />
      </svg>

      <div className="radar-footer">
        <span className="radar-heading">HDG {formatHeadingDeg(snapshot?.headingRad ?? null)}</span>
        {status.text !== null && <span className="radar-status">{status.text}</span>}
      </div>

      <div className="radar-ranges">
        {RANGE_PRESETS_NM.map((nm) => (
          <button
            type="button"
            key={nm}
            className={
              nm === scopeRangeNm
                ? "status-chip-button status-chip-button-active"
                : "status-chip-button"
            }
            onClick={() => onRangeChange(nm)}
          >
            {nm}
          </button>
        ))}
        <span className="radar-range-unit">NM</span>
      </div>
    </div>
  );
}
