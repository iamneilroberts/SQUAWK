/*
 * The Cesium render layer for the hand-built low-poly aircraft (issue #15). It turns the PURE
 * body-frame TRIANGLE mesh (aircraftGeometry.ts) into ONE Cesium Primitive of solid, flat-shaded
 * facets, baked once in body coordinates. Each frame it only sets the Primitive's `modelMatrix`
 * (from the aircraft's position + attitude quaternion — the same body->ECEF rotation the cockpit
 * camera uses), so the vertices never move: the GPU rotates the whole solid. No glTF, no downloaded
 * model, no new dependency — Cesium primitives + hand-rolled geometry only.
 *
 * Flat shading: every triangle gets its OWN three vertices carrying the face normal (computed from
 * the winding), so faces stay faceted (no smoothing) and PerInstanceColorAppearance's lighting
 * gives a solid, form-reading "dark-metal" gradient from a single base colour — amber for the SIM
 * player, cyan for the ghost. No textures, no shadows.
 *
 * SEAM for a FUTURE real-glTF model: `createAircraftModel` is one implementation of the
 * `AircraftModelProvider` signature. A glTF provider would build a Cesium `Model` and implement the
 * same `AircraftModel` interface (update/setVisible/destroy); the host and ghost call the provider
 * through this interface, so swapping it needs no change to them. NOT built now (owner-deferred).
 *
 * There is no unit test here on purpose: the arithmetic (dimensions -> vertices, winding -> a solid)
 * is tested in the pure module; whether the shaded solid and its colour actually read correctly on
 * screen needs a real browser (documented in the task report + decisions.md).
 */
import {
  BoundingSphere,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  PrimitiveType,
  Quaternion,
  type Viewer,
} from "cesium";
import type { Quat, Vec3 } from "../sim/types";
import { buildAirframe, type Triangle } from "./aircraftGeometry";
import { modelDimsForClass } from "./aircraftModelDims";

export type AircraftModelStyle = {
  /** Base solid colour. SIM player = amber (#ffb000); ghost = cyan (#5fd7e0), never mistaken for SIM.
   *  Alpha < 1 makes the model translucent (the ghost). Flat-shading darkens away-facing facets. */
  color: Color;
};

/** SIM player aircraft: amber, the reserved SIM accent (CLAUDE.md ground rule 2). */
export const SIM_MODEL_STYLE: AircraftModelStyle = {
  color: Color.fromCssColorString("#ffb000"),
};

/**
 * The live-feed ghost: cyan and translucent — the nominal-data colour, deliberately NOT the SIM
 * amber, so the real aircraft stays visually unmistakable from the player's synthetic one.
 */
export const GHOST_MODEL_STYLE: AircraftModelStyle = {
  color: Color.fromCssColorString("#5fd7e0").withAlpha(0.6),
};

export type AircraftModel = {
  /** Re-place the solid model at an ECEF position with a body->ECEF attitude quaternion. */
  update(positionEcef: Vec3, attitude: Quat): void;
  setVisible(visible: boolean): void;
  destroy(): void;
};

/** The swappable model factory. The solid low-poly builder below is the current implementation;
 *  a future glTF builder would share this signature and the AircraftModel interface. */
export type AircraftModelProvider = (
  viewer: Viewer,
  classId: string,
  style: AircraftModelStyle,
) => AircraftModel;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

/** Unit face normal from a triangle's winding (CCW seen from outside -> points outward). */
function faceNormal([a, b, c]: Triangle): Vec3 {
  const u = sub(b, a);
  const v = sub(c, a);
  const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

/** Pack the body-frame triangles into a flat-shaded Cesium Geometry (per-face duplicated verts). */
function meshGeometry(triangles: Triangle[]): Geometry {
  const vCount = triangles.length * 3;
  const positions = new Float64Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const indices = new Uint16Array(vCount);
  for (let t = 0; t < triangles.length; t++) {
    const n = faceNormal(triangles[t]);
    for (let k = 0; k < 3; k++) {
      const p = triangles[t][k];
      const o = (t * 3 + k) * 3;
      positions[o] = p.x;
      positions[o + 1] = p.y;
      positions[o + 2] = p.z;
      normals[o] = n.x;
      normals[o + 1] = n.y;
      normals[o + 2] = n.z;
      indices[t * 3 + k] = t * 3 + k;
    }
  }
  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions,
  });
  attributes.normal = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: normals,
  });
  return new Geometry({
    attributes,
    indices,
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(Array.from(positions)),
  });
}

export const createAircraftModel: AircraftModelProvider = (viewer, classId, style) => {
  const triangles = buildAirframe(modelDimsForClass(classId)).triangles;
  const translucent = style.color.alpha < 1;
  const primitive = new Primitive({
    geometryInstances: new GeometryInstance({
      geometry: meshGeometry(triangles),
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(style.color) },
    }),
    appearance: new PerInstanceColorAppearance({ flat: false, translucent, closed: true }),
    asynchronous: false,
    modelMatrix: Matrix4.IDENTITY.clone(),
    show: false,
  });
  viewer.scene.primitives.add(primitive);

  const scratch = new Cartesian3();
  const quat = new Quaternion();
  return {
    update(positionEcef, attitude) {
      scratch.x = positionEcef.x;
      scratch.y = positionEcef.y;
      scratch.z = positionEcef.z;
      quat.x = attitude.x;
      quat.y = attitude.y;
      quat.z = attitude.z;
      quat.w = attitude.w;
      primitive.modelMatrix = Matrix4.fromTranslationQuaternionRotationScale(
        scratch,
        quat,
        Cartesian3.ONE,
        primitive.modelMatrix,
      );
    },
    setVisible(visible) {
      primitive.show = visible;
    },
    destroy() {
      viewer.scene.primitives.remove(primitive); // remove() also destroys the primitive
    },
  };
};
