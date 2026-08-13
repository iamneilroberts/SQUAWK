/*
 * Satellite basemap for the nav face (issue #67). The same tile-warp the precip overlay uses
 * (navTileWarp), but fed Esri World Imagery tiles instead of RainViewer radar — so the north-up
 * nav circle sits on a real satellite image instead of black, giving quick "where am I" context.
 *
 * Keyless, browser-direct (no proxy), like the RainViewer overlay. A tile that fails to load —
 * offline, throttled, or CORS-blocked — is skipped and left transparent, and if the whole tile set
 * taints the canvas the warp bails to transparent: the face falls back to its black background,
 * an honest "no imagery here", never a substituted picture. Attribution (IMAGERY © ESRI) is shown
 * on the face by NavMap whenever this layer is mounted.
 *
 * HOOK-FREE on purpose (like NavMap itself): a callback ref runs the warp only when React commits
 * the canvas to the real DOM, so NavMap's non-jsdom test can walk and invoke this component without
 * a hooks context. The ref throttles re-warps via a dataset key (own quantised to ~0.6 NM), so
 * 10 Hz snapshot churn does not re-fetch tiles every tick.
 */
import { NAV_RADIUS_PX } from "./navMath";
import { warpTilesToNavCircle } from "./navTileWarp";
import type { LonLat } from "./navWeatherMath";

// Esri World Imagery XYZ tiles (ArcGIS path order is z/y/x). Same imagery as the Cesium basemap.
const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
// Esri imagery goes far deeper than the radar tiles; cap high enough for a crisp face at close range.
const BASEMAP_MAX_Z = 12;
// Dim the imagery so the cyan rings, airport marks and own-ship chevron stay legible over it.
const BASEMAP_ALPHA = 0.62;

export function NavBasemapLayer({
  own,
  navRangeNm,
  radiusPx = NAV_RADIUS_PX,
}: {
  own: LonLat;
  navRangeNm: number;
  radiusPx?: number;
}) {
  const side = radiusPx * 2;
  const qLat = Math.round(own.latDeg * 100) / 100;
  const qLon = Math.round(own.lonDeg * 100) / 100;
  const key = `${qLat},${qLon},${navRangeNm},${radiusPx}`;

  return (
    <canvas
      width={side}
      height={side}
      className="navmap-basemap-canvas"
      style={{ opacity: BASEMAP_ALPHA, width: side, height: side }}
      ref={(canvas) => {
        if (canvas === null) return;
        if (canvas.dataset.navKey === key) return; // already warped for these params
        canvas.dataset.navKey = key;
        void warpTilesToNavCircle(canvas, {
          own: { latDeg: qLat, lonDeg: qLon },
          navRangeNm,
          radiusPx,
          maxZ: BASEMAP_MAX_Z,
          tileUrl: (z, x, y) => `${ESRI_IMAGERY}/${z}/${y}/${x}`,
        });
      }}
    />
  );
}
