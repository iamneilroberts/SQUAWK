/*
 * Cockpit camera (parent spec §7, research notes §1): camera.setView every frame from a
 * LOW-PASSED copy of the sim attitude, with the eye point offset forward and up from the
 * CG. The physics stays raw — only the camera's copy is filtered, which is the difference
 * between "cockpit" and "camera bolted to the airframe".
 *
 * Three settings are not optional here:
 *   screenSpaceCameraController.enableInputs = false  — the default controller fights
 *     setView and produces the roll drift the community threads describe;
 *   frustum.near ~ 1 m  — otherwise the nose of the aircraft clips through the near plane
 *     on the deck;
 *   globe.depthTestAgainstTerrain = true  — so terrain occludes traffic billboards instead
 *     of aircraft showing through mountains.
 * All three are restored on exit() so BROWSE gets its normal globe back (spec §6, "no
 * residue").
 */
import { Cartesian3, PerspectiveFrustum, type Viewer } from "cesium";
import type { SimState, Vec3 } from "../sim/types";
import { hprFromQuat, qRotate } from "../sim/quat";
import { vAdd } from "../sim/vec3";

/** Eye point relative to the CG in body axes: 0.8 m forward, 0.6 m up (z is down). */
export const EYE_OFFSET_BODY_M: Vec3 = { x: 0.8, y: 0, z: -0.6 };

/**
 * First-order low-pass coefficient for a given cutoff and frame time. Derived from the
 * exponential step response, so the filter behaves the same at 30 fps as at 60.
 */
export function lowPassCoefficient(cutoffHz: number, dtS: number): number {
  return Math.min(1, 1 - Math.exp(-2 * Math.PI * cutoffHz * dtS));
}

/** Filter an angle along the SHORT arc, so heading does not spin the long way at 359->001. */
export function lowPassAngleRad(prev: number, target: number, coef: number): number {
  let delta = target - prev;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return prev + delta * coef;
}

export function createFpvCamera(viewer: Viewer, cutoffHz = 8) {
  let heading = 0;
  let pitch = 0;
  let roll = 0;
  let primed = false;

  let savedInputs = true;
  let savedNear = 1;
  let savedDepthTest = false;

  return {
    enter() {
      const controller = viewer.scene.screenSpaceCameraController;
      savedInputs = controller.enableInputs;
      savedDepthTest = viewer.scene.globe.depthTestAgainstTerrain;
      controller.enableInputs = false;
      viewer.scene.globe.depthTestAgainstTerrain = true;
      const frustum = viewer.camera.frustum;
      if (frustum instanceof PerspectiveFrustum) {
        savedNear = frustum.near;
        frustum.near = 1.0;
      }
      primed = false;
    },
    update(state: SimState, dtS: number) {
      const target = hprFromQuat(state.attitude, state.position);
      if (!primed) {
        heading = target.headingRad;
        pitch = target.pitchRad;
        roll = target.rollRad;
        primed = true;
      } else {
        const c = lowPassCoefficient(cutoffHz, dtS);
        heading = lowPassAngleRad(heading, target.headingRad, c);
        pitch = lowPassAngleRad(pitch, target.pitchRad, c);
        roll = lowPassAngleRad(roll, target.rollRad, c);
      }
      // Eye point uses the RAW attitude so the offset stays attached to the airframe;
      // only the look direction is filtered.
      const eye = vAdd(state.position, qRotate(state.attitude, EYE_OFFSET_BODY_M));
      viewer.camera.setView({
        destination: new Cartesian3(eye.x, eye.y, eye.z),
        orientation: { heading, pitch, roll },
      });
    },
    exit() {
      const controller = viewer.scene.screenSpaceCameraController;
      controller.enableInputs = savedInputs;
      viewer.scene.globe.depthTestAgainstTerrain = savedDepthTest;
      const frustum = viewer.camera.frustum;
      if (frustum instanceof PerspectiveFrustum) frustum.near = savedNear;
    },
  };
}
