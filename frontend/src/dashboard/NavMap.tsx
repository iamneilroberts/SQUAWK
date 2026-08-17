/*
 * The moving map (issue #11). SVG, same idiom as RadarScope, and for the same reasons (CD-008):
 * a few dozen marks at 10 Hz is nothing for the DOM and it keeps the panel a pure function of its
 * props — testable without jsdom.
 *
 * This COMPLEMENTS the radar rather than replacing it (decisions.md NM-001): the radar is a
 * heading-up traffic PPI; this is a NORTH-UP geographic map that adds airports. North-up keeps
 * the airport labels upright and readable; the own-ship chevron rotates to show heading instead.
 *
 * Hook-free. The selected range is state in DashboardStrip, handed down and changed by callback,
 * exactly like the radar's range (CD-006). Airports are passed in (bundled, not store) so this
 * stays a pure render.
 */
import type { Airport } from "../data/airports";
import type { Contact, FeedStatus } from "../data/types";
import type { HudSnapshot } from "../hud/snapshot";
import { formatHeadingDeg } from "../hud/format";
import { radToDeg } from "../sim/units";
import { coverageNote, ringsFor } from "./radarMath";
import {
  NAV_RADIUS_PX, NAV_RANGE_PRESETS_NM, airportBlips, navContacts, navStatus,
} from "./navMath";
import { NavWeatherLayer } from "./NavWeatherLayer";
import { NavBasemapLayer } from "./NavBasemapLayer";
import {
  radarChipText, resolveZoom, RAINVIEWER_CREDIT, type NavWeatherState,
} from "./navWeatherMath";

const ESRI_MAP_CREDIT = "MAP © ESRI";

const SIZE = NAV_RADIUS_PX * 2 + 16; // a little bezel outside the outer ring
const C = SIZE / 2;

export default function NavMap({
  snapshot, airports, contacts, feedStatus, ghostHex, navRangeNm, feedRadiusNm, onRangeChange,
  showRadar = false, navWeather = { kind: "no-position" }, showBasemap = false, showLabels = false,
}: {
  snapshot: HudSnapshot | null;
  airports: Airport[];
  contacts: Map<string, Contact>;
  feedStatus: FeedStatus;
  ghostHex: string | null;
  navRangeNm: number;
  feedRadiusNm: number;
  onRangeChange(nm: number): void;
  showRadar?: boolean;
  navWeather?: NavWeatherState;
  /** Line basemap under the nav marks (#67). Off by default so NavMap stays a pure tree for
   *  its non-jsdom test (the basemap layer is hook-ful, like NavWeatherLayer). */
  showBasemap?: boolean;
  /** Overlay place-name labels on the basemap — follows the menu LABELS chip (store `labelsOn`). */
  showLabels?: boolean;
}) {
  const status = navStatus(feedStatus);
  const coverage = coverageNote(navRangeNm, feedRadiusNm);
  const ownHeadingDeg = snapshot === null ? 0 : radToDeg(snapshot.headingRad);
  const own = snapshot === null ? null : { latDeg: snapshot.latDeg, lonDeg: snapshot.lonDeg };
  const ports = own === null ? [] : airportBlips({ airports, own, navRangeNm });
  const blips = own === null ? [] : navContacts({ contacts, own, navRangeNm, ghostHex });

  // WX precip overlay (issue #17): only ever drawn on the honest `ok` state; the chip states any
  // non-`ok` state instead. `coarse` = the tile zoom was capped (small range), an upscale flag.
  const radarCoarse = own === null ? false : resolveZoom(navRangeNm, own.latDeg, NAV_RADIUS_PX).capped;
  const radarChip = showRadar ? radarChipText(navWeather, Date.now(), radarCoarse) : null;
  const showRadarLayer = showRadar && own !== null && navWeather.kind === "ok";
  const showBasemapLayer = showBasemap && own !== null;
  // Nominal precip age reads cyan (live data); any warning (offline/stale/coarse) reads amber.
  const radarNominal =
    radarChip !== null && navWeather.kind === "ok" && !radarChip.includes("STALE") && !radarChip.includes("COARSE");

  return (
    <div className="navmap">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="navmap-face" role="img">
        {/* Satellite basemap (#67): the very bottom layer, under the rings/precip/marks, clipped to
            the circle by the warp. own !== null (in flight) here via showBasemapLayer. */}
        {showBasemapLayer && own !== null && (
          <foreignObject
            x={C - NAV_RADIUS_PX}
            y={C - NAV_RADIUS_PX}
            width={NAV_RADIUS_PX * 2}
            height={NAV_RADIUS_PX * 2}
            className="navmap-basemap"
          >
            <NavBasemapLayer own={own} navRangeNm={navRangeNm} showLabels={showLabels} />
          </foreignObject>
        )}
        {ringsFor(navRangeNm).map((ring) => (
          <g key={ring.labelNm}>
            <circle cx={C} cy={C} r={ring.radiusPx} className="navmap-ring" />
            <text x={C + 3} y={C - ring.radiusPx + 9} className="navmap-ring-label">
              {ring.labelNm}
            </text>
          </g>
        ))}
        <line x1={C} y1={C - NAV_RADIUS_PX} x2={C} y2={C + NAV_RADIUS_PX} className="navmap-ring" />
        <line x1={C - NAV_RADIUS_PX} y1={C} x2={C + NAV_RADIUS_PX} y2={C} className="navmap-ring" />

        {/* North is fixed (north-up), so the N sits at the top of the face permanently. */}
        <text x={C} y={C - NAV_RADIUS_PX - 2} textAnchor="middle" className="navmap-north">N</text>

        {/* Precip radar: UNDER airports/traffic, above the rings, clipped to the circle by the warp
            itself (out-of-circle pixels are transparent). Only mounted on the honest `ok` state. */}
        {showRadarLayer && navWeather.kind === "ok" && own !== null && (
          <foreignObject
            x={C - NAV_RADIUS_PX}
            y={C - NAV_RADIUS_PX}
            width={NAV_RADIUS_PX * 2}
            height={NAV_RADIUS_PX * 2}
            className="navmap-wx"
          >
            <NavWeatherLayer
              own={own}
              navRangeNm={navRangeNm}
              host={navWeather.host}
              frame={navWeather.frame}
            />
          </foreignObject>
        )}

        {/* Airports: bundled, not a feed — drawn at full opacity even when the traffic is frozen. */}
        {ports.map((p) => (
          <g key={p.ident} data-ident={p.ident} className={`navmap-airport navmap-airport-${p.size}`}>
            <rect x={C + p.x - 2} y={C + p.y - 2} width={4} height={4} className="navmap-airport-mark" />
            <text x={C + p.x + 5} y={C + p.y + 3} className="navmap-airport-label">{p.label}</text>
          </g>
        ))}

        {/* Traffic freezes with the feed; the group carries the dim, so airports keep full opacity. */}
        <g className={status.dim ? "navmap-traffic navmap-dim" : "navmap-traffic"}>
          {blips.map((b) => (
            <rect
              key={b.hex}
              data-hex={b.hex}
              x={C + b.x - 2}
              y={C + b.y - 2}
              width={4}
              height={4}
              className={[
                "navmap-blip",
                b.military ? "navmap-blip-mil" : "",
                b.ghost ? "navmap-blip-ghost" : "",
              ].filter(Boolean).join(" ")}
            />
          ))}
        </g>

        {coverage !== null && (
          <text x={C} y={C + NAV_RADIUS_PX + 6} textAnchor="middle" className="navmap-coverage-note">
            {coverage}
          </text>
        )}

        {/* Own ship rotates to heading; the map underneath does not. */}
        <path
          d={`M ${C} ${C - 7} L ${C - 5} ${C + 5} L ${C} ${C + 2} L ${C + 5} ${C + 5} Z`}
          transform={`rotate(${ownHeadingDeg} ${C} ${C})`}
          className="navmap-own"
        />
      </svg>

      <div className="navmap-footer">
        <span className="navmap-heading">HDG {formatHeadingDeg(snapshot?.headingRad ?? null)}</span>
        {status.text !== null && <span className="navmap-status">{status.text}</span>}
        {radarChip !== null && (
          <span className={radarNominal ? "navmap-status navmap-status-wx" : "navmap-status"}>{radarChip}</span>
        )}
        {showBasemapLayer && <span className="navmap-attribution">{ESRI_MAP_CREDIT}</span>}
        {showRadarLayer && <span className="navmap-attribution">{RAINVIEWER_CREDIT}</span>}
      </div>

      <div className="navmap-ranges">
        {NAV_RANGE_PRESETS_NM.map((nm) => (
          <button
            type="button"
            key={nm}
            className={
              nm === navRangeNm
                ? "status-chip-button status-chip-button-active"
                : "status-chip-button"
            }
            onClick={() => onRangeChange(nm)}
          >
            {nm}
          </button>
        ))}
        <span className="navmap-range-unit">NM</span>
      </div>
    </div>
  );
}
