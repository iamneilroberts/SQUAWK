/*
 * Line basemap for the nav face (issue #67, reworked twice). BRIGHT lines on the near-black HUD
 * face — no gray photo-fill — so the geography reads through the traffic clutter (owner call: the
 * dimmed dark-gray disc was illegible). Same tile-warp the precip overlay uses (navTileWarp), fed
 * Esri transparent reference tiles.
 *
 * Two STACKED transparent layers over the face's own near-black background (NO opaque base fill):
 *   - lines  — `Reference/World_Transportation` (transparent PNG): roads / rail — the always-on
 *              geographic line map. Bright-filtered so it punches through the contact squares.
 *   - labels — `Reference/World_Boundaries_and_Places` (transparent PNG): admin boundaries + place
 *              names. Mounted ONLY when the menu LABELS chip is on (`showLabels`, store `labelsOn`),
 *              so lines stay always-on while the text follows that one control.
 * Layering purpose-built transparent canvases keeps navTileWarp untouched (each warps its own tile
 * source) and lets the dark face show between the bright lines.
 *
 * Keyless, browser-direct (no proxy). Host is `services.arcgisonline.com` — the ONLY arcgisonline
 * host the CSP img-src whitelists (worker/http/security.ts + public/_headers); the `server.` alias
 * is blocked:csp (that was the old "credits ESRI, black face" bug — see decisions.md 2026-08-17).
 * A tile that fails to load is skipped/transparent, never substituted; a tainted canvas bails to
 * transparent. Attribution (MAP © ESRI) is shown on the face by NavMap whenever this layer mounts.
 *
 * HOOK-FREE on purpose (like NavMap itself): a callback ref runs the warp only when React commits
 * the canvas to the real DOM. The ref throttles re-warps via a dataset key (own quantised to
 * ~0.6 NM), so 10 Hz snapshot churn does not re-fetch tiles every tick. Brightness is a CSS filter
 * (.navmap-basemap-canvas in tokens.css), not baked into pixels — cheap to tune.
 */
import { NAV_RADIUS_PX } from "./navMath";
import { warpTilesToNavCircle } from "./navTileWarp";
import type { LonLat } from "./navWeatherMath";

const ESRI_REF = "https://services.arcgisonline.com/ArcGIS/rest/services/Reference";
// Transparent line + label reference layers (both PNG with alpha) over the near-black face.
const TRANSPORT_LINES = `${ESRI_REF}/World_Transportation/MapServer/tile`;
const BOUNDARY_LABELS = `${ESRI_REF}/World_Boundaries_and_Places/MapServer/tile`;
// Esri reference tiles go far deeper than the radar tiles; cap high enough for a crisp face up close.
const BASEMAP_MAX_Z = 12;

/** One warped tile layer as its own canvas — the shared piece of both the line and label layers. */
function WarpCanvas({
  own,
  navRangeNm,
  radiusPx,
  tileUrl,
  className,
}: {
  own: LonLat;
  navRangeNm: number;
  radiusPx: number;
  tileUrl: string;
  className: string;
}) {
  const side = radiusPx * 2;
  const qLat = Math.round(own.latDeg * 100) / 100;
  const qLon = Math.round(own.lonDeg * 100) / 100;
  // The tile source is part of the key: line and label canvases must not share a warped result.
  const key = `${tileUrl}|${qLat},${qLon},${navRangeNm},${radiusPx}`;

  return (
    <canvas
      width={side}
      height={side}
      className={className}
      style={{ width: side, height: side }}
      ref={(canvas) => {
        if (canvas === null) return;
        if (canvas.dataset.navKey === key) return; // already warped for these params
        canvas.dataset.navKey = key;
        void warpTilesToNavCircle(canvas, {
          own: { latDeg: qLat, lonDeg: qLon },
          navRangeNm,
          radiusPx,
          maxZ: BASEMAP_MAX_Z,
          tileUrl: (z, x, y) => `${tileUrl}/${z}/${y}/${x}`,
        });
      }}
    />
  );
}

export function NavBasemapLayer({
  own,
  navRangeNm,
  radiusPx = NAV_RADIUS_PX,
  showLabels = false,
}: {
  own: LonLat;
  navRangeNm: number;
  radiusPx?: number;
  /** Follows the menu LABELS chip (store `labelsOn`): overlay boundaries + place names when on. */
  showLabels?: boolean;
}) {
  const side = radiusPx * 2;
  return (
    <div className="navmap-basemap-stack" style={{ width: side, height: side }}>
      <WarpCanvas
        own={own}
        navRangeNm={navRangeNm}
        radiusPx={radiusPx}
        tileUrl={TRANSPORT_LINES}
        className="navmap-basemap-canvas navmap-basemap-lines"
      />
      {showLabels && (
        <WarpCanvas
          own={own}
          navRangeNm={navRangeNm}
          radiusPx={radiusPx}
          tileUrl={BOUNDARY_LABELS}
          className="navmap-basemap-canvas navmap-basemap-labels"
        />
      )}
    </div>
  );
}
