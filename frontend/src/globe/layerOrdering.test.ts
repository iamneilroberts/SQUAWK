/*
 * Pins the stacking-order contract behind the OverlayLayers.tsx dep-array fix (see the comment
 * on the places effect there): a SAT -> CHART toggle must never strand the places layer under
 * the new opaque basemap layer.
 *
 * `ImageryLayer.fromProviderAsync` and `ArcGisMapServerImageryProvider.fromUrl` are mocked
 * because they reach for `document` inside Cesium's resource loader and fail outside a DOM
 * (this codebase runs vitest without jsdom on purpose, spec §8) — everything else about `cesium`
 * stays real. `applyBasemap` and `applyPlacesLayer` themselves are the genuine production
 * functions from basemap.ts / labelLayers.ts, driven with a hand-rolled ImageryLayerCollection
 * stand-in (add() pushes to the top of the stack, matching Cesium's own semantics) — the same
 * "fake object satisfying the shape" pattern fpvCamera.test.ts uses for `Viewer`.
 *
 * This test scripts the effect *call sequence* (what OverlayLayers.tsx does once its deps are
 * right) — it does not mount OverlayLayers.tsx itself, so it cannot catch a regression to the
 * dep array by itself. That gap needs a live Viewer or a DOM-based renderer neither of which
 * this project carries; the SAT/CHART + labels toggle is also checked by hand at runbook
 * checkpoint 25 (docs/summaries/phase-b-acceptance-runbook.md).
 */
import { describe, it, expect, vi } from "vitest";
import type { Viewer } from "cesium";

vi.mock("cesium", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cesium")>();
  return {
    ...actual,
    ArcGisMapServerImageryProvider: { fromUrl: () => new Promise(() => {}) },
    ImageryLayer: {
      fromProviderAsync: () => ({ __fakeImageryLayer: true }),
    },
  };
});

const { applyBasemap, disposeBasemap, createBasemapRef } = await import("./basemap");
const { applyPlacesLayer, createPlacesRef } = await import("./labelLayers");

function fakeImageryLayers() {
  const stack: unknown[] = [];
  return {
    stack,
    add(layer: unknown) {
      stack.push(layer);
    },
    remove(layer: unknown) {
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      return i >= 0;
    },
    get(i: number) {
      return stack[i];
    },
    get length() {
      return stack.length;
    },
  };
}

function fakeViewer(layers: ReturnType<typeof fakeImageryLayers>) {
  return { isDestroyed: () => false, imageryLayers: layers } as unknown as Viewer;
}

describe("basemap/places stacking order", () => {
  it("BUG (documented): re-running only the basemap effect strands places under the new basemap", () => {
    const layers = fakeImageryLayers();
    layers.add({ name: "base-sat" });
    const viewer = fakeViewer(layers);

    const placesRef = createPlacesRef();
    applyPlacesLayer(viewer, true, placesRef); // labels already on

    const basemapRef = createBasemapRef();
    applyBasemap(viewer, "CHART", basemapRef); // only this effect re-runs (the old deps array)

    const placesIndex = layers.stack.indexOf(placesRef.layer);
    const chartIndex = layers.stack.indexOf(basemapRef.chart);
    expect(placesIndex).toBeGreaterThanOrEqual(0);
    expect(chartIndex).toBeGreaterThan(placesIndex); // chart lands ON TOP of places: labels hidden
  });

  it("FIX: re-running both effects on a basemap change puts places back on top", () => {
    const layers = fakeImageryLayers();
    layers.add({ name: "base-sat" });
    const viewer = fakeViewer(layers);

    const placesRef = createPlacesRef();
    applyPlacesLayer(viewer, true, placesRef);
    const basemapRef = createBasemapRef();

    // The SAT -> CHART toggle with `basemap` in the places effect's deps: React runs every
    // cleanup (declaration order: basemap, then places) before any new effect body.
    disposeBasemap(viewer, basemapRef); // basemap cleanup (no-op: ref.chart was null)
    applyPlacesLayer(viewer, false, placesRef); // places cleanup: removes places
    applyBasemap(viewer, "CHART", basemapRef); // basemap effect: adds chart
    applyPlacesLayer(viewer, true, placesRef); // places effect: re-adds places on top

    const placesIndex = layers.stack.indexOf(placesRef.layer);
    const chartIndex = layers.stack.indexOf(basemapRef.chart);
    expect(chartIndex).toBeGreaterThanOrEqual(0);
    expect(placesIndex).toBeGreaterThan(chartIndex); // places ends up above chart: labels visible
  });
});
