/*
 * The Cesium implementation of FlightHost. Frames come from scene.preRender (one callback
 * per rendered frame, already inside Cesium's loop — no second rAF competing with it) and
 * carry performance.now() rather than a Cesium JulianDate, so the sim clock is wall time.
 */
import type { Viewer } from "cesium";
import type { FlightHost } from "../game/flightLoop";
import { createFpvCamera } from "./fpvCamera";
import {
  ZERO_LOOK,
  applyMouseDelta,
  easeToward,
  LOOK_SENSITIVITY_RAD_PER_PX,
  LOOK_EASE_RATE_PER_S,
  type LookOffset,
} from "./lookAround";

/**
 * The host also owns the free-look offset (issue #9): FlightSession feeds it mouse deltas while
 * `Q` is held (setLookActive(true) + applyLook), and on release (setLookActive(false)) the host
 * eases the offset back to forward once per frame from setCamera's dt. Keeping the offset here —
 * next to the camera it feeds and the per-frame dt it needs — keeps the flight loop and its tests
 * completely unaware of free-look, and never lets the offset near the physics.
 */
export type CesiumFlightHost = FlightHost & {
  /** Turn look mode on/off; off begins the ease-back to forward. */
  setLookActive(active: boolean): void;
  /** Accumulate a mouse delta into the look offset (ignored unless look mode is active). */
  applyLook(dx: number, dy: number): void;
};

export function createCesiumFlightHost(viewer: Viewer): CesiumFlightHost {
  const camera = createFpvCamera(viewer);
  let look: LookOffset = ZERO_LOOK;
  let looking = false;
  return {
    onFrame(cb) {
      const listener = () => cb(performance.now());
      viewer.scene.preRender.addEventListener(listener);
      return () => viewer.scene.preRender.removeEventListener(listener);
    },
    setCamera(state, dtS) {
      // While looking, hold the accumulated offset; once released, ease it back to forward.
      if (!looking) look = easeToward(look, dtS, LOOK_EASE_RATE_PER_S);
      camera.update(state, dtS, look);
    },
    enterFlightView() {
      camera.enter();
    },
    exitFlightView() {
      camera.exit();
      // Leave no free-look residue for the next takeover on this viewer.
      look = ZERO_LOOK;
      looking = false;
    },
    setLookActive(active) {
      looking = active;
    },
    applyLook(dx, dy) {
      if (!looking) return;
      look = applyMouseDelta(look, dx, dy, LOOK_SENSITIVITY_RAD_PER_PX);
    },
  };
}
