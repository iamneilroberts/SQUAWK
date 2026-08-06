import { describe, it, expect } from "vitest";
import { ktToMs, msToKt, ftToM, mToFt, msToFpm, fpmToMs, degToRad, radToDeg } from "./units";

describe("units", () => {
  it("converts knots to m/s and back", () => {
    expect(ktToMs(100)).toBeCloseTo(51.4444, 4);
    expect(msToKt(51.4444)).toBeCloseTo(100, 3);
  });
  it("converts feet to metres and back", () => {
    expect(ftToM(1000)).toBeCloseTo(304.8, 6);
    expect(mToFt(304.8)).toBeCloseTo(1000, 6);
  });
  it("converts m/s to feet per minute and back", () => {
    expect(msToFpm(1)).toBeCloseTo(196.8504, 3);
    expect(fpmToMs(500)).toBeCloseTo(2.54, 4);
  });
  it("round-trips degrees and radians", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 12);
  });
  it("preserves sign on descent rates", () => {
    expect(msToFpm(-5)).toBeCloseTo(-984.252, 3);
  });
});
