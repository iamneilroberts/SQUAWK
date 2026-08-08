import { describe, it, expect } from "vitest";
import { ClockStep, type Viewer } from "cesium";
import { applyRealTimeLighting } from "./dayNightLighting";

/*
 * applyRealTimeLighting only sets flags on the viewer's scene and clock, so a hand-rolled
 * object satisfying that shape is enough — the same "fake object satisfying the shape" pattern
 * fpvCamera.test.ts / layerOrdering.test.ts use for `Viewer`, and it keeps the test out of the
 * DOM (this project runs vitest without jsdom on purpose). The fake starts in the OPPOSITE
 * state to every flag the function must set, so a no-op implementation fails every assertion.
 */
function fakeViewer() {
  const viewer = {
    scene: {
      // vertexShadowDarkness starts at Cesium's default 0.3 (the "too dark at night" value the
      // ambient floor must raise), so a no-op implementation fails the floor assertion below.
      globe: { enableLighting: false, showGroundAtmosphere: false, vertexShadowDarkness: 0.3 },
      skyAtmosphere: { show: false },
    },
    clock: { clockStep: ClockStep.TICK_DEPENDENT, shouldAnimate: false },
  };
  return viewer as unknown as Viewer & typeof viewer;
}

describe("applyRealTimeLighting", () => {
  it("turns on globe sun lighting and the sky/ground atmosphere", () => {
    const viewer = fakeViewer();
    applyRealTimeLighting(viewer);
    expect(viewer.scene.globe.enableLighting).toBe(true);
    expect(viewer.scene.skyAtmosphere.show).toBe(true);
    expect(viewer.scene.globe.showGroundAtmosphere).toBe(true);
  });
  it("raises the night-side ambient floor above Cesium's dark default so night terrain is legible", () => {
    const viewer = fakeViewer();
    applyRealTimeLighting(viewer);
    // On the night side Cesium's terrain diffuse collapses to vertexShadowDarkness, so this IS the
    // night brightness floor. It must be lifted above the 0.3 default (near-black over Esri imagery)
    // yet stay below 1.0 so the day side is still clearly brighter (day/twilight/night stays visible).
    expect(viewer.scene.globe.vertexShadowDarkness).toBe(0.55);
    expect(viewer.scene.globe.vertexShadowDarkness).toBeGreaterThan(0.3);
    expect(viewer.scene.globe.vertexShadowDarkness).toBeLessThan(1);
  });
  it("drives the clock from the real system clock, advancing live", () => {
    const viewer = fakeViewer();
    applyRealTimeLighting(viewer);
    expect(viewer.clock.clockStep).toBe(ClockStep.SYSTEM_CLOCK);
    expect(viewer.clock.shouldAnimate).toBe(true);
  });
});
