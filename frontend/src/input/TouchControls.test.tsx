import { describe, expect, it } from "vitest";
import { throttleFillPct } from "./TouchControls";

describe("throttle state", () => {
  it("maps throttle 0..1 to a clamped 0..100 fill", () => {
    expect(throttleFillPct(0)).toBe(0);
    expect(throttleFillPct(0.5)).toBe(50);
    expect(throttleFillPct(1)).toBe(100);
    expect(throttleFillPct(1.4)).toBe(100);
    expect(throttleFillPct(-0.2)).toBe(0);
  });
});
