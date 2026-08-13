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
import { warpTilesToNavCircle } from "./navTileWarp";
import {
  buildTileUrl,
  parseManifest,
  pickNewestFrame,
  RADAR_ALPHA,
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

// ---- the canvas: composite RainViewer tiles → reproject onto the nav face -------------------

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
    void warpTilesToNavCircle(canvas, {
      own: { latDeg: qLat, lonDeg: qLon },
      navRangeNm,
      radiusPx,
      tileUrl: (z, x, y) => buildTileUrl({ host, path: frame.path, z, x, y }),
    });
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
