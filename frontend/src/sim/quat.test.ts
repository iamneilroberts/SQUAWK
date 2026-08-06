import { describe, it, expect } from "vitest";
import {
  QUAT_IDENTITY, qMultiply, qNormalize, qConjugate, qRotate, qRotateInverse,
  qIntegrate, hprFromQuat, quatFromHpr,
} from "./quat";
import { geodeticToEcef, enuBasis } from "./geo";
import { degToRad, radToDeg } from "./units";
import { vDot, vLength } from "./vec3";

const HOME = geodeticToEcef(degToRad(30.6944), degToRad(-88.0399), 2000);

describe("quaternion algebra", () => {
  it("identity rotates nothing", () => {
    expect(qRotate(QUAT_IDENTITY, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
  });
  it("conjugate undoes rotate", () => {
    const q = qNormalize({ x: 0.2, y: -0.3, z: 0.5, w: 0.8 });
    const v = { x: 1, y: -2, z: 3 };
    const back = qRotateInverse(q, qRotate(q, v));
    expect(back.x).toBeCloseTo(v.x, 10);
    expect(back.y).toBeCloseTo(v.y, 10);
    expect(back.z).toBeCloseTo(v.z, 10);
  });
  it("multiplication composes rotations", () => {
    const half = qNormalize({ x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) });
    const full = qMultiply(half, half); // 180 deg about z
    const v = qRotate(full, { x: 1, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(-1, 9);
  });
  it("conjugate leaves the norm alone", () => {
    const q = qNormalize({ x: 0.2, y: -0.3, z: 0.5, w: 0.8 });
    const c = qConjugate(q);
    expect(Math.hypot(c.x, c.y, c.z, c.w)).toBeCloseTo(1, 12);
  });
});

describe("qIntegrate", () => {
  it("a full 360 deg roll returns to the starting attitude", () => {
    const rate = 2 * Math.PI; // one rev per second about body x
    let q = QUAT_IDENTITY;
    for (let i = 0; i < 60; i++) q = qIntegrate(q, { x: rate, y: 0, z: 0 }, 1 / 60);
    const y = qRotate(q, { x: 0, y: 1, z: 0 });
    expect(y.x).toBeCloseTo(0, 3);
    expect(y.y).toBeCloseTo(1, 3);
    expect(y.z).toBeCloseTo(0, 3);
  });
  it("stays unit-norm over 60000 steps (renormalization actually happens)", () => {
    let q = QUAT_IDENTITY;
    for (let i = 0; i < 60000; i++) {
      q = qIntegrate(q, { x: 0.7, y: -0.4, z: 0.3 }, 1 / 60);
    }
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    expect(Number.isFinite(q.w)).toBe(true);
  });
});

describe("hprFromQuat pins the Cesium HPR sign conventions", () => {
  // The four known attitudes. Body axes: X nose, Y right wing, Z down.
  it("1. wings level, nose north -> heading 0, pitch 0, roll 0", () => {
    const q = quatFromHpr(HOME, 0, 0, 0);
    const hpr = hprFromQuat(q, HOME);
    expect(radToDeg(hpr.headingRad)).toBeCloseTo(0, 6);
    expect(radToDeg(hpr.pitchRad)).toBeCloseTo(0, 6);
    expect(radToDeg(hpr.rollRad)).toBeCloseTo(0, 6);
    // and the nose really points north
    const nose = qRotate(q, { x: 1, y: 0, z: 0 });
    expect(vDot(nose, enuBasis(HOME).north)).toBeCloseTo(1, 9);
  });
  it("2. wings level, nose east -> heading +90", () => {
    const q = quatFromHpr(HOME, degToRad(90), 0, 0);
    expect(radToDeg(hprFromQuat(q, HOME).headingRad)).toBeCloseTo(90, 6);
    const nose = qRotate(q, { x: 1, y: 0, z: 0 });
    expect(vDot(nose, enuBasis(HOME).east)).toBeCloseTo(1, 9);
  });
  it("3. nose up 30 deg facing north -> pitch +30, nose has +up component", () => {
    const q = quatFromHpr(HOME, 0, degToRad(30), 0);
    const hpr = hprFromQuat(q, HOME);
    expect(radToDeg(hpr.pitchRad)).toBeCloseTo(30, 6);
    const nose = qRotate(q, { x: 1, y: 0, z: 0 });
    expect(vDot(nose, enuBasis(HOME).up)).toBeCloseTo(0.5, 6);
  });
  it("4. right wing down 45 deg -> roll +45, right wing has -up component", () => {
    const q = quatFromHpr(HOME, 0, 0, degToRad(45));
    const hpr = hprFromQuat(q, HOME);
    expect(radToDeg(hpr.rollRad)).toBeCloseTo(45, 6);
    const rightWing = qRotate(q, { x: 0, y: 1, z: 0 });
    expect(vDot(rightWing, enuBasis(HOME).up)).toBeCloseTo(-Math.SQRT1_2, 6);
  });
});

describe("HPR round-trip", () => {
  const cases: Array<[number, number, number]> = [
    [0, 0, 0],
    [37, 12, -20],
    [359, -5, 179],
    [180, 89, 45],
    [180, -89, -45],
  ];
  for (const [h, p, r] of cases) {
    it(`round-trips h=${h} p=${p} r=${r}`, () => {
      const q = quatFromHpr(HOME, degToRad(h), degToRad(p), degToRad(r));
      const back = hprFromQuat(q, HOME);
      // heading is compared modulo 360
      const dh = ((radToDeg(back.headingRad) - h + 540) % 360) - 180;
      expect(dh).toBeCloseTo(0, 4);
      expect(radToDeg(back.pitchRad)).toBeCloseTo(p, 4);
      const dr = ((radToDeg(back.rollRad) - r + 540) % 360) - 180;
      expect(dr).toBeCloseTo(0, 4);
    });
  }
  it("produces a unit quaternion", () => {
    const q = quatFromHpr(HOME, degToRad(210), degToRad(-30), degToRad(15));
    expect(vLength({ x: q.x, y: q.y, z: q.z })).toBeLessThanOrEqual(1);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
  });
});
