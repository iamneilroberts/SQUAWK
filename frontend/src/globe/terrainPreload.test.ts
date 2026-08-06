import { describe, it, expect } from "vitest";
import { lookAheadPointRad } from "./terrainPreload";
import { degToRad, radToDeg, ktToMs } from "../sim/units";

describe("lookAheadPointRad", () => {
  it("heading 000 moves north", () => {
    const p = lookAheadPointRad(degToRad(30), degToRad(-88), 0, ktToMs(100), 10);
    expect(radToDeg(p.latRad)).toBeGreaterThan(30);
    expect(radToDeg(p.lonRad)).toBeCloseTo(-88, 6);
  });
  it("heading 090 moves east", () => {
    const p = lookAheadPointRad(degToRad(30), degToRad(-88), degToRad(90), ktToMs(100), 10);
    expect(radToDeg(p.lonRad)).toBeGreaterThan(-88);
    expect(radToDeg(p.latRad)).toBeCloseTo(30, 4);
  });
  it("ten seconds at 100 kt is about half a kilometre", () => {
    const p = lookAheadPointRad(degToRad(30), degToRad(-88), 0, ktToMs(100), 10);
    const metres = (radToDeg(p.latRad) - 30) * 111_195;
    expect(metres).toBeGreaterThan(400);
    expect(metres).toBeLessThan(650);
  });
  it("zero speed does not move", () => {
    const p = lookAheadPointRad(degToRad(30), degToRad(-88), degToRad(45), 0, 10);
    expect(radToDeg(p.latRad)).toBeCloseTo(30, 9);
    expect(radToDeg(p.lonRad)).toBeCloseTo(-88, 9);
  });
});
