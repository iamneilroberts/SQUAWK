/*
 * Line basemap for the nav face (issue #67, reworked). A dark Esri "Dark Gray Canvas" line map
 * (coastlines, water, roads) under the north-up nav circle instead of satellite photography — the
 * owner found the imagery unhelpful; a clean line map with landmarks reads far better as a
 * "where am I" reference. Same tile-warp the precip overlay uses (navTileWarp), fed Esri Canvas
 * tiles.
 *
 * Two STACKED canvases, base + labels:
 *   - base   — `World_Dark_Gray_Base` (opaque JPEG): the dark line geography, always drawn.
 *   - labels — `World_Dark_Gray_Reference` (transparent PNG): place names / boundaries, the Esri
 *              companion overlay designed to sit ON the base. Mounted ONLY when the menu's LABELS
 *              chip is on (`showLabels`, from store `labelsOn`), so the map follows that one control.
 * Layering two purpose-built canvases keeps navTileWarp untouched (each canvas warps its own tile
 * source); the transparent label PNG composites naturally over the base beneath it.
 *
 * Keyless, browser-direct (no proxy). Host is `services.arcgisonline.com` — the ONLY arcgisonline
 * host the CSP img-src whitelists (worker/http/security.ts + public/_headers); the `server.` alias
 * is blocked:csp (that was the old "credits ESRI, black face" bug — see decisions.md 2026-08-17).
 * A tile that fails to load is skipped/transparent, never substituted; a tainted canvas bails to
 * transparent — the face falls back to black, an honest "no map here". Attribution (MAP © ESRI) is
 * shown on the face by NavMap whenever this layer is mounted.
 *
 * HOOK-FREE on purpose (like NavMap itself): a callback ref runs the warp only when React commits
 * the canvas to the real DOM. The ref throttles re-warps via a dataset key (own quantised to
 * ~0.6 NM), so 10 Hz snapshot churn does not re-fetch tiles every tick.
 */
import { NAV_RADIUS_PX } from "./navMath";
import { warpTilesToNavCircle } from "./navTileWarp";
import type { LonLat } from "./navWeatherMath";

const ESRI_CANVAS = "https://services.arcgisonline.com/ArcGIS/rest/services";
// Dark line geography (opaque) and the matching transparent place-name overlay.
const DARK_GRAY_BASE = `${ESRI_CANVAS}/Canvas/World_Dark_Gray_Base/MapServer/tile`;
const DARK_GRAY_LABELS = `${ESRI_CANVAS}/Canvas/World_Dark_Gray_Reference/MapServer/tile`;
// Esri Canvas tiles go far deeper than the radar tiles; cap high enough for a crisp face up close.
const BASEMAP_MAX_Z = 12;
// The base is already dark; a light dim keeps the cyan rings / chevron legible without washing the
// map out. Labels ride at full strength so place names stay readable.
const BASE_ALPHA = 0.72;

/** One warped tile layer as its own canvas — the shared piece of both the base and label layers. */
function WarpCanvas({
  own,
  navRangeNm,
  radiusPx,
  tileUrl,
  alpha,
  className,
}: {
  own: LonLat;
  navRangeNm: number;
  radiusPx: number;
  tileUrl: string;
  alpha: number;
  className: string;
}) {
  const side = radiusPx * 2;
  const qLat = Math.round(own.latDeg * 100) / 100;
  const qLon = Math.round(own.lonDeg * 100) / 100;
  // The tile source is part of the key: base and label canvases must not share a warped result.
  const key = `${tileUrl}|${qLat},${qLon},${navRangeNm},${radiusPx}`;

  return (
    <canvas
      width={side}
      height={side}
      className={className}
      style={{ opacity: alpha, width: side, height: side }}
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
  /** Follows the menu LABELS chip (store `labelsOn`): overlay place names when on. */
  showLabels?: boolean;
}) {
  const side = radiusPx * 2;
  return (
    <div className="navmap-basemap-stack" style={{ width: side, height: side }}>
      <WarpCanvas
        own={own}
        navRangeNm={navRangeNm}
        radiusPx={radiusPx}
        tileUrl={DARK_GRAY_BASE}
        alpha={BASE_ALPHA}
        className="navmap-basemap-canvas"
      />
      {showLabels && (
        <WarpCanvas
          own={own}
          navRangeNm={navRangeNm}
          radiusPx={radiusPx}
          tileUrl={DARK_GRAY_LABELS}
          alpha={1}
          className="navmap-basemap-canvas navmap-basemap-labels"
        />
      )}
    </div>
  );
}
