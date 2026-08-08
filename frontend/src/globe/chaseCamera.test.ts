import { describe, it, expect } from "vitest";
import {
  defaultOrbit,
  applyOrbitDrag,
  applyZoom,
  easeChaseToward,
  chaseView,
  ORBIT_MIN_DISTANCE_M,
  ORBIT_MAX_DISTANCE_M,
  ORBIT_MIN_PITCH_RAD,
  ORBIT_MAX_PITCH_RAD,
  ORBIT_DRAG_SENS,
} from "./chaseCamera";
import { geodeticToEcef, enuBasis } from "../sim/geo";
import { vSub, vDot, vLength } from "../sim/vec3";
import { degToRad } from "../sim/units";

/*
 * chaseCamera is the PURE (Cesium-free) chase + orbit math: orbit state in, camera world position
 * + heading/pitch/roll out. The airframe pose comes from the sim; this module only decides where
 * the *camera* sits relative to it, so it is fully unit-testable. Tests anchor the aircraft at a
 * known point and reconstruct the expected geometry from its ENU basis rather than hard-coding
 * ellipsoid maths.
 */
const AC = geodeticToEcef(degToRad(45), degToRad(-100), 3000);
const { east, north, up } = enuBasis(AC);

describe("defaultOrbit", () => {
  it("frames a bigger class from farther away (distance scales with model length)", () => {
    expect(defaultOrbit("b738").distanceM).toBeGreaterThan(defaultOrbit("c172s").distanceM);
  });
  it("starts directly behind (yaw 0), slightly above (pitch > 0), inside the distance clamp", () => {
    const o = defaultOrbit("f5e");
    expect(o.yawRad).toBe(0);
    expect(o.pitchRad).toBeGreaterThan(0);
    expect(o.distanceM).toBeGreaterThanOrEqual(ORBIT_MIN_DISTANCE_M);
    expect(o.distanceM).toBeLessThanOrEqual(ORBIT_MAX_DISTANCE_M);
  });
});

describe("chaseView — default chase framing (yaw 0)", () => {
  it("sits the camera directly behind the aircraft along its heading, at the orbit distance", () => {
    const heading = degToRad(30);
    const o = { yawRad: 0, pitchRad: 0, distanceM: 40 };
    const view = chaseView(AC, heading, o);
    const offset = vSub(view.position, AC);
    // Forward (horizontal heading direction) in ECEF, built from the aircraft's ENU basis.
    const fwd = {
      x: east.x * Math.sin(heading) + north.x * Math.cos(heading),
      y: east.y * Math.sin(heading) + north.y * Math.cos(heading),
      z: east.z * Math.sin(heading) + north.z * Math.cos(heading),
    };
    expect(vDot(offset, fwd)).toBeCloseTo(-40, 4); // 40 m behind
    expect(vDot(offset, up)).toBeCloseTo(0, 4); // no vertical component at pitch 0
    expect(vLength(offset)).toBeCloseTo(40, 4);
  });

  it("aims the camera back at the aircraft — heading matches, roll is level", () => {
    const heading = degToRad(30);
    const view = chaseView(AC, heading, { yawRad: 0, pitchRad: 0, distanceM: 40 });
    expect(view.headingRad).toBeCloseTo(heading, 6);
    expect(view.pitchRad).toBeCloseTo(0, 6);
    expect(view.rollRad).toBe(0);
  });

  it("raises the camera and tilts it DOWN when orbit pitch is positive (look down at the jet)", () => {
    const view = chaseView(AC, 0, { yawRad: 0, pitchRad: degToRad(20), distanceM: 50 });
    const offset = vSub(view.position, AC);
    expect(vDot(offset, up)).toBeGreaterThan(0); // camera is above the aircraft
    expect(view.pitchRad).toBeLessThan(0); // camera looks down
    expect(view.pitchRad).toBeCloseTo(-degToRad(20), 6);
  });

  it("orbit yaw swings the camera around and turns it to keep the aircraft in frame", () => {
    const view = chaseView(AC, 0, { yawRad: degToRad(90), pitchRad: 0, distanceM: 40 });
    expect(view.headingRad).toBeCloseTo(degToRad(90), 6);
    expect(vLength(vSub(view.position, AC))).toBeCloseTo(40, 4);
  });
});

describe("applyOrbitDrag", () => {
  it("accumulates yaw from horizontal drag and clamps pitch to its limits", () => {
    const o = applyOrbitDrag(defaultOrbit("c172s"), 100, 0);
    expect(o.yawRad).toBeCloseTo(100 * ORBIT_DRAG_SENS, 6);
  });
  it("clamps pitch so the camera never flips over the top or under the belly", () => {
    const low = applyOrbitDrag({ yawRad: 0, pitchRad: 0, distanceM: 40 }, 0, 100000);
    const high = applyOrbitDrag({ yawRad: 0, pitchRad: 0, distanceM: 40 }, 0, -100000);
    expect(low.pitchRad).toBe(ORBIT_MIN_PITCH_RAD);
    expect(high.pitchRad).toBe(ORBIT_MAX_PITCH_RAD);
  });
  it("wraps yaw into (-pi, pi] so a full swing round can face the nose", () => {
    const o = applyOrbitDrag({ yawRad: Math.PI - 0.001, pitchRad: 0, distanceM: 40 }, 100, 0);
    expect(o.yawRad).toBeLessThanOrEqual(Math.PI);
    expect(o.yawRad).toBeGreaterThan(-Math.PI);
  });
});

describe("applyZoom", () => {
  it("scrolling out increases distance, scrolling in decreases it", () => {
    const base = { yawRad: 0, pitchRad: 0, distanceM: 60 };
    expect(applyZoom(base, 120).distanceM).toBeGreaterThan(60);
    expect(applyZoom(base, -120).distanceM).toBeLessThan(60);
  });
  it("clamps distance to the min/max bracket", () => {
    const base = { yawRad: 0, pitchRad: 0, distanceM: 60 };
    expect(applyZoom(base, 1e6).distanceM).toBe(ORBIT_MAX_DISTANCE_M);
    expect(applyZoom(base, -1e6).distanceM).toBe(ORBIT_MIN_DISTANCE_M);
  });
});

describe("easeChaseToward", () => {
  it("eases yaw and pitch back to the default chase framing on release, keeping the zoomed distance", () => {
    const def = defaultOrbit("c172s");
    const dragged = { yawRad: degToRad(120), pitchRad: degToRad(60), distanceM: 25 };
    const eased = easeChaseToward(dragged, def, 0.1, 6);
    expect(Math.abs(eased.yawRad)).toBeLessThan(Math.abs(dragged.yawRad));
    expect(Math.abs(eased.pitchRad - def.pitchRad)).toBeLessThan(Math.abs(dragged.pitchRad - def.pitchRad));
    expect(eased.distanceM).toBe(25); // zoom persists across the re-chase (owner decision)
  });
  it("snaps exactly onto the default framing once close, rather than hovering asymptotically", () => {
    const def = defaultOrbit("c172s");
    let o = { yawRad: degToRad(5), pitchRad: def.pitchRad + degToRad(5), distanceM: def.distanceM };
    for (let i = 0; i < 200; i++) o = easeChaseToward(o, def, 1 / 60, 6);
    expect(o.yawRad).toBe(0);
    expect(o.pitchRad).toBe(def.pitchRad);
  });
});
