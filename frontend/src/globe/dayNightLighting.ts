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

/*
 * Night-side ambient floor — a RENDERING legibility aid, NOT data (see decisions.md, the
 * 2026-08-07 #14 ambient-floor entry). Cesium's terrain lighting is
 *   diffuseIntensity = clamp(lambertDiffuse * lambertDiffuseMultiplier + vertexShadowDarkness, 0, 1)
 * (GlobeFS.glsl), so on the night side lambertDiffuse is 0 and the terrain brightness collapses to
 * exactly vertexShadowDarkness. Cesium's default of 0.3, multiplied into the already-dark Esri
 * satellite imagery (which has no night-lights layer), renders the night side near-black — too dark
 * to fly. Lifting the floor to 0.55 keeps night terrain legible while the day side (diffuse clamps
 * to 1.0) stays clearly brighter, so the day / twilight / night distinction is still visible.
 *
 * This only changes how the globe is DRAWN. It touches no feed data and no HUD readout: the SKY
 * DAY/TWILIGHT/NIGHT annunciator still reads NIGHT at night — we just don't render pitch-black.
 * The value is a by-eye playability choice; the owner may want to retune it in a real browser.
 */
const NIGHT_AMBIENT_FLOOR = 0.55;

export function applyRealTimeLighting(viewer: Viewer): void {
  if (viewer.isDestroyed?.()) return;
  const { scene, clock } = viewer;
  scene.globe.enableLighting = true;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.vertexShadowDarkness = NIGHT_AMBIENT_FLOOR;
  // skyAtmosphere is optional in Cesium's scene typings; it is present for a globe Viewer.
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  clock.clockStep = ClockStep.SYSTEM_CLOCK;
  clock.shouldAnimate = true;
}
