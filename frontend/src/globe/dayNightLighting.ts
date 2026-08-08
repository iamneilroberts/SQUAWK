/*
 * The Cesium render-layer half of time-aware lighting (issue #14). All the sun/atmosphere maths
 * is Cesium's own; this just switches its built-in day/night model on and points its clock at
 * the real wall clock so the terminator, dawn/dusk gradients and night side are truthful for the
 * aircraft's actual position and the actual time. The testable decision logic lives Cesium-free
 * in world/dayNight.ts; this file is the thin, boring applier.
 *
 * ClockStep.SYSTEM_CLOCK makes the viewer's clock read the real system time on every tick
 * (requestRenderMode is off in ViewerHost, so ticks run continuously) — no multiplier, no
 * scrubbing, no synthesized time. That is the honest default the ground rules ask for.
 */
import { ClockStep, type Viewer } from "cesium";

export function applyRealTimeLighting(viewer: Viewer): void {
  if (viewer.isDestroyed?.()) return;
  const { scene, clock } = viewer;
  scene.globe.enableLighting = true;
  scene.globe.showGroundAtmosphere = true;
  // skyAtmosphere is optional in Cesium's scene typings; it is present for a globe Viewer.
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  clock.clockStep = ClockStep.SYSTEM_CLOCK;
  clock.shouldAnimate = true;
}
