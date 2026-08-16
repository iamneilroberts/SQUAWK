/*
 * The Cesium implementation of FlightHost. Frames come from scene.preRender (one callback
 * per rendered frame, already inside Cesium's loop — no second rAF competing with it) and
 * carry performance.now() rather than a Cesium JulianDate, so the sim clock is wall time.
 */
import { Cartesian3, type Viewer } from "cesium";
import type { FlightHost } from "../game/flightLoop";
import { createFpvCamera } from "./fpvCamera";
import { hprFromQuat } from "../sim/quat";
import { loadClassById } from "../sim/params";
import { degToRad } from "../sim/units";
import {
  ZERO_LOOK,
  applyMouseDelta,
  clampToLookArc,
  easeToward,
  LOOK_SENSITIVITY_RAD_PER_PX,
  LOOK_EASE_RATE_PER_S,
  type LookArcRad,
  type LookOffset,
} from "./lookAround";
import {
  defaultOrbit,
  applyOrbitDrag,
  applyZoom,
  chaseView,
  type OrbitState,
} from "./chaseCamera";
import { createAircraftModel, SIM_MODEL_STYLE, type AircraftModel } from "./aircraftModel";

/**
 * The host owns two view-only cameras (issue #4): the shipped cockpit FPV camera and the new
 * exterior chase+orbit camera. It also owns the player's low-poly aircraft MODEL (issue #15),
 * shown only in the exterior view (in the cockpit you are inside it). None of this touches the
 * physics, the controls or the sim state — the exterior view is purely additive and off by
 * default, so a takeover still starts in the cockpit exactly as before.
 *
 * FlightSession drives all of this UI-agnostically: it calls toggleExterior() from a key (KeyE),
 * and feeds drag/zoom deltas from mouse events — but the toggle + orbit LOGIC lives here, so a
 * future mobile control surface can drive the same methods without any of it changing.
 */
export type CesiumFlightHost = FlightHost & {
  /** Turn cockpit look mode on/off; off begins the ease-back to forward. */
  setLookActive(active: boolean): void;
  /** Accumulate a mouse delta into the cockpit look offset (ignored unless look mode is active). */
  applyLook(dx: number, dy: number): void;
  /** Flip between cockpit (FPV) and exterior (chase/orbit) views. */
  toggleExterior(): void;
  isExteriorActive(): boolean;
  /** Begin / end an orbit drag; the orbit holds its last angle when released (no ease-back). */
  setOrbiting(active: boolean): void;
  /** Accumulate a drag delta into the orbit (ignored unless the exterior view is active). */
  applyOrbitDrag(dx: number, dy: number): void;
  /** Wheel zoom the exterior view in/out (ignored unless the exterior view is active). */
  applyOrbitZoom(wheelDeltaY: number): void;
};

export function createCesiumFlightHost(viewer: Viewer, classId: string): CesiumFlightHost {
  const camera = createFpvCamera(viewer);
  let look: LookOffset = ZERO_LOOK;
  let looking = false;
  // Degrees->radians conversion happens exactly HERE, at the edge between the degree-authored
  // params file and this module's radian math (issue #44 follow-up) — nothing downstream of
  // this point ever sees degrees.
  const classLookArc = loadClassById(classId).lookArc;
  const lookArc: LookArcRad = {
    yawRad: degToRad(classLookArc.yawDeg),
    pitchUpRad: degToRad(classLookArc.pitchUpDeg),
    pitchDownRad: degToRad(classLookArc.pitchDownDeg),
  };

  // Exterior chase/orbit state — camera only, never near the physics.
  const chaseDefault: OrbitState = defaultOrbit(classId);
  let orbit: OrbitState = chaseDefault;
  let exterior = false;
  let orbiting = false;
  let model: AircraftModel | null = null;

  return {
    onFrame(cb) {
      const listener = () => cb(performance.now());
      viewer.scene.preRender.addEventListener(listener);
      return () => viewer.scene.preRender.removeEventListener(listener);
    },
    setCamera(state, dtS) {
      if (exterior) {
        // The orbit STAYS where the player last dragged it (owner 2026-08-12) — no ease-back — so a
        // parked cinematic angle holds. Each fresh entry into the exterior view resets to the
        // default chase framing (see toggleExterior).
        const heading = hprFromQuat(state.attitude, state.position).headingRad;
        const view = chaseView(state.position, heading, orbit);
        viewer.camera.setView({
          destination: new Cartesian3(view.position.x, view.position.y, view.position.z),
          orientation: { heading: view.headingRad, pitch: view.pitchRad, roll: view.rollRad },
        });
        model?.update(state.position, state.attitude);
        model?.setVisible(true);
      } else {
        // Cockpit: hold the look offset while looking, else ease it back to forward.
        if (!looking) look = easeToward(look, dtS, LOOK_EASE_RATE_PER_S);
        camera.update(state, dtS, look);
        model?.setVisible(false);
      }
    },
    enterFlightView() {
      camera.enter();
      model = createAircraftModel(viewer, classId, SIM_MODEL_STYLE);
      model.setVisible(false);
    },
    exitFlightView() {
      camera.exit();
      model?.destroy();
      model = null;
      // Leave no residue for the next takeover on this viewer.
      look = ZERO_LOOK;
      looking = false;
      exterior = false;
      orbiting = false;
      orbit = chaseDefault;
    },
    setLookActive(active) {
      looking = active;
    },
    applyLook(dx, dy) {
      if (!looking) return;
      look = clampToLookArc(applyMouseDelta(look, dx, dy, LOOK_SENSITIVITY_RAD_PER_PX), lookArc);
    },
    toggleExterior() {
      exterior = !exterior;
      // Fresh chase framing each time the exterior view is entered.
      if (exterior) orbit = chaseDefault;
      orbiting = false;
    },
    isExteriorActive() {
      return exterior;
    },
    setOrbiting(active) {
      orbiting = active;
    },
    applyOrbitDrag(dx, dy) {
      if (!exterior || !orbiting) return;
      orbit = applyOrbitDrag(orbit, dx, dy);
    },
    applyOrbitZoom(wheelDeltaY) {
      if (!exterior) return;
      orbit = applyZoom(orbit, wheelDeltaY);
    },
  };
}
