/*
 * The Cesium implementation of FlightHost. Frames come from scene.preRender (one callback
 * per rendered frame, already inside Cesium's loop — no second rAF competing with it) and
 * carry performance.now() rather than a Cesium JulianDate, so the sim clock is wall time.
 */
import type { Viewer } from "cesium";
import type { FlightHost } from "../game/flightLoop";
import { createFpvCamera } from "./fpvCamera";

export function createCesiumFlightHost(viewer: Viewer): FlightHost {
  const camera = createFpvCamera(viewer);
  return {
    onFrame(cb) {
      const listener = () => cb(performance.now());
      viewer.scene.preRender.addEventListener(listener);
      return () => viewer.scene.preRender.removeEventListener(listener);
    },
    setCamera(state, dtS) {
      camera.update(state, dtS);
    },
    enterFlightView() {
      camera.enter();
    },
    exitFlightView() {
      camera.exit();
    },
  };
}
