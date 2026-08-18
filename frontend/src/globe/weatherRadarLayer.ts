/*
 * Precipitation-radar (RainViewer) draped on the Cesium globe (WX overlay). The globe-drape
 * sibling of the NavMap's 2D radar (dashboard/NavWeatherLayer.tsx): both read the SAME RainViewer
 * manifest and pure math (dashboard/navWeatherMath.ts), so one WX toggle drives both faces.
 *
 * Lifecycle mirrors basemap.ts / labelLayers.ts: a mutable ref holds the single ImageryLayer, and
 * the functions here add / replace / remove it in place so React 18's StrictMode double-invoke
 * leaves exactly one live layer. OverlayLayers.tsx owns the reactive effect (store `radarOn`) and
 * the ~5-minute frame refresh, exactly as it drives labels off `labelsOn`.
 *
 * Honest-data rule: the frame is REAL observed data (radar.past only, via pickNewestFrame) or the
 * layer is absent. A manifest that is unreachable or empty (offline) yields no layer and no crash —
 * never a synthesized frame.
 */
import { ImageryLayer, UrlTemplateImageryProvider, type Viewer } from "cesium";
import {
  buildTileUrlTemplate,
  parseManifest,
  pickNewestFrame,
  RADAR_TILE_SIZE,
  type RadarFrame,
} from "../dashboard/navWeatherMath";

// The same keyless, CORS-open manifest the NavMap overlay fetches (fetched directly, no proxy).
const MANIFEST_URL = "https://api.rainviewer.com/public/weather-maps.json";

// Overlay opacity so the satellite basemap reads through the precip wash (spec: reads as an
// overlay, not a basemap). Slightly higher than the NavMap face's RADAR_ALPHA because the globe
// drape competes with full-colour imagery rather than a dark line map.
export const RADAR_GLOBE_ALPHA = 0.6;

// RainViewer radar is coarse (~1 km); cap the tile level so a cockpit-altitude view UPSAMPLES the
// real observed tile rather than requesting ever-deeper zooms that 404. Honest: it is the same
// measured data shown at its native resolution, not invented detail.
const RADAR_GLOBE_MAX_LEVEL = 9;

export type RadarRef = { layer: ImageryLayer | null; frameTime: number | null };

export function createRadarRef(): RadarRef {
  return { layer: null, frameTime: null };
}

/**
 * Fetch + parse the RainViewer manifest and pick the newest observed frame. Returns null on any
 * failure or an empty/unusable document (offline) — the caller then simply shows no overlay.
 */
export async function fetchNewestRadarFrame(): Promise<{ host: string; frame: RadarFrame } | null> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const manifest = parseManifest(await res.json());
    const frame = manifest ? pickNewestFrame(manifest.frames) : null;
    if (!manifest || !frame) return null;
    return { host: manifest.host, frame };
  } catch {
    return null;
  }
}

/**
 * Add (or replace) the radar imagery layer for a given frame. Any prior radar layer is removed
 * first so a frame refresh never stacks two washes. Added on top; OverlayLayers re-asserts the
 * place-labels layer above it afterwards so ordering stays basemap < radar < labels.
 */
export function setRadarLayer(
  viewer: Viewer,
  ref: RadarRef,
  host: string,
  frame: RadarFrame,
): void {
  if (viewer.isDestroyed()) return;
  removeRadarLayer(viewer, ref);
  const provider = new UrlTemplateImageryProvider({
    url: buildTileUrlTemplate({ host, path: frame.path }),
    tileWidth: RADAR_TILE_SIZE,
    tileHeight: RADAR_TILE_SIZE,
    maximumLevel: RADAR_GLOBE_MAX_LEVEL,
  });
  const layer = new ImageryLayer(provider, { alpha: RADAR_GLOBE_ALPHA });
  viewer.imageryLayers.add(layer);
  ref.layer = layer;
  ref.frameTime = frame.time;
}

export function removeRadarLayer(viewer: Viewer, ref: RadarRef): void {
  if (ref.layer !== null && !viewer.isDestroyed()) {
    viewer.imageryLayers.remove(ref.layer, true);
  }
  ref.layer = null;
  ref.frameTime = null;
}
