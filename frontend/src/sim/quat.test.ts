import { describe, it, expect } from "vitest";
import {
  QUAT_IDENTITY, qMultiply, qNormalize, qConjugate, qRotate, qRotateInverse,
  qIntegrate, hprFromQuat, quatFromHpr, turnRateRadS,
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

describe("turnRateRadS", () => {
  const pos = geodeticToEcef(degToRad(30), degToRad(-88), 1000);

  it("is POSITIVE for a right turn — body Z is down, so the naive dot product is backwards", () => {
    const level = quatFromHpr(pos, 0, 0, 0);
    // r about body Z is "nose right" (see this module's header), i.e. turning right.
    expect(turnRateRadS(level, pos, { x: 0, y: 0, z: 0.05 })).toBeCloseTo(0.05, 6);
  });

  it("is NEGATIVE for a left turn", () => {
    const level = quatFromHpr(pos, 0, 0, 0);
    expect(turnRateRadS(level, pos, { x: 0, y: 0, z: -0.05 })).toBeCloseTo(-0.05, 6);
  });

  it("is zero when the heading is not changing: level attitude, roll+pitch body rates only", () => {
    // Level attitude puts both body X and body Y in the horizontal plane, so p/q rates
    // have zero projection on local up — heading genuinely isn't changing. (A banked,
    // pitched aircraft with the same rates WOULD change heading; that case belongs to
    // the signed tests above, not here.)
    const level = quatFromHpr(pos, degToRad(45), 0, 0);
    expect(turnRateRadS(level, pos, { x: 0.4, y: 0.2, z: 0 })).toBeCloseTo(0, 6);
  });

  it("is NOT the raw body yaw rate: knife-edge, a pure body yaw rate is pitch, not a turn", () => {
    // Rolled 90 degrees, body Z points along the horizon, so yawing about it changes pitch and
    // not heading at all. `state.rates.z` would claim a hard turn here.
    const knifeEdge = quatFromHpr(pos, 0, 0, degToRad(90));
    expect(turnRateRadS(knifeEdge, pos, { x: 0, y: 0, z: 0.05 })).toBeCloseTo(0, 6);
  });

  it("reads a level turn out of a body ROLL rate when the aeroplane is on its side", () => {
    // The mirror of the case above: rolled 90 degrees, body X (the roll axis) points... still
    // along the nose. Rolled 90 with the nose up 90 (pointing at the zenith), body X is up.
    const noseUp = quatFromHpr(pos, 0, degToRad(90), 0);
    expect(turnRateRadS(noseUp, pos, { x: 0, y: 0, z: 0.05 })).toBeCloseTo(0, 6);
    expect(Math.abs(turnRateRadS(noseUp, pos, { x: 0.05, y: 0, z: 0 }))).toBeCloseTo(0.05, 6);
  });
});
