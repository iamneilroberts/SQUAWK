/*
 * The Cesium render layer for the hand-built low-poly aircraft (issue #15). It turns the PURE
 * body-frame wireframe (aircraftGeometry.ts) into a PolylineCollection and, every frame, rotates
 * each segment's body-frame endpoints into ECEF with the aircraft's attitude quaternion (the same
 * qRotate path the cockpit camera uses) and re-lays the polylines. No glTF, no downloaded model,
 * no new dependency — Cesium primitives + hand-rolled geometry only.
 *
 * There is no unit test here on purpose: the arithmetic (dimensions -> vertices, orbit -> camera)
 * is tested in the pure modules; whether the silhouette and its colour actually read correctly on
 * screen needs a real browser (documented in the task report + decisions.md).
 */
import { Cartesian3, Color, Material, PolylineCollection, type Polyline, type Viewer } from "cesium";
import type { Quat, Vec3 } from "../sim/types";
import { qRotate } from "../sim/quat";
import { buildAirframe, type Segment } from "./aircraftGeometry";
import { modelDimsForClass } from "./aircraftModelDims";

export type AircraftModelStyle = {
  /** Line colour. SIM player = amber (#ffb000); ghost = cyan (#5fd7e0) so it can never be mistaken for SIM. */
  color: Color;
  /** Line width in pixels. */
  widthPx: number;
};

/** SIM player aircraft: amber, the reserved SIM accent (CLAUDE.md ground rule 2). */
export const SIM_MODEL_STYLE: AircraftModelStyle = {
  color: Color.fromCssColorString("#ffb000"),
  widthPx: 2,
};

/**
 * The live-feed ghost: cyan and translucent — the nominal-data colour, deliberately NOT the SIM
 * amber, so the real aircraft stays visually unmistakable from the player's synthetic one.
 */
export const GHOST_MODEL_STYLE: AircraftModelStyle = {
  color: Color.fromCssColorString("#5fd7e0").withAlpha(0.55),
  widthPx: 1.5,
};

export type AircraftModel = {
  /** Re-place the wireframe at an ECEF position with a body->ECEF attitude quaternion. */
  update(positionEcef: Vec3, attitude: Quat): void;
  setVisible(visible: boolean): void;
  destroy(): void;
};

export function createAircraftModel(
  viewer: Viewer,
  classId: string,
  style: AircraftModelStyle,
): AircraftModel {
  const collection = new PolylineCollection();
  viewer.scene.primitives.add(collection);
  const segments: Segment[] = buildAirframe(modelDimsForClass(classId)).segments;
  const material = Material.fromType("Color", { color: style.color });
  const lines: Polyline[] = segments.map(() =>
    collection.add({
      positions: [Cartesian3.ZERO, Cartesian3.ZERO],
      width: style.widthPx,
      material,
      show: false,
    }),
  );

  return {
    update(positionEcef, attitude) {
      for (let i = 0; i < segments.length; i++) {
        const [p0, p1] = segments[i];
        const w0 = qRotate(attitude, p0);
        const w1 = qRotate(attitude, p1);
        // Fresh Cartesian3 per endpoint: the polyline keeps these, so scratch reuse would
        // alias every segment onto the last one.
        lines[i].positions = [
          new Cartesian3(positionEcef.x + w0.x, positionEcef.y + w0.y, positionEcef.z + w0.z),
          new Cartesian3(positionEcef.x + w1.x, positionEcef.y + w1.y, positionEcef.z + w1.z),
        ];
      }
    },
    setVisible(visible) {
      for (const line of lines) line.show = visible;
    },
    destroy() {
      viewer.scene.primitives.remove(collection); // remove() also destroys the collection
    },
  };
}
