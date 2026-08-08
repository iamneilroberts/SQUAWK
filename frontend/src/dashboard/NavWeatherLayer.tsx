/*
 * The impure half of the RainViewer precipitation overlay (issue #17): the manifest hook and the
 * canvas that reprojects Web-Mercator radar tiles onto the north-up NM-polar nav face. All the
 * PURE math (the warp, the zoom pick, the manifest parse, the state/chip) is in navWeatherMath.ts
 * and unit-tested there; this file is the DOM/canvas glue (fetch, <img> decode, getImageData /
 * putImageData) — the same testing boundary the Cesium code sits behind, verified by build + a
 * live browser rather than jsdom.
 *
 * Honest-data rule: tiles are loaded crossOrigin='anonymous' so the canvas is NOT tainted and we
 * read real pixels; a tile that fails to load is SKIPPED (left transparent), never substituted.
 * A transparent RainViewer pixel legitimately means "no precipitation there", so an empty overlay
 * is an honest clear sky, not an invented one. Nothing renders unless the state is `ok`.
 */
import { useEffect, useRef, useState } from "react";
import type { HudSnapshot } from "../hud/snapshot";
import { NAV_RADIUS_PX } from "./navMath";
import {
  buildTileUrl,
  navPixelToWorldPixel,
  parseManifest,
  pickNewestFrame,
  resolveZoom,
  RADAR_ALPHA,
  RADAR_TILE_SIZE,
  type LonLat,
  type NavWeatherState,
  type RadarFrame,
} from "./navWeatherMath";

const MANIFEST_URL = "https://api.rainviewer.com/public/weather-maps.json";
// Re-fetch the manifest on a slow timer and REBUILD the layer keyed to the newest frame — never
// mutate a stale frame in place. RainViewer publishes a new frame ~every 10 min.
const MANIFEST_REFRESH_MS = 2 * 60_000;

type Feed =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unreachable" }
  | { kind: "ok"; host: string; frame: RadarFrame };

/**
 * Fetches + parses the RainViewer manifest when `enabled`, picks the newest observed frame, and
 * folds in own position to produce a NavWeatherState. Cloned from WeatherPanel.useWeather: manifest
 * failure or an unusable document → `unreachable` (NO RADAR FEED), distinct from the ADS-B feed.
 */
export function useNavWeather(snapshot: HudSnapshot | null, enabled: boolean): NavWeatherState {
  const [feed, setFeed] = useState<Feed>({ kind: "idle" });

  useEffect(() => {
    if (!enabled) {
      setFeed({ kind: "idle" });
      return;
    }
    let cancelled = false;
    async function load() {
      // Keep the last-good frame on screen while refreshing, so a poll does not flash the overlay.
      setFeed((f) => (f.kind === "ok" ? f : { kind: "loading" }));
      try {
        const res = await fetch(MANIFEST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        const manifest = parseManifest(await res.json());
        const frame = manifest ? pickNewestFrame(manifest.frames) : null;
        if (cancelled) return;
        if (!manifest || !frame) {
          setFeed({ kind: "unreachable" });
          return;
        }
        setFeed({ kind: "ok", host: manifest.host, frame });
      } catch {
        if (!cancelled) setFeed({ kind: "unreachable" });
      }
    }
    load();
    const timer = setInterval(load, MANIFEST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  if (!enabled || snapshot === null) return { kind: "no-position" };
  if (feed.kind === "ok") return { kind: "ok", host: feed.host, frame: feed.frame };
  if (feed.kind === "unreachable") return { kind: "unreachable" };
  return { kind: "loading" };
}

// ---- the canvas: composite tiles → reproject onto the nav face ------------------------------

function loadTile(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // untainted canvas → real pixels can be read back
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // skip, never substitute
    img.src = url;
  });
}

/**
 * Composite the tiles covering the nav circle into an off-screen source canvas, then warp each
 * output pixel through navPixelToWorldPixel and sample. Pixels outside the circle stay transparent
 * (the warp returns null), which is the clip — no separate mask needed.
 */
async function buildOverlay(
  canvas: HTMLCanvasElement,
  o: { own: LonLat; navRangeNm: number; radiusPx: number; host: string; frame: RadarFrame },
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;

  const { z } = resolveZoom(o.navRangeNm, o.own.latDeg, o.radiusPx);

  // World-pixel bounding box of the circle: sample a ring of bearings at full range (mercator
  // curvature means the extremes are not exactly on the cardinals, so a ring is the safe box).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const tileSize = RADAR_TILE_SIZE;
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
      const url = buildTileUrl({ host: o.host, path: o.frame.path, z, x: wrappedX, y: ty });
      jobs.push(
        loadTile(url).then((img) => {
          if (img !== null) srcCtx.drawImage(img, tx * tileSize - originX, ty * tileSize - originY);
        }),
      );
    }
  }
  await Promise.all(jobs);

  const srcData = srcCtx.getImageData(0, 0, srcW, srcH);
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

/**
 * The overlay canvas. Rebuilds only when the frame, range, or a COARSELY-quantised own position
 * changes — so 10 Hz snapshot churn does not re-fetch tiles every tick (own moves ~0.6 NM before a
 * rebuild). Rendered inside a NavMap <foreignObject>, under the rings/airports, at RADAR_ALPHA.
 */
export function NavWeatherLayer({
  own,
  navRangeNm,
  host,
  frame,
  radiusPx = NAV_RADIUS_PX,
}: {
  own: LonLat;
  navRangeNm: number;
  host: string;
  frame: RadarFrame;
  radiusPx?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qLat = Math.round(own.latDeg * 100) / 100;
  const qLon = Math.round(own.lonDeg * 100) / 100;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    void buildOverlay(canvas, { own: { latDeg: qLat, lonDeg: qLon }, navRangeNm, radiusPx, host, frame });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- own is captured via its quantised parts
  }, [qLat, qLon, navRangeNm, radiusPx, host, frame.path]);

  const side = radiusPx * 2;
  return (
    <canvas
      ref={canvasRef}
      width={side}
      height={side}
      className="navmap-wx-canvas"
      style={{ opacity: RADAR_ALPHA, width: side, height: side }}
    />
  );
}
