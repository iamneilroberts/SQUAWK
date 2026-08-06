import { describe, it, expect } from "vitest";
import { vAdd, vSub, vScale, vDot, vCross, vLength, vNormalize, V_ZERO } from "./vec3";

describe("vec3", () => {
  it("adds, subtracts and scales", () => {
    expect(vAdd({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toEqual({ x: 5, y: 7, z: 9 });
    expect(vSub({ x: 4, y: 5, z: 6 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 3, y: 3, z: 3 });
    expect(vScale({ x: 1, y: -2, z: 3 }, 2)).toEqual({ x: 2, y: -4, z: 6 });
  });
  it("dots and crosses per the right-hand rule", () => {
    expect(vDot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
    expect(vCross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });
  it("measures and normalizes length", () => {
    expect(vLength({ x: 3, y: 4, z: 0 })).toBe(5);
    const n = vNormalize({ x: 0, y: 0, z: -7 });
    expect(n).toEqual({ x: 0, y: 0, z: -1 });
  });
  it("normalizing the zero vector returns zero rather than NaN", () => {
    expect(vNormalize(V_ZERO)).toEqual({ x: 0, y: 0, z: 0 });
  });
});
