import { describe, it, expect } from "vitest";
import { tapeTicks, tapeBugPx, velocityVectorOffsetPx, headingTapeTicks } from "./glassMath";
import { degToRad } from "../sim/units";

describe("tapeTicks (vertical moving tape)", () => {
  it("centres the reading and puts higher values ABOVE (negative y)", () => {
    const ticks = tapeTicks({ center: 250, step: 50, halfWindow: 100, pxPerUnit: 1 });
    const at = (v: number) => ticks.find((t) => t.value === v);
    expect(at(250)!.px).toBe(0);
    expect(at(300)!.px).toBe(-50); // higher speed sits above centre
    expect(at(200)!.px).toBe(50); // lower speed sits below
  });

  it("only emits graduations inside the window", () => {
    const values = tapeTicks({ center: 250, step: 50, halfWindow: 100, pxPerUnit: 1 }).map((t) => t.value);
    expect(values).toEqual([150, 200, 250, 300, 350]);
  });

  it("returns nothing for an unknown reading — the view shows only the em-dash box", () => {
    expect(tapeTicks({ center: null, step: 50, halfWindow: 100, pxPerUnit: 1 })).toEqual([]);
  });

  it("marks majors on the majorEvery multiple", () => {
    const ticks = tapeTicks({ center: 0, step: 100, halfWindow: 250, pxPerUnit: 0.1, majorEvery: 2 });
    expect(ticks.find((t) => t.value === 200)!.major).toBe(true);
    expect(ticks.find((t) => t.value === 100)!.major).toBe(false);
  });
});

describe("tapeBugPx (fixed placard bug on a tape)", () => {
  it("places a bug relative to the live reading", () => {
    expect(tapeBugPx({ value: 200, center: 250, halfWindow: 100, pxPerUnit: 1 })).toBe(50);
  });
  it("hides a bug outside the visible window", () => {
    expect(tapeBugPx({ value: 50, center: 250, halfWindow: 100, pxPerUnit: 1 })).toBeNull();
  });
  it("hides a bug when the reading is unknown", () => {
    expect(tapeBugPx({ value: 200, center: null, halfWindow: 100, pxPerUnit: 1 })).toBeNull();
  });
});

describe("velocityVectorOffsetPx (HUD flight-path marker)", () => {
  it("drops the marker below the boresight by the angle of attack", () => {
    const v = velocityVectorOffsetPx({ aoaRad: degToRad(5), sideslipRad: 0, pxPerDeg: 2 })!;
    expect(v.y).toBeCloseTo(10, 6); // +y down
    expect(v.x).toBeCloseTo(0, 6);
  });
  it("slides the marker sideways with sideslip", () => {
    const v = velocityVectorOffsetPx({ aoaRad: 0, sideslipRad: degToRad(3), pxPerDeg: 2 })!;
    expect(v.x).toBeCloseTo(6, 6);
  });
  it("returns null when AoA or sideslip is unknown — no fabricated marker", () => {
    expect(velocityVectorOffsetPx({ aoaRad: null, sideslipRad: 0, pxPerDeg: 2 })).toBeNull();
    expect(velocityVectorOffsetPx({ aoaRad: 0, sideslipRad: null, pxPerDeg: 2 })).toBeNull();
  });
});

describe("headingTapeTicks (HUD heading scale)", () => {
  it("centres current heading and puts higher headings to the right", () => {
    const ticks = headingTapeTicks({ headingDeg: 90, halfSpanDeg: 20, stepDeg: 10, pxPerDeg: 1 });
    const at = (d: number) => ticks.find((t) => t.deg === d);
    expect(at(90)!.px).toBe(0);
    expect(at(100)!.px).toBe(10);
    expect(at(80)!.px).toBe(-10);
  });
  it("wraps past 360 and labels majors in tens of degrees", () => {
    const ticks = headingTapeTicks({ headingDeg: 355, halfSpanDeg: 20, stepDeg: 10, pxPerDeg: 1 });
    const zero = ticks.find((t) => t.deg === 0);
    expect(zero).toBeDefined(); // 360 wrapped to 0
    expect(zero!.major).toBe(true);
    expect(zero!.label).toBe("00");
  });
  it("returns nothing for an unknown heading", () => {
    expect(headingTapeTicks({ headingDeg: null, halfSpanDeg: 20, stepDeg: 10, pxPerDeg: 1 })).toEqual([]);
  });
});
