/*
 * Shared tile-warp for the nav face: composite Web-Mercator XYZ tiles covering the circle into an
 * off-screen canvas, then warp each output pixel through navPixelToWorldPixel and sample. Pixels
 * outside the circle stay transparent (the warp returns null), which is the clip — no mask needed.
 *
 * Extracted from NavWeatherLayer (issue #67): the precip overlay and the satellite basemap use the
 * SAME projection, differing only in which tiles they fetch (a `tileUrl` closure) and the zoom cap.
 * A tile that fails to load is SKIPPED (left transparent), never substituted — honest-data rule.
 *
 * Impure DOM/canvas glue (Image decode, getImageData/putImageData), verified by build + a live
 * browser like the Cesium code; the pure math it calls (navPixelToWorldPixel, resolveZoom) is
 * unit-tested in navWeatherMath.ts.
 */
import {
  navPixelToWorldPixel, resolveZoom, RADAR_TILE_SIZE, RADAR_MAX_Z, type LonLat,
} from "./navWeatherMath";

function loadTile(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // untainted canvas → real pixels can be read back
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // skip, never substitute
    img.src = url;
  });
}

export async function warpTilesToNavCircle(
  canvas: HTMLCanvasElement,
  o: {
    own: LonLat;
    navRangeNm: number;
    radiusPx: number;
    /** Zoom cap: RADAR_MAX_Z for the coarse precip tiles, higher for a crisp imagery basemap. */
    maxZ?: number;
    /** Web-Mercator XYZ tile URL for (z, x, y). Return null to skip a tile. */
    tileUrl(z: number, x: number, y: number): string | null;
  },
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;

  const { z } = resolveZoom(o.navRangeNm, o.own.latDeg, o.radiusPx, o.maxZ ?? RADAR_MAX_Z);
  const tileSize = RADAR_TILE_SIZE;

  // World-pixel bounding box of the circle: sample a ring of bearings at full range (mercator
  // curvature means the extremes are not exactly on the cardinals, so a ring is the safe box).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let a = 0; a < 360; a += 15) {
    const rad = (a * Math.PI) / 180;
    const w = navPixelToWorldPixel({
      px: Math.sin(rad) * o.radiusPx,
      py: -Math.cos(rad) * o.radiusPx,
      own: o.own,
      navRangeNm: o.navRangeNm,
      z,
      radiusPx: o.radiusPx,
    });
    if (w === null) continue;
    minX = Math.min(minX, w.x);
    minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x);
    maxY = Math.max(maxY, w.y);
  }
  if (!Number.isFinite(minX)) return;

  const minTileX = Math.floor(minX / tileSize);
  const minTileY = Math.floor(minY / tileSize);
  const maxTileX = Math.floor(maxX / tileSize);
  const maxTileY = Math.floor(maxY / tileSize);
  const originX = minTileX * tileSize;
  const originY = minTileY * tileSize;
  const srcW = (maxTileX - minTileX + 1) * tileSize;
  const srcH = (maxTileY - minTileY + 1) * tileSize;

  const src = document.createElement("canvas");
  src.width = srcW;
  src.height = srcH;
  const srcCtx = src.getContext("2d");
  if (srcCtx === null) return;

  const n = Math.pow(2, z);
  const jobs: Promise<void>[] = [];
  for (let tx = minTileX; tx <= maxTileX; tx += 1) {
    for (let ty = minTileY; ty <= maxTileY; ty += 1) {
      const wrappedX = ((tx % n) + n) % n; // wrap longitude; y is clamped below
      if (ty < 0 || ty >= n) continue;
      const url = o.tileUrl(z, wrappedX, ty);
      if (url === null) continue;
      jobs.push(
        loadTile(url).then((img) => {
          if (img !== null) srcCtx.drawImage(img, tx * tileSize - originX, ty * tileSize - originY);
        }),
      );
    }
  }
  await Promise.all(jobs);

  // A cross-origin tile without CORS headers taints the canvas and getImageData throws. Treat that
  // as "no overlay" (transparent) rather than crashing the panel — honest degradation.
  let srcData: ImageData;
  try {
    srcData = srcCtx.getImageData(0, 0, srcW, srcH);
  } catch {
    return;
  }
  const side = o.radiusPx * 2;
  const out = ctx.createImageData(side, side);
  for (let oy = 0; oy < side; oy += 1) {
    for (let ox = 0; ox < side; ox += 1) {
      const w = navPixelToWorldPixel({
        px: ox - o.radiusPx,
        py: oy - o.radiusPx,
        own: o.own,
        navRangeNm: o.navRangeNm,
        z,
        radiusPx: o.radiusPx,
      });
      if (w === null) continue; // outside the circle → transparent (the clip)
      const sx = Math.round(w.x - originX);
      const sy = Math.round(w.y - originY);
      if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) continue;
      const si = (sy * srcW + sx) * 4;
      const oi = (oy * side + ox) * 4;
      out.data[oi] = srcData.data[si];
      out.data[oi + 1] = srcData.data[si + 1];
      out.data[oi + 2] = srcData.data[si + 2];
      out.data[oi + 3] = srcData.data[si + 3];
    }
  }
  ctx.clearRect(0, 0, side, side);
  ctx.putImageData(out, 0, 0);
}
