/*
 * SAT <-> CHART (spec D-8). An IMAGERY LAYER swap and nothing else: the terrain provider, the
 * camera, the primitives and the poller are all untouched, because a provider swap forces a full
 * tile reload and jumps the camera (parent spec §3, the same reason terrain attaches at app
 * start and not at takeover).
 *
 * CHART is added ABOVE the base layer created in ViewerHost, and the base is hidden rather than
 * destroyed — so switching back is one `show = true` and nothing has to be rebuilt or refetched.
 */
import { ArcGisMapServerImageryProvider, ImageryLayer, type Viewer } from "cesium";
import { CHART_URL, type BasemapKind } from "./mapSources";

export type BasemapRef = { chart: ImageryLayer | null };

export function createBasemapRef(): BasemapRef {
  return { chart: null };
}

export function applyBasemap(viewer: Viewer, kind: BasemapKind, ref: BasemapRef): void {
  if (viewer.isDestroyed()) return;
  const layers = viewer.imageryLayers;
  const base = layers.length > 0 ? layers.get(0) : null;

  if (kind === "CHART") {
    if (ref.chart === null) {
      // Same call ViewerHost already makes for the base layer on Cesium 1.143:
      // fromProviderAsync takes the provider promise and returns the layer synchronously.
      ref.chart = ImageryLayer.fromProviderAsync(
        ArcGisMapServerImageryProvider.fromUrl(CHART_URL),
        {},
      );
      layers.add(ref.chart);
    }
    if (base && base !== ref.chart) base.show = false;
    return;
  }

  if (ref.chart !== null) {
    layers.remove(ref.chart, true);
    ref.chart = null;
  }
  if (base) base.show = true;
}

/**
 * Cleanup must leave the globe with imagery on it. Removing the chart layer without un-hiding
 * the base would strand a StrictMode re-mount (or any unmount while CHART is active) on a black
 * globe, so the base layer is restored FIRST and unconditionally.
 */
export function disposeBasemap(viewer: Viewer, ref: BasemapRef): void {
  if (viewer.isDestroyed()) {
    ref.chart = null;
    return;
  }
  const layers = viewer.imageryLayers;
  if (ref.chart !== null) layers.remove(ref.chart, true);
  ref.chart = null;
  if (layers.length > 0) layers.get(0).show = true;
}
