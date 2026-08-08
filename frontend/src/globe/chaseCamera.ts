/*
 * Pure, Cesium-free chase + orbit camera math (issue #4). It owns ONLY where the camera sits
 * relative to the aircraft and where it points — never the physics, the controls or the sim state
 * (camera-only, per the owner decision). The Cesium wiring in cesiumFlightHost.ts feeds it the
 * aircraft's ECEF position and heading each frame and hands the result straight to camera.setView.
 *
 * The chase frame follows the aircraft's HEADING only (not its roll/pitch), so aerobatics don't
 * tumble the camera — a stable "camera drone" trailing the aeroplane. The player can drag to orbit
 * (yaw around + pitch up/down) and scroll to zoom; on release the yaw/pitch ease back to the
 * default behind-and-above chase framing while the zoomed distance persists.
 *
 * Body/ENU conventions match sim/geo.ts + sim/quat.ts: heading is clockwise from local north,
 * camera pitch is positive nose-up (so looking DOWN at the aircraft is a negative camera pitch).
 */
import type { Vec3 } from "../sim/types";
import { enuBasis } from "../sim/geo";
import { modelDimsForClass } from "./aircraftModelDims";

export type OrbitState = {
  /** Azimuth offset from directly-behind-the-tail, radians. 0 = behind. Wraps to (-pi, pi]. */
  yawRad: number;
  /** Elevation of the camera above the aircraft's horizontal, radians. Positive = above. Clamped. */
  pitchRad: number;
  /** Camera distance from the aircraft, metres. Clamped to the bracket below. */
  distanceM: number;
};

/** Distance bracket (metres). Small enough to fill the frame with a GA single, large enough for a 737. */
export const ORBIT_MIN_DISTANCE_M = 10;
export const ORBIT_MAX_DISTANCE_M = 400;

/** Pitch clamp: from a shallow belly view up to nearly straight down, never over the top. */
export const ORBIT_MIN_PITCH_RAD = (-20 * Math.PI) / 180;
export const ORBIT_MAX_PITCH_RAD = (80 * Math.PI) / 180;

/** Default chase framing: a little above the tail, looking slightly down. Owner-tunable by eye. */
export const DEFAULT_ORBIT_PITCH_RAD = (12 * Math.PI) / 180;

/** Default distance = this many aircraft-lengths behind. Owner-tunable by eye. */
export const DISTANCE_PER_LENGTH = 4;

/** Drag sensitivity, radians of orbit per pixel dragged. Owner-tunable. */
export const ORBIT_DRAG_SENS = 0.006;

/** Zoom sensitivity: distance is multiplied by exp(wheelDeltaY * this), so it feels the same at any zoom. */
export const ORBIT_ZOOM_SENS = 0.0015;

/** Below this the ease-back snaps exactly onto the default, so the chase truly re-settles. */
const EASE_EPS_RAD = 1e-4;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap into (-pi, pi] so a full orbit swing can face the nose. */
function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** The default behind-and-above chase framing for a class, distance scaled to its size. */
export function defaultOrbit(classId: string): OrbitState {
  const lengthM = modelDimsForClass(classId).lengthM;
  return {
    yawRad: 0,
    pitchRad: DEFAULT_ORBIT_PITCH_RAD,
    distanceM: clamp(lengthM * DISTANCE_PER_LENGTH, ORBIT_MIN_DISTANCE_M, ORBIT_MAX_DISTANCE_M),
  };
}

/** Accumulate a drag: horizontal (dx) orbits, vertical (dy) tilts. Mouse up (dy<0) raises the camera. */
export function applyOrbitDrag(orbit: OrbitState, dx: number, dy: number): OrbitState {
  return {
    yawRad: wrapPi(orbit.yawRad + dx * ORBIT_DRAG_SENS),
    pitchRad: clamp(orbit.pitchRad - dy * ORBIT_DRAG_SENS, ORBIT_MIN_PITCH_RAD, ORBIT_MAX_PITCH_RAD),
    distanceM: orbit.distanceM,
  };
}

/** Wheel zoom: positive deltaY (scroll down) zooms OUT, negative zooms IN. Multiplicative, clamped. */
export function applyZoom(orbit: OrbitState, wheelDeltaY: number): OrbitState {
  return {
    ...orbit,
    distanceM: clamp(
      orbit.distanceM * Math.exp(wheelDeltaY * ORBIT_ZOOM_SENS),
      ORBIT_MIN_DISTANCE_M,
      ORBIT_MAX_DISTANCE_M,
    ),
  };
}

function easeAxis(current: number, target: number, factor: number): number {
  const next = target + (current - target) * factor;
  return Math.abs(next - target) < EASE_EPS_RAD ? target : next;
}

/**
 * Ease the orbit yaw/pitch back toward the default chase framing (the "release -> re-chase"
 * behaviour). Frame-rate independent via exp(-rate*dt), and it snaps exactly onto the default so
 * the chase truly re-settles. The zoomed DISTANCE is deliberately kept — the player's framing
 * choice persists across the re-chase (owner decision, decisions.md).
 */
export function easeChaseToward(
  orbit: OrbitState,
  def: OrbitState,
  dtS: number,
  ratePerS: number,
): OrbitState {
  const factor = Math.exp(-ratePerS * dtS);
  return {
    yawRad: easeAxis(orbit.yawRad, def.yawRad, factor),
    pitchRad: easeAxis(orbit.pitchRad, def.pitchRad, factor),
    distanceM: orbit.distanceM,
  };
}

export type ChaseView = {
  /** Camera position in ECEF metres. */
  position: Vec3;
  headingRad: number;
  pitchRad: number;
  rollRad: number;
};

/**
 * Where the camera goes and where it looks, given the aircraft's ECEF position, its compass
 * heading, and the orbit state. Camera sits `distance` from the aircraft at azimuth (heading +
 * 180 + yaw) and elevation `pitch`, and turns to keep the aircraft centred (heading + yaw, tilted
 * down by pitch). Roll is always level — a stable chase, never a tumbling one.
 */
export function chaseView(
  aircraftPositionEcef: Vec3,
  aircraftHeadingRad: number,
  orbit: OrbitState,
): ChaseView {
  const { east, north, up } = enuBasis(aircraftPositionEcef);
  // Bearing from the aircraft OUT to the camera: behind the tail (heading + pi), plus orbit yaw.
  const bearing = aircraftHeadingRad + Math.PI + orbit.yawRad;
  const cosP = Math.cos(orbit.pitchRad);
  const sinP = Math.sin(orbit.pitchRad);
  const e = cosP * Math.sin(bearing);
  const n = cosP * Math.cos(bearing);
  const u = sinP;
  // Direction from aircraft to camera in ECEF, then step out by the distance.
  const dir: Vec3 = {
    x: east.x * e + north.x * n + up.x * u,
    y: east.y * e + north.y * n + up.y * u,
    z: east.z * e + north.z * n + up.z * u,
  };
  const position: Vec3 = {
    x: aircraftPositionEcef.x + dir.x * orbit.distanceM,
    y: aircraftPositionEcef.y + dir.y * orbit.distanceM,
    z: aircraftPositionEcef.z + dir.z * orbit.distanceM,
  };
  return {
    position,
    // Camera looks back toward the aircraft: opposite bearing horizontally (= heading + yaw),
    // tilted down by the orbit elevation.
    headingRad: aircraftHeadingRad + orbit.yawRad,
    pitchRad: -orbit.pitchRad,
    rollRad: 0,
  };
}
