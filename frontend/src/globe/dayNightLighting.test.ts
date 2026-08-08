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
      globe: { enableLighting: false, showGroundAtmosphere: false },
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
  it("drives the clock from the real system clock, advancing live", () => {
    const viewer = fakeViewer();
    applyRealTimeLighting(viewer);
    expect(viewer.clock.clockStep).toBe(ClockStep.SYSTEM_CLOCK);
    expect(viewer.clock.shouldAnimate).toBe(true);
  });
});
